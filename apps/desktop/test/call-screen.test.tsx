// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { callColours, IncomingCall } from '../src/renderer/src/dm/CallUi.tsx';
import { handleCallEvent, useDmCall } from '../src/renderer/src/dm/call.ts';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { useDm } from '../src/renderer/src/dm/store.ts';
import { useRiver } from '../src/renderer/src/store.ts';

afterEach(() => {
  cleanup();
  useDmCall.setState({ incoming: null });
});

describe('the incoming call screen', () => {
  it('gives each name its own colours, the same every time', () => {
    expect(callColours('Alice')).toEqual(callColours('Alice'));
    expect(callColours('')).toHaveLength(2);
  });

  it('fills the screen on a phone with the caller, "Ringing…", Decline and Answer', () => {
    useRiver.setState({ info: { platform: 'android' } as never });
    useDm.setState({
      conversations: [{ riverId: 'p', kind: 'direct', name: 'Alice', members: [] } as never],
    });
    useDmCall.setState({ incoming: { peer: 'p', callId: 'c', video: false } });
    const { container } = render(<IncomingCall />);
    expect(container.querySelector('.incoming-call--full')).not.toBeNull();
    expect(screen.getByRole('alertdialog', { name: 'Incoming call from Alice' })).toBeTruthy();
    expect(screen.getByText(/Ringing/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept with video' })).toBeNull();
  });

  it('offers video and voice answers for a video call, as a card on a computer', () => {
    useRiver.setState({ info: { platform: 'win32' } as never });
    useDmCall.setState({ incoming: { peer: 'p', callId: 'c', video: true } });
    const { container } = render(<IncomingCall />);
    expect(container.querySelector('.incoming-call--full')).toBeNull();
    expect(screen.getByRole('button', { name: 'Accept with video' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy();
  });

  it('goes away quietly when the call was answered on another of your devices', () => {
    const notices: string[] = [];
    useCommunity.setState({ notify: (t: string) => void notices.push(t) } as never);
    (window as unknown as { river: unknown }).river = {
      dm: { action: async () => ({ ok: true, value: null }) },
    };
    useDmCall.setState({ incoming: { peer: 'p', callId: 'c', video: false } });
    handleCallEvent({ t: 'call', peer: 'p', callId: 'c', kind: 'elsewhere', video: false });
    expect(useDmCall.getState().incoming).toBeNull();
    expect(notices).toEqual([]);
  });
});
