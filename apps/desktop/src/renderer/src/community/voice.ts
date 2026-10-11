/**
 * Voice/video calls as a WebRTC mesh: every participant connects directly to
 * every other participant. Media is encrypted with DTLS-SRTP between the two
 * computers; the River server only relays connection setup, and that setup is
 * itself sealed with the community key. Fine for small groups (≈10 people).
 *
 * Each connection carries three fixed slots (audio, camera, screen). Turning
 * the camera or screen on/off swaps the track in its slot, so no renegotiation
 * is needed after the call is set up.
 */

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
];
const SLOTS = ['audio', 'camera', 'screen'] as const;
type Slot = (typeof SLOTS)[number];

/**
 * `sid` names one connection attempt (set by the offering side), so answers and
 * candidates from an attempt that was since replaced are ignored. Apps before
 * 1.0.16 send no `sid`; those signals are always accepted.
 */
type Signal =
  | { type: 'sdp'; description: RTCSessionDescriptionInit; sid?: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit; sid?: string }
  /** Sent by the answering side when no offer arrived: "please (re)offer". */
  | { type: 'hello' }
  /** Sent by the answering side when a working connection falters: "please restart ICE". */
  | { type: 'restart'; sid?: string }
  /** What the sender is currently sending; receivers show tiles from this, not from track heuristics. */
  | { type: 'state'; camera: boolean; screen: boolean; muted: boolean };

/** Answering side asks for an offer after this long without one (then less and less often). */
const OFFER_WAIT_MS = 3000;
/** A connection that is not up after this long is rebuilt. */
const CONNECT_TIMEOUT_MS = 20_000;
/** A setup this old no longer counts as "underway" when the other side asks for a new one. */
const STALE_SETUP_MS = 10_000;
/** A connection reported "disconnected" this long gets an ICE restart. */
const DISCONNECTED_GRACE_MS = 3000;
/** An ICE restart that has not reconnected after this long is replaced by a new connection. */
const RESTART_TIMEOUT_MS = 8000;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15_000;
/** Someone missing from the participant list keeps their working connection this long (server restart). */
const MISSING_GRACE_MS = 10_000;

function newSid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes));
}

export interface RemotePeer {
  id: string;
  audio: MediaStream | null;
  camera: MediaStream | null;
  screen: MediaStream | null;
  cameraOn: boolean;
  screenOn: boolean;
  muted: boolean;
  state: RTCPeerConnectionState;
  /** The connection dropped and River is bringing it back. */
  reconnecting: boolean;
}

interface Peer {
  pc: RTCPeerConnection;
  /** This connection attempt's ID (see Signal). */
  sid: string | undefined;
  createdAt: number;
  everConnected: boolean;
  /** An ICE restart was tried since the connection last worked. */
  restarted: boolean;
  timers: Set<ReturnType<typeof setTimeout>>;
  remote: RemotePeer;
  /** Remote candidates that arrived before the remote description. */
  pendingIce: RTCIceCandidateInit[];
  /** Our candidates are held until our SDP has been sent, so they never overtake it. */
  sdpSent: boolean;
  outgoingIce: RTCIceCandidateInit[];
}

/** How a call joins, leaves and exchanges connection setup with peers. */
export interface CallTransport {
  join(): Promise<void>;
  leave(): Promise<void>;
  signal(to: string, data: unknown): void;
}

/** Community voice channels: the server tracks participants and relays sealed signals. */
export function channelTransport(channelId: string): CallTransport {
  return {
    join: async () => {
      const res = await window.river.voice.join(channelId);
      if (!res.ok) throw new Error(res.message);
    },
    leave: async () => {
      await window.river.voice.leave();
    },
    signal: (to, data) => {
      void window.river.voice.signal(to, channelId, data).then((r) => {
        if (!r.ok) console.warn(`signal to ${to.slice(0, 4)} failed: ${r.message}`);
      });
    },
  };
}

export interface CallOptions {
  /** Extra STUN/TURN servers (TURN relays from the River server). */
  iceServers: RTCIceServer[];
  inputDeviceId: string | null;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  pushToTalk: boolean;
}

const SPEAKING_THRESHOLD = 0.035;
const SPEAKING_HOLD_MS = 350;

interface Analyser {
  node: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  track: MediaStreamTrack;
}

export class VoiceCall {
  readonly channelId: string;
  private readonly me: string;
  private options: CallOptions;
  private audioCtx: AudioContext | null = null;
  private readonly analysers = new Map<string, Analyser>();
  private readonly lastLoud = new Map<string, number>();
  private speakingTimer: ReturnType<typeof setInterval> | null = null;
  /** River IDs (including our own) currently speaking. */
  speaking = new Set<string>();
  deafened = false;
  serverMuted = false;
  /** Push-to-talk key is held. */
  pttActive = false;
  private readonly peers = new Map<string, Peer>();
  /** Candidates from peers we have not created yet (they can overtake the offer). */
  private readonly earlyIce = new Map<string, Array<{ candidate: RTCIceCandidateInit; sid?: string }>>();
  private participants: string[] = [];
  private readonly retries = new Map<string, number>();
  private readonly signalQueues = new Map<string, Promise<void>>();
  /** Peers we are waiting on for an offer. */
  private readonly awaiting = new Set<string>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** When each person went missing from the participant list. */
  private readonly missingSince = new Map<string, number>();
  /** The server's latest participant list (without people kept through a gap). */
  private listed: string[] = [];
  /** When our own connection to the server last came back (participant lists refill after that). */
  private resumedAt = 0;
  private local: Record<Slot, MediaStreamTrack | null> = { audio: null, camera: null, screen: null };
  private readonly onChange: () => void;
  muted = false;
  closed = false;

  private readonly transport: CallTransport;

  constructor(
    channelId: string,
    me: string,
    onChange: () => void,
    options?: Partial<CallOptions>,
    transport?: CallTransport,
  ) {
    this.channelId = channelId;
    this.transport = transport ?? channelTransport(channelId);
    this.me = me;
    this.onChange = onChange;
    this.options = {
      iceServers: [],
      inputDeviceId: null,
      noiseSuppression: true,
      echoCancellation: true,
      pushToTalk: false,
      ...options,
    };
  }

  /** Inbound/outbound media statistics for diagnostics (no content). */
  async stats(): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const p of this.peers.values()) {
      const report = await p.pc.getStats();
      report.forEach((r: { type: string; kind?: string }) => {
        if ((r.type === 'inbound-rtp' || r.type === 'outbound-rtp') && r.kind === 'video') out.push(r);
      });
    }
    return out;
  }

  private async microphone(): Promise<MediaStreamTrack | null> {
    const audio: MediaTrackConstraints = {
      echoCancellation: this.options.echoCancellation,
      noiseSuppression: this.options.noiseSuppression,
      autoGainControl: true,
      ...(this.options.inputDeviceId ? { deviceId: { exact: this.options.inputDeviceId } } : {}),
    };
    try {
      return (await navigator.mediaDevices.getUserMedia({ audio, video: false })).getAudioTracks()[0] ?? null;
    } catch (err) {
      // The saved device may be unplugged: fall back to the default microphone.
      if (!this.options.inputDeviceId || (err as Error).name !== 'OverconstrainedError') throw err;
      this.options.inputDeviceId = null;
      return this.microphone();
    }
  }

  async start(): Promise<void> {
    this.local.audio = await this.microphone();
    this.applyMic();
    this.watch(this.me, this.local.audio);
    try {
      await this.transport.join();
    } catch (err) {
      this.stopLocal();
      throw err;
    }
    this.speakingTimer = setInterval(() => this.measure(), 80);
  }

  /** Whether our microphone is actually transmitting right now. */
  get transmitting(): boolean {
    return !this.muted && !this.deafened && !this.serverMuted && (!this.options.pushToTalk || this.pttActive);
  }

  get pushToTalk(): boolean {
    return this.options.pushToTalk;
  }

  private applyMic(): void {
    if (this.local.audio) this.local.audio.enabled = this.transmitting;
  }

  async updateOptions(next: Partial<CallOptions>): Promise<void> {
    const deviceChanged =
      next.inputDeviceId !== undefined && next.inputDeviceId !== this.options.inputDeviceId;
    const processingChanged =
      (next.noiseSuppression !== undefined && next.noiseSuppression !== this.options.noiseSuppression) ||
      (next.echoCancellation !== undefined && next.echoCancellation !== this.options.echoCancellation);
    this.options = { ...this.options, ...next };
    if ((deviceChanged || processingChanged) && !this.closed) {
      const track = await this.microphone();
      await this.setSlot('audio', track);
      this.watch(this.me, track);
    }
    this.applyMic();
    this.broadcastState();
    this.onChange();
  }

  setPushToTalkActive(active: boolean): void {
    if (this.pttActive === active) return;
    this.pttActive = active;
    this.applyMic();
    this.broadcastState();
    this.onChange();
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    this.applyMic();
    this.broadcastState();
    this.onChange();
  }

  setServerMuted(serverMuted: boolean): void {
    if (this.serverMuted === serverMuted) return;
    this.serverMuted = serverMuted;
    this.applyMic();
    this.broadcastState();
    this.onChange();
  }

  // ---- speaking detection -----------------------------------------------------------------------

  private watch(id: string, track: MediaStreamTrack | null): void {
    const existing = this.analysers.get(id);
    if (existing?.track === track) return;
    existing?.source.disconnect();
    this.analysers.delete(id);
    if (!track) return;
    try {
      this.audioCtx ??= new AudioContext();
      const source = this.audioCtx.createMediaStreamSource(new MediaStream([track]));
      const node = this.audioCtx.createAnalyser();
      node.fftSize = 512;
      source.connect(node);
      this.analysers.set(id, { node, source, track });
    } catch {
      // No audio context available: no speaking indicators.
    }
  }

  private measure(): void {
    const now = performance.now();
    const buf = new Float32Array(512);
    let changed = false;
    for (const [id, a] of this.analysers) {
      a.node.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const live = id === this.me ? this.transmitting : !(this.peers.get(id)?.remote.muted ?? false);
      if (live && rms > SPEAKING_THRESHOLD) this.lastLoud.set(id, now);
      const speaking = live && now - (this.lastLoud.get(id) ?? 0) < SPEAKING_HOLD_MS;
      if (speaking !== this.speaking.has(id)) {
        if (speaking) this.speaking.add(id);
        else this.speaking.delete(id);
        changed = true;
      }
    }
    if (changed) this.onChange();
  }

  remotes(): RemotePeer[] {
    return [...this.peers.values()].map((p) => p.remote);
  }

  localTrack(slot: Slot): MediaStreamTrack | null {
    return this.local[slot];
  }

  /**
   * Our connection to the server just came back. The server may have
   * restarted and be refilling its participant lists as people reconnect, so
   * for a short while someone missing from the list keeps their connection.
   */
  resumed(): void {
    this.resumedAt = Date.now();
  }

  /** Called with the server's participant list for this channel. */
  updateParticipants(ids: string[]): void {
    if (this.closed) return;
    const now = Date.now();
    this.listed = ids;
    const refilling = now - this.resumedAt < MISSING_GRACE_MS;
    for (const id of [...this.peers.keys()]) {
      if (ids.includes(id)) {
        this.missingSince.delete(id);
        continue;
      }
      // A working connection outlives a short gap in the list (the server restarting); others go now.
      const peer = this.peers.get(id)!;
      if (!refilling || peer.pc.connectionState !== 'connected') {
        this.missingSince.delete(id);
        this.dropPeer(id);
        continue;
      }
      if (!this.missingSince.has(id)) {
        this.missingSince.set(id, now);
        this.later(MISSING_GRACE_MS, () => {
          if (this.missingSince.has(id) && !this.listed.includes(id)) {
            this.missingSince.delete(id);
            this.dropPeer(id);
            this.onChange();
          }
        });
      }
    }
    this.participants = [...ids, ...[...this.missingSince.keys()].filter((id) => !ids.includes(id))];
    for (const id of ids) {
      if (id === this.me || this.peers.has(id)) continue;
      // The participant with the smaller ID makes the offer, so each pair negotiates once.
      if (this.me < id) void this.offer(id);
      else this.awaitOffer(id);
    }
    this.onChange();
  }

  /**
   * Signals from one peer are handled strictly in order: an answer or ICE
   * candidate must never be processed before the offer it belongs to.
   */
  handleSignal(from: string, data: unknown): Promise<void> {
    const prev = this.signalQueues.get(from) ?? Promise.resolve();
    const next = prev
      .then(() => this.processSignal(from, data))
      .catch((err: unknown) => console.warn(`voice: signal from ${from.slice(0, 4)} failed`, err));
    this.signalQueues.set(from, next);
    return next;
  }

  private async processSignal(from: string, data: unknown): Promise<void> {
    if (this.closed) return;
    const signal = data as Signal;
    if (signal.type === 'hello') {
      // The other side has no working connection with us: (re)offer unless one is healthy or underway.
      if (this.me < from && this.participants.includes(from)) {
        const peer = this.peers.get(from);
        if (!peer || !this.healthy(peer)) this.rebuild(from);
      }
      return;
    }
    if (signal.type === 'restart') {
      // The answering side saw the connection falter: restart ICE on the existing connection.
      const peer = this.peers.get(from);
      if (this.me < from && peer && (signal.sid === undefined || signal.sid === peer.sid)) {
        await this.iceRestart(peer);
      } else if (this.me < from && !peer && this.participants.includes(from)) {
        this.rebuild(from);
      }
      return;
    }
    if (signal.type === 'state') {
      const peer = this.peers.get(from);
      if (peer) {
        peer.remote.cameraOn = !!signal.camera;
        peer.remote.screenOn = !!signal.screen;
        peer.remote.muted = !!signal.muted;
        this.onChange();
      }
      return;
    }
    if (signal.type === 'sdp') {
      const desc = signal.description;
      if (desc.type === 'offer') {
        let peer = this.peers.get(from);
        const renegotiation = !!peer && signal.sid !== undefined && peer.sid === signal.sid;
        if (!peer || !renegotiation) {
          this.dropPeer(from);
          peer = this.createPeer(from, signal.sid);
        }
        await peer.pc.setRemoteDescription(desc);
        if (!renegotiation) {
          peer.pc.getTransceivers().forEach((t, i) => {
            t.direction = 'sendrecv';
            void t.sender.replaceTrack(this.local[SLOTS[i]!] ?? null).catch(() => undefined);
          });
        }
        await this.flushIce(peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        if (this.peers.get(from) !== peer) return; // replaced meanwhile
        this.sendSdp(from, peer);
        if (!renegotiation) this.tuneScreenSender(peer);
        this.onChange();
      } else {
        const peer = this.peers.get(from);
        // An answer to an offer we have since replaced is stale: applying it would break the new one.
        if (!peer || (signal.sid !== undefined && signal.sid !== peer.sid)) return;
        if (peer.pc.signalingState !== 'have-local-offer') return;
        await peer.pc.setRemoteDescription(desc);
        await this.flushIce(peer);
      }
    } else if (signal.type === 'ice') {
      const peer = this.peers.get(from);
      if (!peer) {
        const early = this.earlyIce.get(from) ?? [];
        if (early.length < 50) early.push({ candidate: signal.candidate, sid: signal.sid });
        this.earlyIce.set(from, early);
        return;
      }
      if (signal.sid !== undefined && peer.sid !== undefined && signal.sid !== peer.sid) return;
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal.candidate).catch(() => undefined);
      else peer.pendingIce.push(signal.candidate);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMic();
    this.broadcastState();
    this.onChange();
  }

  async setCamera(on: boolean): Promise<void> {
    if (on && !this.local.camera) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
      await this.setSlot('camera', stream.getVideoTracks()[0] ?? null);
    } else if (!on && this.local.camera) {
      await this.setSlot('camera', null);
    }
  }

  /** Call after the user picked a screen/window with window.river.voice.selectScreen(). */
  async setScreen(on: boolean): Promise<void> {
    if (on && !this.local.screen) {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: false,
      });
      const track = stream.getVideoTracks()[0] ?? null;
      if (track) {
        track.contentHint = 'detail';
        track.onended = () => void this.setScreen(false);
      }
      await this.setSlot('screen', track);
    } else if (!on && this.local.screen) {
      await this.setSlot('screen', null);
    }
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.speakingTimer) clearInterval(this.speakingTimer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.stopLocal();
    for (const a of this.analysers.values()) a.source.disconnect();
    this.analysers.clear();
    void this.audioCtx?.close().catch(() => undefined);
    await this.transport.leave().catch(() => undefined);
    this.onChange();
  }

  // ---- internals -------------------------------------------------------------------------------

  private async setSlot(slot: Slot, track: MediaStreamTrack | null): Promise<void> {
    this.local[slot]?.stop();
    this.local[slot] = track;
    const index = SLOTS.indexOf(slot);
    await Promise.all(
      [...this.peers.values()].map((p) => {
        const sender = p.pc.getTransceivers()[index]?.sender;
        return sender?.replaceTrack(track).catch(() => undefined);
      }),
    );
    this.broadcastState();
    this.onChange();
  }

  private createPeer(id: string, sid?: string): Peer {
    const pc = new RTCPeerConnection({
      iceServers: [...ICE_SERVERS, ...this.options.iceServers],
      bundlePolicy: 'max-bundle',
    });
    const peer: Peer = {
      pc,
      sid,
      createdAt: Date.now(),
      everConnected: false,
      restarted: false,
      remote: {
        id,
        audio: null,
        camera: null,
        screen: null,
        cameraOn: false,
        screenOn: false,
        muted: false,
        state: 'new',
        reconnecting: false,
      },
      pendingIce: [],
      sdpSent: false,
      outgoingIce: [],
      timers: new Set(),
    };
    for (const early of this.earlyIce.get(id) ?? [])
      if (early.sid === undefined || sid === undefined || early.sid === sid)
        peer.pendingIce.push(early.candidate);
    this.earlyIce.delete(id);
    pc.onicecandidate = (e) => {
      if (!e.candidate || this.peers.get(id) !== peer) return;
      const candidate = e.candidate.toJSON();
      if (peer.sdpSent) this.send(id, { type: 'ice', candidate, ...(peer.sid ? { sid: peer.sid } : {}) });
      else peer.outgoingIce.push(candidate);
    };
    pc.onconnectionstatechange = () => this.connectionChanged(id, peer);
    pc.ontrack = (e) => {
      const slot = SLOTS[pc.getTransceivers().indexOf(e.transceiver)];
      if (!slot) return;
      peer.remote[slot] = new MediaStream([e.track]);
      if (slot === 'audio') this.watch(id, e.track);
      this.onChange();
    };
    this.peers.set(id, peer);
    // A connection that never comes up is rebuilt rather than left hanging.
    this.peerTimer(peer, CONNECT_TIMEOUT_MS, () => {
      if (pc.connectionState !== 'connected') this.recover(id, peer, 'timeout');
    });
    return peer;
  }

  private connectionChanged(id: string, peer: Peer): void {
    if (this.peers.get(id) !== peer || this.closed) return;
    const state = peer.pc.connectionState;
    peer.remote.state = state;
    if (state === 'connected') {
      this.retries.delete(id);
      peer.remote.reconnecting = false;
      peer.everConnected = true;
      peer.restarted = false;
      this.send(id, this.stateSignal());
    } else if (state === 'disconnected') {
      // Often a short network blip that heals by itself; if not, restart ICE (audio may keep flowing).
      peer.remote.reconnecting = true;
      this.peerTimer(peer, DISCONNECTED_GRACE_MS, () => {
        if (peer.pc.connectionState === 'disconnected') this.recover(id, peer, 'disconnected');
      });
    } else if (state === 'failed') {
      peer.remote.reconnecting = true;
      this.recover(id, peer, 'failed');
    }
    this.onChange();
  }

  /**
   * Brings a faltering connection back: first an ICE restart on the same
   * connection, then a fresh connection, retried with backoff for as long as
   * the person is still in the channel.
   */
  private recover(id: string, peer: Peer, why: 'disconnected' | 'failed' | 'timeout'): void {
    if (this.closed || this.peers.get(id) !== peer || !this.participants.includes(id)) return;
    if (why === 'disconnected' && peer.everConnected && !peer.restarted) {
      peer.restarted = true;
      if (this.me < id) void this.iceRestart(peer);
      else this.send(id, { type: 'restart', ...(peer.sid ? { sid: peer.sid } : {}) });
      // If the restart does not bring it back, rebuild.
      this.peerTimer(peer, RESTART_TIMEOUT_MS, () => {
        if (peer.pc.connectionState !== 'connected') this.recover(id, peer, 'failed');
      });
      return;
    }
    const n = (this.retries.get(id) ?? 0) + 1;
    this.retries.set(id, n);
    const delay = Math.min(RETRY_BASE_MS * 2 ** Math.min(n - 1, 4), RETRY_MAX_MS);
    peer.remote.reconnecting = true;
    this.onChange();
    this.later(delay, () => {
      if (this.closed || this.peers.get(id) !== peer || !this.participants.includes(id)) return;
      if (peer.pc.connectionState === 'connected') return;
      this.rebuild(id);
    });
  }

  /** A brand-new connection with this person (offering side offers; answering side asks for an offer). */
  private rebuild(id: string): void {
    if (this.closed || !this.participants.includes(id)) return;
    const reconnecting = !!this.peers.get(id);
    this.dropPeer(id);
    if (this.me < id) void this.offer(id, reconnecting);
    else {
      this.send(id, { type: 'hello' });
      this.awaitOffer(id);
    }
  }

  private async iceRestart(peer: Peer): Promise<void> {
    const id = peer.remote.id;
    if (this.peers.get(id) !== peer || peer.pc.signalingState !== 'stable') return;
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer({ iceRestart: true }));
      if (this.peers.get(id) !== peer) return;
      this.sendSdp(id, peer);
    } catch {
      this.recover(id, peer, 'failed');
    }
  }

  /** Whether this connection works or is still setting up within its time. */
  private healthy(peer: Peer): boolean {
    const s = peer.pc.connectionState;
    if (s === 'connected') return true;
    if (s === 'failed' || s === 'closed') return false;
    return Date.now() - peer.createdAt < STALE_SETUP_MS;
  }

  /** We are the answering side: if no offer shows up, ask for one (less often as time goes on). */
  private awaitOffer(id: string): void {
    if (this.awaiting.has(id)) return;
    this.awaiting.add(id);
    const tick = (wait: number): void => {
      this.later(wait, () => {
        if (this.closed || this.peers.has(id) || !this.participants.includes(id)) {
          this.awaiting.delete(id);
          return;
        }
        this.send(id, { type: 'hello' });
        tick(Math.min(wait * 2, RETRY_MAX_MS));
      });
    };
    tick(OFFER_WAIT_MS);
  }

  private async offer(id: string, reconnecting = false): Promise<void> {
    const peer = this.createPeer(id, newSid());
    peer.remote.reconnecting = reconnecting;
    for (const slot of SLOTS) {
      const t = peer.pc.addTransceiver(slot === 'audio' ? 'audio' : 'video', { direction: 'sendrecv' });
      await t.sender.replaceTrack(this.local[slot]).catch(() => undefined);
    }
    if (this.peers.get(id) !== peer) return;
    this.tuneScreenSender(peer);
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    if (this.peers.get(id) !== peer) return;
    this.sendSdp(id, peer);
  }

  private stateSignal(): Signal {
    return {
      type: 'state',
      camera: !!this.local.camera,
      screen: !!this.local.screen,
      muted: !this.transmitting,
    };
  }

  private broadcastState(): void {
    for (const [id, p] of this.peers)
      if (p.pc.connectionState === 'connected') this.send(id, this.stateSignal());
  }

  private sendSdp(to: string, peer: Peer): void {
    const sid = peer.sid ? { sid: peer.sid } : {};
    this.send(to, { type: 'sdp', description: peer.pc.localDescription!.toJSON(), ...sid });
    peer.sdpSent = true;
    for (const candidate of peer.outgoingIce.splice(0)) this.send(to, { type: 'ice', candidate, ...sid });
  }

  /** Screen share gets more bandwidth and keeps resolution over frame rate. */
  private tuneScreenSender(peer: Peer): void {
    const sender = peer.pc.getTransceivers()[2]?.sender;
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0]!.maxBitrate = 2_500_000;
      params.degradationPreference = 'maintain-resolution';
      void sender.setParameters(params).catch(() => undefined);
    } catch {
      // not supported here
    }
  }

  private async flushIce(peer: Peer): Promise<void> {
    for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => undefined);
  }

  private dropPeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    for (const t of peer.timers) clearTimeout(t);
    peer.timers.clear();
    peer.pc.onconnectionstatechange = null;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.close();
    this.peers.delete(id);
    this.analysers.get(id)?.source.disconnect();
    this.analysers.delete(id);
    this.speaking.delete(id);
  }

  private peerTimer(peer: Peer, ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      peer.timers.delete(t);
      fn();
    }, ms);
    peer.timers.add(t);
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private stopLocal(): void {
    for (const slot of SLOTS) {
      this.local[slot]?.stop();
      this.local[slot] = null;
    }
  }

  private send(to: string, signal: Signal): void {
    this.transport.signal(to, signal);
  }
}
