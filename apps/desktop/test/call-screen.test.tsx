// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeakerButton } from '../src/renderer/src/community/ui/Voice.tsx';
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

describe('the loudspeaker button (phones)', () => {
  it('keeps the route chosen for a call when its screen is left and opened again', () => {
    const setSpeaker = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { river: unknown }).river = { voice: { setSpeaker } };
    const call = {};
    // A voice call starts at the ear: set once.
    const first = render(<SpeakerButton initial={false} call={call} />);
    expect(setSpeaker.mock.calls).toEqual([[false]]);
    fireEvent.click(screen.getByRole('button', { name: 'Speaker off' }));
    expect(setSpeaker.mock.calls).toEqual([[false], [true]]);
    first.unmount();
    // Back to the call: still on the loudspeaker, and nothing set again.
    render(<SpeakerButton initial={false} call={call} />);
    expect(screen.getByRole('button', { name: 'Speaker on' })).toBeTruthy();
    expect(setSpeaker.mock.calls).toEqual([[false], [true]]);
    cleanup();
    // A new call starts from its own default again.
    render(<SpeakerButton initial={false} call={{}} />);
    expect(screen.getByRole('button', { name: 'Speaker off' })).toBeTruthy();
    expect(setSpeaker.mock.calls).toEqual([[false], [true], [false]]);
  });
});
