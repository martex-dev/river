// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallTransport, RemotePeer } from '../src/renderer/src/community/voice.ts';

/**
 * A connected 1:1 call whose other side vanished, and a relayed call that only claims to be
 * connected once sound arrives (2.11.3). The call's media is a stand-in: these tests decide what
 * the connection looks like.
 */

vi.mock(import('../src/renderer/src/community/sound.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  play: vi.fn(),
}));

const calls: FakeCall[] = [];

class FakeCall {
  readonly channelId: string;
  readonly me: string;
  readonly onChange: () => void;
  readonly transport: CallTransport;
  nameOf: (id: string) => string = (id) => id;
  muted = false;
  deafened = false;
  closed = false;
  remote: RemotePeer | null = null;
  heard = 0;
  constructor(
    channelId: string,
    me: string,
    onChange: () => void,
    _options: unknown,
    transport: CallTransport,
  ) {
    this.channelId = channelId;
    this.me = me;
    this.onChange = onChange;
    this.transport = transport;
    calls.push(this);
  }
  async start(): Promise<void> {
    await this.transport.join();
  }
  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.transport.leave();
  }
  remotes(): RemotePeer[] {
    return this.remote ? [this.remote] : [];
  }
  lastHeard(): number {
    return this.remote?.state === 'connected' ? Date.now() : this.heard;
  }
  updateParticipants(ids: string[]): void {
    const peer = ids.find((id) => id !== this.me);
    if (peer && !this.remote)
      this.remote = {
        id: peer,
        audio: null,
        camera: null,
        screen: null,
        cameraOn: false,
        screenOn: false,
        muted: false,
        state: 'new',
        reconnecting: false,
        relayed: false,
        relayFlowing: false,
      };
  }
  async setCamera(): Promise<void> {}
  async handleSignal(): Promise<void> {}
  /** What the connection does next, as the real call reports it. */
  set(change: Partial<RemotePeer>): void {
    Object.assign(this.remote!, change);
    this.onChange();
  }
}

vi.mock(import('../src/renderer/src/community/voice.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  VoiceCall: FakeCall as never,
}));

const { useCommunity } = await import('../src/renderer/src/community/store.ts');
const { useRiver } = await import('../src/renderer/src/store.ts');
const { CALL_LOST_MS, CONNECT_TIMEOUT_MS, acceptDmCall, endDmCall, handleCallEvent, useDmCall } =
  await import('../src/renderer/src/dm/call.ts');

const ME = '0000000f-0000-4000-8000-000000000000';
const PEER = '00000001-0000-4000-8000-000000000000';
const dmAction = vi.fn();
const sent = (kind: string): unknown[] =>
  dmAction.mock.calls
    .map(([a]) => a as { a: string; kind?: string })
    .filter((a) => a.a === 'call' && a.kind === kind);

async function answered(): Promise<FakeCall> {
  handleCallEvent({ t: 'call', peer: PEER, callId: 'call-1', kind: 'invite', video: false });
  const accepting = acceptDmCall(false);
  await vi.advanceTimersByTimeAsync(0);
  await accepting;
  expect(useDmCall.getState().active?.state).toBe('connecting');
  return calls.at(-1)!;
}

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  dmAction.mockReset();
  dmAction.mockResolvedValue({ ok: true, value: null });
  (window as unknown as { river: unknown }).river = {
    dm: { action: dmAction },
    voice: { iceServers: async () => [], callRoom: vi.fn(), relay: vi.fn(), setSpeaker: vi.fn() },
  };
  useRiver.setState({
    identity: { riverId: ME, displayName: 'Me' },
    navigate: vi.fn(),
  } as unknown as Partial<ReturnType<typeof useRiver.getState>>);
  useCommunity.setState({ call: null, selfMuted: false, selfDeafened: false, communities: [] });
  useDmCall.setState({ incoming: null, active: null });
});

afterEach(async () => {
  await endDmCall();
  vi.useRealTimers();
});

describe('1:1 calls that lose the other side (2.11.3)', () => {
  it('a relayed call says "Connected" only once their voice really arrives through the server', async () => {
    const call = await answered();
    // The relay is on, but nothing has come through it yet: still connecting.
    call.set({ relayed: true, relayFlowing: false });
    expect(useDmCall.getState().active?.state).toBe('connecting');
    call.set({ relayFlowing: true });
    expect(useDmCall.getState().active?.state).toBe('connected');
  });

  it('a relay that never carries a sound ends at the connect timeout', async () => {
    const call = await answered();
    call.set({ relayed: true, relayFlowing: false });
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    expect(useDmCall.getState().active).toBeNull();
    expect(useCommunity.getState().toast?.text).toMatch(/could not connect/);
  });

  it('a connected call ends with "The call was lost" when the other side vanishes', async () => {
    const call = await answered();
    call.set({ state: 'connected' });
    expect(useDmCall.getState().active?.state).toBe('connected');
    // A minute of a working call: nothing happens.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useDmCall.getState().active?.state).toBe('connected');
    // Their side is gone: no direct connection, nothing through the server.
    call.set({ state: 'failed' });
    await vi.advanceTimersByTimeAsync(CALL_LOST_MS - 10_000);
    expect(useDmCall.getState().active).not.toBeNull();
    for (let i = 0; i < 3 && useDmCall.getState().active; i++) await vi.advanceTimersByTimeAsync(5000);
    expect(useDmCall.getState().active).toBeNull();
    expect(useCommunity.getState().toast?.text).toBe('The call was lost.');
    expect(sent('end')).toHaveLength(1);
  });

  it('voice still arriving through the server keeps a call whose direct connection failed', async () => {
    const call = await answered();
    call.set({ state: 'connected' });
    call.set({ state: 'failed', relayed: true, relayFlowing: true });
    for (let i = 0; i < 24; i++) {
      call.heard = Date.now();
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(useDmCall.getState().active?.state).toBe('connected');
  });
});
