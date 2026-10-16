// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecorder } from '../src/renderer/src/components/VoiceMessage.tsx';

class FakeRecorder {
  static isTypeSupported = (): boolean => true;
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['sound']) });
    this.onstop?.();
  }
}

let tracks: Array<{ stop: ReturnType<typeof vi.fn> }>;
let asks: Array<(stream: unknown) => void>;
beforeEach(() => {
  tracks = [];
  asks = [];
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder;
  (window as unknown as { river: unknown }).river = { app: { haptic: () => undefined } };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: () =>
        new Promise((resolve) => {
          const track = { stop: vi.fn() };
          tracks.push(track);
          asks.push(() => resolve({ getTracks: () => [track] }));
        }),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const grant = async (): Promise<void> => {
  await act(async () => {
    for (const a of asks.splice(0)) a(null);
    await Promise.resolve();
  });
};

describe('recording a voice message', () => {
  it('asks for the microphone once however often the button is pressed', async () => {
    render(<VoiceRecorder onRecorded={() => undefined} />);
    const mic = screen.getByRole('button', { name: 'Record a voice message' });
    fireEvent.click(mic);
    fireEvent.click(mic);
    expect(asks).toHaveLength(1);
    await grant();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('turns the microphone off again when the chat closes while it was being asked for', async () => {
    const view = render(<VoiceRecorder onRecorded={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    view.unmount();
    await grant();
    expect(tracks[0]!.stop).toHaveBeenCalled();
  });

  it('keeps recording when text is typed, and sends with the newest reply chosen', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = render(<VoiceRecorder onRecorded={first} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await grant();
    vi.useFakeTimers();
    act(() => void vi.advanceTimersByTime(2000));
    // Text typed meanwhile: the mic button would hide, the recording carries on.
    view.rerender(<VoiceRecorder onRecorded={latest} idleHidden />);
    expect(screen.getByRole('button', { name: 'Send voice message' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send voice message' }));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    expect((latest.mock.calls[0]![0] as File).name).toMatch(/^voice-message-2s\./);
    // Done: with text in the box, no mic button.
    expect(screen.queryByRole('button', { name: 'Record a voice message' })).toBeNull();
  });
});
