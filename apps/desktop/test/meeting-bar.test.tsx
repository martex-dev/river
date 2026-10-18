// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingBar } from '../src/renderer/src/community/ui/Meeting.tsx';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { useRiver } from '../src/renderer/src/store.ts';
import type { VoiceCall } from '../src/renderer/src/community/voice.ts';

afterEach(cleanup);

const community = {
  id: 'c',
  members: [
    { riverId: 'me', name: 'Me' },
    { riverId: 'ana', name: 'Ana' },
    { riverId: 'ben', name: 'Ben' },
  ],
} as never;

function fakeCall(over: Partial<VoiceCall> = {}): VoiceCall {
  const call = {
    hand: null as number | null,
    micLost: false,
    transmitting: true,
    speaking: new Set(['ana']),
    remotes: () => [
      { id: 'ana', state: 'connected', relayed: false, relayFlowing: false, reconnecting: false, hand: 200 },
      { id: 'ben', state: 'connected', relayed: false, relayFlowing: false, reconnecting: false, hand: 100 },
    ],
    setHand: vi.fn((up: boolean) => {
      call.hand = up ? 300 : null;
    }),
    updateOptions: vi.fn(async () => undefined),
    ...over,
  };
  return call as unknown as VoiceCall;
}

describe('the meeting bar', () => {
  it('shows who talks, the raised hands in order, and raises yours', () => {
    useCommunity.setState({ connection: 'online' } as never);
    useRiver.setState({ settings: { voice: { noiseSuppression: true } }, updateSettings: vi.fn() } as never);
    const call = fakeCall();
    const onView = vi.fn();
    render(
      <MeetingBar
        call={call}
        community={community}
        channel={{ id: 'ch', stage: false } as never}
        me="me"
        view="grid"
        onView={onView}
      />,
    );
    expect(screen.getByText('Ana is talking')).toBeTruthy();
    const hands = screen.getByRole('list', { name: 'Raised hands, in order' });
    expect(hands.textContent).toMatch(/1\. Ben.*2\. Ana/);
    fireEvent.click(screen.getByRole('button', { name: /Raise hand/ }));
    expect(call.setHand).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Speaker' }));
    expect(onView).toHaveBeenCalledWith('speaker');
    fireEvent.click(screen.getByRole('button', { name: 'Noise suppression' }));
    expect(call.updateOptions).toHaveBeenCalledWith({ noiseSuppression: false });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the microphone is gone or the call is reconnecting, and leaves hands to stages', () => {
    useCommunity.setState({ connection: 'offline' } as never);
    const call = fakeCall({
      micLost: true,
      remotes: () => [],
    } as never);
    render(
      <MeetingBar
        call={call}
        community={community}
        channel={{ id: 'ch', stage: true } as never}
        me="me"
        view="speaker"
        onView={() => undefined}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/microphone was disconnected/);
    expect(screen.getByRole('status').textContent).toMatch(/Reconnecting/);
    expect(screen.queryByRole('button', { name: /Raise hand/ })).toBeNull();
  });
});
