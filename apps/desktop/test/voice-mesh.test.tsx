import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceCall, type CallTransport } from '../src/renderer/src/community/voice.ts';
import type { RelayEngine } from '../src/renderer/src/community/relay-audio.ts';

/**
 * A simulated WebRTC network. Two fake peer connections "connect" once both
 * sides hold each other's current descriptions; the test can make a pair's
 * network fail, blip, or heal, and can drop or delay signals, to prove the
 * voice mesh always comes back together.
 */
class Net {
  readonly pcs: FakePC[] = [];
  /** Pairs ("a|b") whose direct path is broken: connections between them fail. */
  readonly broken = new Set<string>();
  created = 0;
  static key(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }
  /** Re-evaluates every connection (after a description changes or the network changes). */
  settle(): void {
    for (const pc of this.pcs) pc.evaluate();
  }
}

let net: Net;

class FakeSender {
  track: unknown = null;
  async replaceTrack(t: unknown): Promise<void> {
    this.track = t;
  }
  getParameters(): { encodings: unknown[] } {
    return { encodings: [] };
  }
  async setParameters(): Promise<void> {}
}

class FakePC {
  readonly owner: string;
  readonly uid: number;
  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  localDescription: { type: string; sdp: string; toJSON(): unknown } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  onicecandidate: ((e: { candidate: { toJSON(): unknown } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: (() => void) | null = null;
  private readonly transceivers: Array<{ sender: FakeSender; direction: string }> = [];
  private ufrag = 0;
  private closedFlag = false;

  constructor(config: { iceServers: Array<{ urls: string | string[] }> }) {
    // Each call tags its connections with a marker server naming its owner.
    const marker = config.iceServers.map((s) => String(s.urls)).find((u) => u.startsWith('stun:owner-'));
    this.owner = marker!.slice('stun:owner-'.length);
    this.uid = ++net.created;
    net.pcs.push(this);
  }
  addTransceiver(): { sender: FakeSender; direction: string } {
    const t = { sender: new FakeSender(), direction: 'sendrecv' };
    this.transceivers.push(t);
    return t;
  }
  getTransceivers(): Array<{ sender: FakeSender; direction: string }> {
    return this.transceivers;
  }
  async createOffer(opts?: { iceRestart?: boolean }): Promise<{ type: string; sdp: string }> {
    if (opts?.iceRestart || this.ufrag === 0) this.ufrag += 1;
    return { type: 'offer', sdp: `${this.uid}.${this.ufrag}` };
  }
  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: 'answer', sdp: `${this.uid}.${this.remoteDescription!.sdp}` };
  }
  async setLocalDescription(d: { type: string; sdp: string }): Promise<void> {
    if (this.closedFlag) throw new Error('closed');
    this.localDescription = { ...d, toJSON: () => ({ type: d.type, sdp: d.sdp }) };
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
    setTimeout(() => {
      if (this.closedFlag) return;
      this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: `c-${this.uid}` }) } });
    }, 1);
    net.settle();
  }
  async setRemoteDescription(d: { type: string; sdp: string }): Promise<void> {
    if (this.closedFlag) throw new Error('closed');
    if (d.type === 'answer' && this.signalingState !== 'have-local-offer') throw new Error('wrong state');
    this.remoteDescription = { type: d.type, sdp: d.sdp };
    if (d.type === 'offer') {
      this.signalingState = 'have-remote-offer';
      while (this.transceivers.length < 3) this.addTransceiver();
    } else {
      this.signalingState = 'stable';
    }
    net.settle();
  }
  async addIceCandidate(): Promise<void> {}
  close(): void {
    this.closedFlag = true;
    this.connectionState = 'closed';
    this.signalingState = 'closed';
    net.settle();
  }
  /** The other end of this connection, if both sides agree on the current descriptions. */
  partner(): FakePC | undefined {
    if (
      this.closedFlag ||
      this.signalingState !== 'stable' ||
      !this.localDescription ||
      !this.remoteDescription
    )
      return undefined;
    return net.pcs.find(
      (o) =>
        o !== this &&
        o.connectionState !== 'closed' &&
        o.signalingState === 'stable' &&
        o.localDescription?.sdp === this.remoteDescription!.sdp &&
        o.remoteDescription?.sdp === this.localDescription!.sdp,
    );
  }
  evaluate(): void {
    if (this.closedFlag) return;
    const p = this.partner();
    let next: RTCPeerConnectionState = this.connectionState;
    if (p) next = net.broken.has(Net.key(this.owner, p.owner)) ? 'failed' : 'connected';
    else if (this.connectionState === 'connected') {
      // The far end went away or is renegotiating: keep "connected" while it renegotiates.
      const stillThere = net.pcs.some(
        (o) =>
          o !== this &&
          o.connectionState !== 'closed' &&
          o.remoteDescription?.sdp === this.localDescription?.sdp,
      );
      if (!stillThere && this.signalingState === 'stable') next = 'disconnected';
    } else if (this.localDescription && this.connectionState === 'new') next = 'connecting';
    this.setState(next);
  }
  /** Network blip on an established connection. */
  blip(): void {
    this.setState('disconnected');
  }
  private setState(s: RTCPeerConnectionState): void {
    if (s === this.connectionState) return;
    this.connectionState = s;
    queueMicrotask(() => this.onconnectionstatechange?.());
  }
}

/** The server: relays signals in order between people in the channel; can drop chosen signals. */
class Relay {
  readonly calls = new Map<string, VoiceCall>();
  participants: string[] = [];
  /** Return true to drop a signal. */
  drop: (from: string, to: string, data: { type: string }) => boolean = () => false;
  sent = 0;
  transport(me: string): CallTransport {
    return {
      join: async () => {
        if (!this.participants.includes(me)) this.participants = [...this.participants, me];
        this.broadcast();
      },
      leave: async () => {
        this.participants = this.participants.filter((p) => p !== me);
        this.calls.delete(me);
        this.broadcast();
      },
      signal: (to, data) => {
        this.sent += 1;
        if (this.drop(me, to, data as { type: string })) return;
        setTimeout(() => void this.calls.get(to)?.handleSignal(me, data), 5);
      },
    };
  }
  broadcast(): void {
    const list = [...this.participants];
    setTimeout(() => {
      for (const c of this.calls.values()) c.updateParticipants(list);
    }, 2);
  }
}

let relay: Relay;

/** A relay engine without audio: tracks keys and recipients and passes frames through the "server". */
class FakeRelay implements RelayEngine {
  readonly available = true;
  readonly keys = new Map<string, string>();
  recipients: string[] = [];
  readonly got = new Map<string, number>();
  private readonly raw: Uint8Array;
  readonly me: string;
  private readonly hub: Map<string, VoiceCall>;
  constructor(me: string, hub: Map<string, VoiceCall>) {
    this.me = me;
    this.hub = hub;
    this.raw = new Uint8Array(32).fill(me.charCodeAt(7));
  }
  async start(): Promise<void> {}
  setMic(): void {}
  setTransmitting(): void {}
  setRecipients(ids: string[]): void {
    this.recipients = ids;
  }
  ownKey(): Uint8Array {
    return this.raw;
  }
  async setPeerKey(id: string, raw: Uint8Array): Promise<void> {
    this.keys.set(id, String(raw[0]));
  }
  receive(from: string): void {
    if (this.keys.has(from)) this.got.set(from, (this.got.get(from) ?? 0) + 1);
  }
  streamFor(): MediaStream {
    return { getAudioTracks: () => [] } as unknown as MediaStream;
  }
  received(id: string): number {
    return this.got.get(id) ?? 0;
  }
  dropPeer(id: string): void {
    this.keys.delete(id);
  }
  close(): void {}
  /** One voice frame to everyone currently relayed to. */
  talk(): void {
    for (const to of this.recipients) this.hub.get(to)?.receiveRelay(this.me, new Uint8Array([1]));
  }
}
const relays = new Map<string, FakeRelay>();

async function joinCall(id: string, withRelay = false): Promise<VoiceCall> {
  const fake = withRelay ? new FakeRelay(id, relay.calls) : null;
  if (fake) relays.set(id, fake);
  const call = new VoiceCall(
    'chan',
    id,
    () => undefined,
    { iceServers: [{ urls: `stun:owner-${id}` }] },
    relay.transport(id),
    fake,
  );
  relay.calls.set(id, call);
  await call.start();
  return call;
}

/** Each call's peers, keyed by owner, as "connected" etc. */
function states(calls: VoiceCall[]): Record<string, Record<string, string>> {
  return Object.fromEntries(
    calls.map((c) => [
      (c as unknown as { me: string }).me,
      Object.fromEntries(c.remotes().map((r) => [r.id, r.state])),
    ]),
  );
}

function fullMesh(calls: VoiceCall[]): boolean {
  return calls.every((c) => {
    const others = calls.filter((o) => o !== c).map((o) => (o as unknown as { me: string }).me);
    const remotes = c.remotes();
    return others.every((id) => remotes.find((r) => r.id === id)?.state === 'connected');
  });
}

async function runUntil(cond: () => boolean, maxMs = 120_000): Promise<void> {
  for (let t = 0; t < maxMs; t += 50) {
    if (cond()) return;
    await vi.advanceTimersByTimeAsync(50);
  }
  throw new Error('condition not reached');
}

beforeEach(() => {
  vi.useFakeTimers();
  net = new Net();
  relay = new Relay();
  relays.clear();
  globalThis.RTCPeerConnection = FakePC as unknown as typeof RTCPeerConnection;
  globalThis.MediaStream = class {} as unknown as typeof MediaStream;
  (globalThis as { window?: unknown }).window = globalThis;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({ getAudioTracks: () => [{ enabled: true, stop: () => undefined }] }),
      },
    },
  });
});

afterEach(async () => {
  for (const c of relay.calls.values()) await c.leave();
  vi.useRealTimers();
});

const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `0000000${i}-0000-4000-8000-000000000000`);

describe('voice mesh', () => {
  it('four people joining one after another all hear each other', async () => {
    const calls: VoiceCall[] = [];
    for (const id of ids(4)) {
      calls.push(await joinCall(id));
      await vi.advanceTimersByTimeAsync(300);
    }
    await runUntil(() => fullMesh(calls));
    expect(states(calls)).toBeTruthy();
  });

  it('six people joining at the same moment form a full mesh', async () => {
    const calls = await Promise.all(ids(6).map((id) => joinCall(id)));
    await runUntil(() => fullMesh(calls));
  });

  it('a lost offer is asked for again and the pair connects', async () => {
    const [a, b] = ids(2);
    let dropped = 0;
    relay.drop = (from, _to, data) => from === a && data.type === 'sdp' && dropped++ === 0;
    const calls = [await joinCall(a!), await joinCall(b!)];
    await runUntil(() => fullMesh(calls));
    expect(dropped).toBeGreaterThan(0);
  });

  it('a lost answer gets the connection rebuilt', async () => {
    const [a, b] = ids(2);
    let dropped = 0;
    relay.drop = (from, _to, data) => from === b && data.type === 'sdp' && dropped++ === 0;
    const calls = [await joinCall(a!), await joinCall(b!)];
    await runUntil(() => fullMesh(calls));
  });

  it('a pair whose path keeps failing is retried without giving up, and connects once the path works', async () => {
    const people = ids(3);
    net.broken.add(Net.key(people[0]!, people[2]!));
    const calls = await Promise.all(people.map((id) => joinCall(id)));
    // Two minutes of failures: far beyond the old four-retry limit.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fullMesh(calls)).toBe(false);
    net.broken.clear();
    net.settle();
    await runUntil(() => fullMesh(calls));
  });

  it('a network blip is healed by an ICE restart on the same connection', async () => {
    const calls = await Promise.all(ids(2).map((id) => joinCall(id)));
    await runUntil(() => fullMesh(calls));
    const before = net.created;
    const live = net.pcs.filter((p) => p.connectionState === 'connected');
    for (const pc of live) pc.blip();
    await runUntil(() => fullMesh(calls) && live.every((p) => p.connectionState === 'connected'));
    expect(net.created).toBe(before); // no new connection was needed
  });

  it('keeps working connections while the participant list briefly loses someone (server restart)', async () => {
    const people = ids(3);
    const calls = await Promise.all(people.map((id) => joinCall(id)));
    await runUntil(() => fullMesh(calls));
    const before = net.created;
    // The server restarted and only one person has rejoined so far.
    for (const c of calls) c.resumed();
    for (const c of calls) c.updateParticipants([people[0]!]);
    await vi.advanceTimersByTimeAsync(3000);
    for (const c of calls) c.updateParticipants(people);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fullMesh(calls)).toBe(true);
    expect(net.created).toBe(before);
  });

  it('someone who really left is dropped after the grace period', async () => {
    const people = ids(3);
    const calls = await Promise.all(people.map((id) => joinCall(id)));
    await runUntil(() => fullMesh(calls));
    await calls[2]!.leave();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(calls[0]!.remotes().map((r) => r.id)).toEqual([people[1]]);
    expect(calls[1]!.remotes().map((r) => r.id)).toEqual([people[0]]);
  });

  it('someone leaving while their connection still looks fine disappears at once', async () => {
    const people = ids(3);
    const calls = await Promise.all(people.map((id) => joinCall(id)));
    await runUntil(() => fullMesh(calls));
    // Real WebRTC notices a closed far end only seconds later: the list is what counts.
    for (const c of calls.slice(0, 2)) c.updateParticipants(people.slice(0, 2));
    expect(calls[0]!.remotes().map((r) => r.id)).toEqual([people[1]]);
    expect(calls[1]!.remotes().map((r) => r.id)).toEqual([people[0]]);
  });

  it('after a server restart, someone who never comes back is dropped when the grace ends', async () => {
    const people = ids(3);
    const calls = await Promise.all(people.map((id) => joinCall(id)));
    await runUntil(() => fullMesh(calls));
    for (const c of calls) c.resumed();
    for (const c of calls.slice(0, 2)) c.updateParticipants(people.slice(0, 2));
    expect(calls[0]!.remotes()).toHaveLength(2); // kept for now
    await vi.advanceTimersByTimeAsync(11_000);
    expect(calls[0]!.remotes().map((r) => r.id)).toEqual([people[1]]);
  });

  it('a late joiner connects to everyone already talking', async () => {
    const people = ids(5);
    const first = await Promise.all(people.slice(0, 4).map((id) => joinCall(id)));
    await runUntil(() => fullMesh(first));
    const late = await joinCall(people[4]!);
    await runUntil(() => fullMesh([...first, late]));
  });

  it('a call that left stops all its timers and signals', async () => {
    const calls = await Promise.all(ids(2).map((id) => joinCall(id)));
    await runUntil(() => fullMesh(calls));
    for (const c of calls) await c.leave();
    const sent = relay.sent;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(relay.sent).toBe(sent);
  });

  describe('relay through the server', () => {
    const relayedPairs = (calls: VoiceCall[]) =>
      calls.flatMap((c) =>
        c
          .remotes()
          .filter((r) => r.relayed)
          .map((r) => `${(c as unknown as { me: string }).me.slice(7, 8)}>${r.id.slice(7, 8)}`),
      );

    it('a pair that cannot connect directly talks through the server, encrypted, and nobody else does', async () => {
      const people = ids(3);
      net.broken.add(Net.key(people[0]!, people[2]!));
      const calls = await Promise.all(people.map((id) => joinCall(id, true)));
      await runUntil(() => relayedPairs(calls).length === 2, 30_000);
      expect(relayedPairs(calls).sort()).toEqual(['0>2', '2>0']);
      // Keys were exchanged both ways, so each side can open the other's frames.
      const [r0, , r2] = people.map((id) => relays.get(id)!);
      expect(r0!.recipients).toEqual([people[2]]);
      expect(r2!.recipients).toEqual([people[0]]);
      r0!.talk();
      r2!.talk();
      expect(r2!.received(people[0]!)).toBe(1);
      expect(r0!.received(people[2]!)).toBe(1);
      expect(relays.get(people[1]!)!.recipients).toEqual([]);
    });

    it('switches back to the direct connection once it works', async () => {
      const people = ids(2);
      net.broken.add(Net.key(people[0]!, people[1]!));
      const calls = await Promise.all(people.map((id) => joinCall(id, true)));
      await runUntil(() => relayedPairs(calls).length === 2, 30_000);
      net.broken.clear();
      net.settle();
      await runUntil(() => fullMesh(calls) && relayedPairs(calls).length === 0);
      for (const id of people) expect(relays.get(id)!.recipients).toEqual([]);
    });

    it('stops relaying to someone who left', async () => {
      const people = ids(2);
      net.broken.add(Net.key(people[0]!, people[1]!));
      const calls = await Promise.all(people.map((id) => joinCall(id, true)));
      await runUntil(() => relayedPairs(calls).length === 2, 30_000);
      await calls[1]!.leave();
      await vi.advanceTimersByTimeAsync(100);
      expect(relays.get(people[0]!)!.recipients).toEqual([]);
    });

    it('direct pairs never use the relay', async () => {
      const calls = await Promise.all(ids(4).map((id) => joinCall(id, true)));
      await runUntil(() => fullMesh(calls));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(relayedPairs(calls)).toEqual([]);
    });
  });
});
