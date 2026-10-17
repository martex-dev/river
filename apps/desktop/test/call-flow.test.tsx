// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock(import('../src/renderer/src/community/sound.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  play: vi.fn(),
}));

import { play } from '../src/renderer/src/community/sound.ts';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { lastCall } from '../src/renderer/src/community/rejoin.ts';
import { useRiver } from '../src/renderer/src/store.ts';
import {
  CONNECT_TIMEOUT_MS,
  acceptDmCall,
  endDmCall,
  handleCallEvent,
  handlePhoneCall,
  startDmCall,
  useDmCall,
} from '../src/renderer/src/dm/call.ts';

/** Calls flow through window.river: everything they send is recorded here. */
const dmAction = vi.fn();
const voiceJoin = vi.fn();
const callRoom = vi.fn();
const tracks: Array<{ stopped: boolean }> = [];
let mic: () => Promise<unknown>;

function fakeTrack(): { kind: string; enabled: boolean; stopped: boolean; stop(): void; clone(): unknown } {
  const t = {
    kind: 'audio',
    enabled: true,
    stopped: false,
    stop: () => {
      t.stopped = true;
    },
    clone: () => fakeTrack(),
  };
  tracks.push(t);
  return t;
}
const stream = (): unknown => {
  const t = fakeTrack();
  return { getAudioTracks: () => [t], getVideoTracks: () => [], getTracks: () => [t] };
};

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Our ID sorts after the peer's, so as the callee we wait for their offer (no WebRTC needed here).
const ME = '0000000f-0000-4000-8000-000000000000';
const PEER = '00000001-0000-4000-8000-000000000000';

const sent = (kind: string): unknown[] =>
  dmAction.mock.calls
    .map(([a]) => a as { a: string; kind?: string })
    .filter((a) => a.a === 'call' && a.kind === kind);
const logged = (): Array<{ direction: string; video: boolean; answered: boolean }> =>
  dmAction.mock.calls
    .map(([a]) => a as { a: string; direction: string; video: boolean; answered: boolean })
    .filter((a) => a.a === 'logCall');
const invite = (video = false) =>
  handleCallEvent({ t: 'call', peer: PEER, callId: 'call-1', kind: 'invite', video });

beforeEach(() => {
  dmAction.mockReset();
  dmAction.mockResolvedValue({ ok: true, value: null });
  voiceJoin.mockReset();
  voiceJoin.mockResolvedValue({ ok: true, value: null });
  callRoom.mockReset();
  tracks.length = 0;
  mic = async () => stream();
  (window as unknown as { river: unknown }).river = {
    dm: { action: dmAction },
    community: { action: vi.fn().mockResolvedValue({ ok: true, value: null }) },
    voice: {
      iceServers: async () => [],
      callRoom,
      relay: vi.fn(),
      join: voiceJoin,
      leave: vi.fn().mockResolvedValue({ ok: true, value: null }),
      signal: vi.fn().mockResolvedValue({ ok: true, value: null }),
      shareStatus: vi.fn(),
    },
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => mic() },
  });
  useRiver.setState({
    identity: { riverId: ME, displayName: 'Me' },
    navigate: vi.fn(),
  } as unknown as Partial<ReturnType<typeof useRiver.getState>>);
  useCommunity.setState({ call: null, selfMuted: false, selfDeafened: false, communities: [] });
  useDmCall.setState({ incoming: null, active: null });
});

afterEach(async () => {
  await endDmCall();
  await useCommunity.getState().leaveVoice();
  vi.useRealTimers();
});

describe('1:1 calls', () => {
  it('a double click starts one call', async () => {
    await Promise.all([startDmCall(PEER, false), startDmCall(PEER, false)]);
    expect(sent('invite')).toHaveLength(1);
  });

  it('hanging up while the microphone opens sends no invite and leaves the microphone off', async () => {
    const pending = deferred<unknown>();
    mic = () => pending.promise;
    const starting = startDmCall(PEER, false);
    await vi.waitFor(() => expect(useCommunity.getState().call).not.toBeNull());
    await endDmCall();
    pending.resolve(stream());
    await starting;
    expect(sent('invite')).toHaveLength(0);
    expect(tracks.every((t) => t.stopped)).toBe(true);
    expect(callRoom).not.toHaveBeenCalledWith(expect.any(String));
    expect(useDmCall.getState().active).toBeNull();
  });

  it('without an identity nothing rings', async () => {
    useRiver.setState({ identity: null } as unknown as Partial<ReturnType<typeof useRiver.getState>>);
    vi.mocked(play).mockClear();
    await startDmCall(PEER, false);
    expect(play).not.toHaveBeenCalledWith('ringback');
  });

  it('an unanswered call is logged as missed (with its video flag) when it stops ringing here', () => {
    vi.useFakeTimers();
    invite(true);
    vi.advanceTimersByTime(45_000);
    expect(useDmCall.getState().incoming).toBeNull();
    expect(logged()).toEqual([expect.objectContaining({ direction: 'in', video: true, answered: false })]);
    expect(useCommunity.getState().toast?.text).toMatch(/Missed call/);
  });

  it('a video call the caller ends before you answer is logged as a video call', () => {
    invite(true);
    handleCallEvent({ t: 'call', peer: PEER, callId: 'call-1', kind: 'end', video: false });
    expect(logged()).toEqual([expect.objectContaining({ video: true, answered: false })]);
  });

  it('answering without a microphone declines, logs the call and cleans up', async () => {
    mic = async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    };
    invite();
    await acceptDmCall(false);
    expect(sent('decline')).toHaveLength(1);
    expect(sent('accept')).toHaveLength(0);
    expect(logged()).toEqual([expect.objectContaining({ direction: 'in', answered: false })]);
    expect(useDmCall.getState().active).toBeNull();
    expect(useCommunity.getState().call).toBeNull();
  });

  it('the caller hanging up while you answer ends the call on your side too', async () => {
    const pending = deferred<unknown>();
    mic = () => pending.promise;
    invite();
    const accepting = acceptDmCall(false);
    // From the click on, the call is the active one, so the caller's "end" applies to it.
    expect(useDmCall.getState().active?.callId).toBe('call-1');
    // The microphone prompt is open.
    await vi.waitFor(() => expect(useCommunity.getState().call).not.toBeNull());
    handleCallEvent({ t: 'call', peer: PEER, callId: 'call-1', kind: 'end', video: false });
    pending.resolve(stream());
    await accepting;
    expect(useDmCall.getState().active).toBeNull();
    expect(sent('accept')).toHaveLength(0);
    expect(tracks.every((t) => t.stopped)).toBe(true);
  });

  it('an answered call that never connects ends instead of "Connecting…" forever', async () => {
    vi.useFakeTimers();
    invite();
    const accepting = acceptDmCall(false);
    await vi.advanceTimersByTimeAsync(0);
    await accepting;
    expect(useDmCall.getState().active?.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    expect(useDmCall.getState().active).toBeNull();
    expect(sent('end')).toHaveLength(1);
  });

  it('joining a voice channel ends the 1:1 call completely', async () => {
    await startDmCall(PEER, false);
    expect(useDmCall.getState().active).not.toBeNull();
    await useCommunity.getState().joinVoice('voice-1', ME);
    expect(useDmCall.getState().active).toBeNull();
    expect(sent('end')).toHaveLength(1);
    expect(useCommunity.getState().call?.channelId).toBe('voice-1');
  });
});

describe('voice channels', () => {
  it('a double click joins once', async () => {
    await Promise.all([
      useCommunity.getState().joinVoice('voice-1', ME),
      useCommunity.getState().joinVoice('voice-1', ME),
    ]);
    expect(voiceJoin).toHaveBeenCalledTimes(1);
  });

  it('Disconnect while the microphone opens: no join, microphone off, no call shown', async () => {
    const pending = deferred<unknown>();
    mic = () => pending.promise;
    const joining = useCommunity.getState().joinVoice('voice-1', ME);
    await vi.waitFor(() => expect(useCommunity.getState().call).not.toBeNull());
    await useCommunity.getState().leaveVoice();
    pending.resolve(stream());
    await joining;
    expect(voiceJoin).not.toHaveBeenCalled();
    expect(tracks.every((t) => t.stopped)).toBe(true);
    expect(useCommunity.getState().call).toBeNull();
    expect(useCommunity.getState().callError).toBeNull();
  });

  it('starting a 1:1 call leaves voice on purpose (no "Rejoin" offer)', async () => {
    await useCommunity.getState().joinVoice('voice-1', ME);
    expect(lastCall()?.channelId).toBe('voice-1');
    await startDmCall(PEER, false);
    expect(lastCall()).toBeNull();
    expect(useCommunity.getState().call?.channelId).toBe(`dm:${PEER}`);
  });

  it('undeafening keeps you muted if you were muted before deafening', () => {
    const s = useCommunity.getState;
    s().toggleMute();
    expect(s().selfMuted).toBe(true);
    s().toggleDeafen();
    expect(s()).toMatchObject({ selfMuted: true, selfDeafened: true });
    s().toggleDeafen();
    expect(s()).toMatchObject({ selfMuted: true, selfDeafened: false });
    s().toggleMute();
    s().toggleDeafen();
    s().toggleDeafen();
    expect(s()).toMatchObject({ selfMuted: false, selfDeafened: false });
  });
});

describe("Android's own call screen (2.11)", () => {
  const ringPlayed = (): number => vi.mocked(play).mock.calls.filter(([s]) => s === 'ring').length;

  it('answered there before this window knew it rang: River answers it without ringing', async () => {
    vi.mocked(play).mockClear();
    handlePhoneCall({ callId: 'call-1', action: 'answer' });
    invite(true);
    await vi.waitFor(() => expect(sent('accept')).toHaveLength(1));
    expect(ringPlayed()).toBe(0);
    expect(useDmCall.getState().incoming).toBeNull();
    expect(useDmCall.getState().active).toMatchObject({ callId: 'call-1', video: true });
  });

  it('answered there while it rings here: River answers that call', async () => {
    invite();
    handlePhoneCall({ callId: 'call-1', action: 'answer' });
    await vi.waitFor(() => expect(sent('accept')).toHaveLength(1));
    expect(useDmCall.getState().incoming).toBeNull();
  });

  it('an answer for another call answers nothing', () => {
    invite();
    handlePhoneCall({ callId: 'call-2', action: 'answer' });
    expect(useDmCall.getState().incoming?.callId).toBe('call-1');
    expect(sent('accept')).toHaveLength(0);
  });

  it('declined there: it stops ringing here, and only the phone tells the caller and logs it', () => {
    invite();
    handlePhoneCall({ callId: 'call-1', action: 'decline' });
    expect(useDmCall.getState().incoming).toBeNull();
    expect(sent('decline')).toHaveLength(0);
    expect(logged()).toHaveLength(0);
  });

  it('the same call found again when the window opens is not "busy"', () => {
    invite();
    invite();
    expect(sent('busy')).toHaveLength(0);
    expect(useDmCall.getState().incoming?.callId).toBe('call-1');
  });

  it('while River is not on screen on Android, the phone rings instead of River', () => {
    vi.mocked(play).mockClear();
    useRiver.setState({ info: { platform: 'android' } } as unknown as Partial<
      ReturnType<typeof useRiver.getState>
    >);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      invite();
      expect(ringPlayed()).toBe(0);
      visibility.mockReturnValue('visible');
      handleCallEvent({ t: 'call', peer: PEER, callId: 'call-1', kind: 'end', video: false });
      invite();
      expect(ringPlayed()).toBe(1);
    } finally {
      visibility.mockRestore();
      useRiver.setState({ info: null } as unknown as Partial<ReturnType<typeof useRiver.getState>>);
    }
  });
});
