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

type Signal =
  | { type: 'sdp'; description: RTCSessionDescriptionInit }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  /** Sent by the answering side when no offer arrived: "please (re)offer". */
  | { type: 'hello' }
  /** What the sender is currently sending; receivers show tiles from this, not from track heuristics. */
  | { type: 'state'; camera: boolean; screen: boolean; muted: boolean };

const OFFER_WAIT_MS = 4000;
const MAX_RETRIES = 4;

export interface RemotePeer {
  id: string;
  audio: MediaStream | null;
  camera: MediaStream | null;
  screen: MediaStream | null;
  cameraOn: boolean;
  screenOn: boolean;
  muted: boolean;
  state: RTCPeerConnectionState;
}

interface Peer {
  pc: RTCPeerConnection;
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
  private speakingTimer: number | null = null;
  /** River IDs (including our own) currently speaking. */
  speaking = new Set<string>();
  deafened = false;
  serverMuted = false;
  /** Push-to-talk key is held. */
  pttActive = false;
  private readonly peers = new Map<string, Peer>();
  /** Candidates from peers we have not created yet (they can overtake the offer). */
  private readonly earlyIce = new Map<string, RTCIceCandidateInit[]>();
  private participants: string[] = [];
  private readonly retries = new Map<string, number>();
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
    this.speakingTimer = window.setInterval(() => this.measure(), 80);
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

  /** Called with the server's participant list for this channel. */
  updateParticipants(ids: string[]): void {
    if (this.closed) return;
    this.participants = ids;
    for (const id of [...this.peers.keys()]) if (!ids.includes(id)) this.dropPeer(id);
    for (const id of ids) {
      if (id === this.me || this.peers.has(id)) continue;
      // The participant with the smaller ID makes the offer, so each pair negotiates once.
      if (this.me < id) void this.offer(id);
      else this.awaitOffer(id);
    }
    this.onChange();
  }

  async handleSignal(from: string, data: unknown): Promise<void> {
    if (this.closed) return;
    const signal = data as Signal;
    if (signal.type === 'hello') {
      if (this.me < from && this.participants.includes(from)) {
        this.dropPeer(from);
        void this.offer(from);
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
        this.dropPeer(from);
        const peer = this.createPeer(from);
        await peer.pc.setRemoteDescription(desc);
        peer.pc.getTransceivers().forEach((t, i) => {
          t.direction = 'sendrecv';
          void t.sender.replaceTrack(this.local[SLOTS[i]!] ?? null);
        });
        await this.flushIce(peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        this.sendSdp(from, peer);
        this.tuneScreenSender(peer);
        this.onChange();
      } else {
        const peer = this.peers.get(from);
        if (!peer) return;
        await peer.pc.setRemoteDescription(desc);
        await this.flushIce(peer);
      }
    } else if (signal.type === 'ice') {
      const peer = this.peers.get(from);
      if (!peer) {
        const early = this.earlyIce.get(from) ?? [];
        if (early.length < 50) early.push(signal.candidate);
        this.earlyIce.set(from, early);
        return;
      }
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
    if (this.speakingTimer) window.clearInterval(this.speakingTimer);
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

  private createPeer(id: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });
    const peer: Peer = {
      pc,
      remote: {
        id,
        audio: null,
        camera: null,
        screen: null,
        cameraOn: false,
        screenOn: false,
        muted: false,
        state: 'new',
      },
      pendingIce: this.earlyIce.get(id) ?? [],
      sdpSent: false,
      outgoingIce: [],
    };
    this.earlyIce.delete(id);
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      if (peer.sdpSent) this.send(id, { type: 'ice', candidate: e.candidate.toJSON() });
      else peer.outgoingIce.push(e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      peer.remote.state = pc.connectionState;
      if (pc.connectionState === 'connected') {
        this.retries.delete(id);
        this.send(id, this.stateSignal());
      }
      if (pc.connectionState === 'failed') this.retry(id);
      this.onChange();
    };
    pc.ontrack = (e) => {
      const slot = SLOTS[pc.getTransceivers().indexOf(e.transceiver)];
      if (!slot) return;
      peer.remote[slot] = new MediaStream([e.track]);
      if (slot === 'audio') this.watch(id, e.track);
      this.onChange();
    };
    this.peers.set(id, peer);
    return peer;
  }

  /** We are the answering side: if no offer shows up, ask for one. */
  private awaitOffer(id: string): void {
    setTimeout(() => {
      if (this.closed || this.peers.has(id) || !this.participants.includes(id)) return;
      this.send(id, { type: 'hello' });
      this.awaitOffer(id);
    }, OFFER_WAIT_MS);
  }

  private retry(id: string): void {
    const n = (this.retries.get(id) ?? 0) + 1;
    this.retries.set(id, n);
    if (n > MAX_RETRIES || this.closed) return;
    setTimeout(() => {
      if (this.closed || !this.participants.includes(id)) return;
      this.dropPeer(id);
      if (this.me < id) void this.offer(id);
      else {
        this.send(id, { type: 'hello' });
        this.awaitOffer(id);
      }
    }, 1000 * n);
  }

  private async offer(id: string): Promise<void> {
    const peer = this.createPeer(id);
    for (const slot of SLOTS) {
      const t = peer.pc.addTransceiver(slot === 'audio' ? 'audio' : 'video', { direction: 'sendrecv' });
      await t.sender.replaceTrack(this.local[slot]);
    }
    this.tuneScreenSender(peer);
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
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
    this.send(to, { type: 'sdp', description: peer.pc.localDescription!.toJSON() });
    peer.sdpSent = true;
    for (const candidate of peer.outgoingIce.splice(0)) this.send(to, { type: 'ice', candidate });
  }

  /** Screen share gets more bandwidth and keeps resolution over frame rate. */
  private tuneScreenSender(peer: Peer): void {
    const sender = peer.pc.getTransceivers()[2]?.sender;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0]!.maxBitrate = 2_500_000;
    params.degradationPreference = 'maintain-resolution';
    void sender.setParameters(params).catch(() => undefined);
  }

  private async flushIce(peer: Peer): Promise<void> {
    for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => undefined);
  }

  private dropPeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    this.peers.delete(id);
    this.analysers.get(id)?.source.disconnect();
    this.analysers.delete(id);
    this.speaking.delete(id);
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
