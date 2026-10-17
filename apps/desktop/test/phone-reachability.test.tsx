// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PhoneCallsSection,
  StayConnectedPrompt,
  resetPhoneStatus,
  stayConnectedText,
} from '../src/renderer/src/components/PhoneReachability.tsx';
import { useRiver } from '../src/renderer/src/store.ts';
import type { PhoneStatus } from '../src/shared/ipc.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts';

const phoneStatus = vi.fn<() => Promise<PhoneStatus | null>>();
const phoneFix = vi.fn<(fix: string) => Promise<PhoneStatus | null>>();
const updateSettings = vi.fn<(patch: unknown) => Promise<void>>();

const status = (s: Partial<PhoneStatus> = {}): PhoneStatus => ({
  background: false,
  batteryExempt: false,
  fullScreenCalls: true,
  notifications: true,
  ...s,
});

function phone(platform: string, system: Partial<Settings['system']>): void {
  const settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings.system, system);
  useRiver.setState({
    info: { platform },
    settings,
    updateSettings,
  } as unknown as Partial<ReturnType<typeof useRiver.getState>>);
}

beforeEach(() => {
  phoneStatus.mockReset();
  phoneFix.mockReset();
  updateSettings.mockReset();
  updateSettings.mockResolvedValue(undefined);
  phoneFix.mockResolvedValue(null);
  localStorage.clear();
  resetPhoneStatus();
  (window as unknown as { river: unknown }).river = { app: { phoneStatus, phoneFix } };
});

afterEach(() => cleanup());

describe('Get messages and calls when River is closed? (Android, 2.11)', () => {
  it('asks an existing install once; "Not now" remembers the answer and turns nothing on', async () => {
    phoneStatus.mockResolvedValue(status());
    phone('android', { background: false, backgroundAsked: false });
    render(<StayConnectedPrompt />);
    await screen.findByText('Get messages and calls when River is closed?');
    fireEvent.click(screen.getByText('Not now'));
    expect(updateSettings).toHaveBeenCalledWith({ system: { backgroundAsked: true } });
    expect(phoneFix).not.toHaveBeenCalled();
  });

  it('"Turn on" stays connected, then lets Android ask about battery saving', async () => {
    phoneStatus.mockResolvedValue(status());
    phone('android', { background: false, backgroundAsked: false });
    render(<StayConnectedPrompt />);
    fireEvent.click(await screen.findByText('Turn on'));
    expect(updateSettings).toHaveBeenCalledWith({ system: { background: true, backgroundAsked: true } });
    await waitFor(() => expect(phoneFix).toHaveBeenCalledWith('battery'));
  });

  it('a new install already connected and exempt is never asked', async () => {
    phoneStatus.mockResolvedValue(status({ background: true, batteryExempt: true }));
    phone('android', { background: true, backgroundAsked: false });
    const { container } = render(<StayConnectedPrompt />);
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ system: { backgroundAsked: true } }));
    expect(container.textContent).toBe('');
  });

  it('asks nothing on computers and iPhones', async () => {
    phoneStatus.mockResolvedValue(null);
    for (const platform of ['win32', 'ios']) {
      phone(platform, { background: false, backgroundAsked: false });
      const { container } = render(<StayConnectedPrompt />);
      expect(container.textContent).toBe('');
      cleanup();
    }
    expect(phoneStatus).not.toHaveBeenCalled();
  });
});

describe('Settings → System → Calls and notifications (Android)', () => {
  it('shows what the phone reports, honestly, with a fix for what is missing', async () => {
    phoneStatus.mockResolvedValue(status({ background: true, fullScreenCalls: false, notifications: true }));
    phone('android', { background: true, backgroundAsked: true });
    render(<PhoneCallsSection />);
    await screen.findByText(
      'Battery optimization may delay messages and calls, and Android may stop Stay connected.',
    );
    expect(screen.getByText('Not allowed: a locked phone only shows a notification for calls.')).toBeTruthy();
    // Not exempt: Android may stop the service, and Settings says so instead of a plain "On".
    expect(screen.getByText(/On for now, but Android may stop it/)).toBeTruthy();
    fireEvent.click(screen.getByText('Allow in background'));
    expect(phoneFix).toHaveBeenCalledWith('battery');
    fireEvent.click(screen.getByText('Allow'));
    expect(phoneFix).toHaveBeenCalledWith('fullScreen');
  });

  it('"Turn on" (battery already allowed) reads the phone again, so it does not say Android has not started it', async () => {
    phoneStatus.mockResolvedValue(status({ background: false, batteryExempt: true }));
    phone('android', { background: false, backgroundAsked: true });
    const { rerender } = render(<PhoneCallsSection />);
    fireEvent.click(await screen.findByText('Turn on'));
    expect(updateSettings).toHaveBeenCalledWith({ system: { background: true, backgroundAsked: true } });
    // The service is running now; the settings change arrives from main.
    phoneStatus.mockResolvedValue(status({ background: true, batteryExempt: true }));
    phone('android', { background: true, backgroundAsked: true });
    rerender(<PhoneCallsSection />);
    await screen.findByText('On: messages and calls reach you while River is closed.');
    expect(phoneFix).not.toHaveBeenCalled();
  });

  it('every part of Settings shares one status', async () => {
    phoneStatus.mockResolvedValue(status({ background: true, batteryExempt: true }));
    phone('android', { background: true, backgroundAsked: true });
    render(
      <>
        <PhoneCallsSection />
        <PhoneCallsSection />
      </>,
    );
    await waitFor(() =>
      expect(screen.getAllByText('On: messages and calls reach you while River is closed.')).toHaveLength(2),
    );
  });

  it('says plainly that Stay connected needs the battery exemption to keep running', () => {
    expect(stayConnectedText(false, status()).text).toMatch(/^Off/);
    expect(stayConnectedText(true, status({ background: true, batteryExempt: true })).ok).toBe(true);
    expect(stayConnectedText(true, status({ background: true })).ok).toBe(false);
    expect(stayConnectedText(true, status()).text).toMatch(/needs River allowed in the background/);
    expect(stayConnectedText(true, status({ batteryExempt: true })).text).toMatch(/has not started it yet/);
  });
});
