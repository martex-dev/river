// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneCallsSection, StayConnectedPrompt } from '../src/renderer/src/components/PhoneReachability.tsx';
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
    await screen.findByText('Battery optimization may delay messages and calls.');
    expect(screen.getByText('Not allowed: a locked phone only shows a notification for calls.')).toBeTruthy();
    expect(screen.getByText('On: messages and calls reach you while River is closed.')).toBeTruthy();
    fireEvent.click(screen.getByText('Allow in background'));
    expect(phoneFix).toHaveBeenCalledWith('battery');
    fireEvent.click(screen.getByText('Allow'));
    expect(phoneFix).toHaveBeenCalledWith('fullScreen');
  });
});
