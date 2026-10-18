import { fromBase64, toBase64 } from './relay-crypto.ts';
import type { RelayEngine } from './relay-audio.ts';
import { VoiceGate, levelOf } from './voice-gate.ts';
import { screenConstraints, type ScreenQuality } from './screen-quality.ts';
import { readLinkStats, type LinkStats } from './link-stats.ts';
import { isLargeRoom, tuneOpusSdp, videoBitrates } from './media-tuning.ts';
import { relayBitrate } from './relay-quality.ts';

/**
 * Voice/video calls as a WebRTC mesh: every participant connects directly to
 * every other participant. Media is encrypted with DTLS-SRTP between the two
 * computers; the River server only relays connection setup, and that setup is
 * itself sealed with the community key.
 *
 * Large rooms (2.13): above MESH_MAX_PEOPLE everyone's voice goes through the
 * server instead (relay-audio.ts: still end-to-end encrypted, one upload
 * however big the room is, and only while you talk), and direct connections
 * are made only with people sharing a camera or screen, for their video.
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
  | {
      type: 'state';
      camera: boolean;
      screen: boolean;
      muted: boolean;
      priority?: boolean;
      /** Hand raised since (the sender's clock, ms), 2.13; absent: hand down. */
      hand?: number;
    }
  /** Remote assistance (ADR 0007): "look here" on the screen you are sharing, as fractions. */
  | { type: 'point'; x: number; y: number }
  /** "I can't reach you directly: here is my relay key; let's talk through the server" (1.0.17). */
  | { type: 'relay'; key: string }
  /** "We are connected directly again: stop relaying to me." */
  | { type: 'relay-off' }
  /** "I miss this share of your relayed frames" (2.13): the sender lowers its bitrate. */
  | { type: 'relay-loss'; loss: number };

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
/** Someone already talking through the server is retried directly this often (no rush: sound flows). */
const RELAYED_RETRY_MS = 30_000;
/** Someone missing from the participant list keeps their working connection this long (server restart). */
const MISSING_GRACE_MS = 10_000;
/**
 * A pair not connected directly after this long talks through the server meanwhile (2.14: 1.5 s,
 * was 6 s), so someone joining is heard at once; the direct connection takes over when it comes up.
 */
const RELAY_AFTER_MS = 1500;
/** How often relayed pairs are checked for a direct connection that works again. */
const RELAY_CHECK_MS = 2000;
/** While relayed, our key is sent again this many times, this far apart (lost signals). */
const RELAY_KEY_RESENDS = 5;
const RELAY_KEY_RESEND_MS = 8000;
/**
 * Relayed voice counts as flowing while their frames arrived this recently (River sends a quiet
 * frame now and then while muted, so a muted person still counts).
 */
const RELAY_SILENT_MS = 15_000;
/** How often listeners tell relayed speakers how many of their frames went missing. */
const LOSS_REPORT_EVERY = 3; // relay checks (6 s)
/** A loss report counts this long. */
const LOSS_REPORT_TTL_MS = 20_000;
/** Losses from this share on are reported (and the first report back under it, once). */
const LOSS_REPORT_FROM = 0.03;
/** Network changes closer together than this are handled once. */
const NETWORK_CHANGE_MS = 3000;

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
  /** Voice goes through the River server (no direct connection); audio only. */
  relayed: boolean;
  /**
   * Their voice really arrives through the server (frames that decrypt came in lately): only
   * then is a relayed call connected. The relay merely being on proves nothing.
   */
  relayFlowing: boolean;
  /** Says Priority speaker is on (1.0.33); listeners honour it only if the community allows it. */
  priority?: boolean;
  /** Hand raised since (ms, their clock, never later than ours), or null (2.13). */
  hand?: number | null;
  /** When this person appeared in the call here (ms): a join is not "connecting…" at once (2.14). */
  since?: number;
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
  /** Voice from the direct connection (kept while voice is relayed). */
  directAudio: MediaStream | null;
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
  /** Voice activity sensitivity, 0–1 on the meter's scale; null = automatic (always send). */
  sensitivity: number | null;
}

const SPEAKING_THRESHOLD = 0.035;
const SPEAKING_HOLD_MS = 350;

interface Analyser {
  node: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  track: MediaStreamTrack;
}

/** At least this long between "look here" points from one viewer. */
const POINT_EVERY_MS = 250;

export class VoiceCall {
  readonly channelId: string;
  /** Names for the "can see your screen" bar (set by the store; IDs until then). */
  nameOf: (riverId: string) => string = (id) => id.slice(0, 8);
  private lastShare = '';
  private lastPointSent = 0;
  private readonly lastPointFrom = new Map<string, number>();
  readonly me: string;
  private options: CallOptions;
  private audioCtx: AudioContext | null = null;
  private readonly analysers = new Map<string, Analyser>();
  private readonly lastLoud = new Map<string, number>();
  private speakingTimer: ReturnType<typeof setInterval> | null = null;
  private relayCheckTimer: ReturnType<typeof setInterval> | null = null;
  /** River IDs (including our own) currently speaking. */
  speaking = new Set<string>();
  deafened = false;
  serverMuted = false;
  /** A moderator deafened us: we hear nothing and send nothing (1.0.20). */
  serverDeafened = false;
  private readonly gate = new VoiceGate();
  /** A copy of the microphone that is never switched off, so the gate can hear you start talking. */
  private micProbe: MediaStreamTrack | null = null;
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
  private relay: RelayEngine | null;
  /** People whose voice goes through the server. */
  private readonly relayPeers = new Set<string>();
  /**
   * What the call shows for each person, kept for as long as they are in the
   * channel. Direct-connection attempts come and go underneath (rebuilt after
   * failures, replaced after network drops); the person, their relayed voice and
   * their speaking indicator stay put.
   */
  private readonly views = new Map<string, RemotePeer>();
  /**
   * People we gave our relay key to: when, and how often. A key signal can be lost (it travels
   * while the server connection is reconnecting); the field test of 2026-10-14 had one pair that
   * never heard each other. While relayed, the key is sent again a few times, and again after
   * our connection to the server comes back.
   */
  private readonly keySentTo = new Map<string, { at: number; times: number }>();
  /** Relayed frames received from each person so far, and when the count last grew. */
  private readonly relayHeard = new Map<string, { frames: number; at: number }>();
  private relayPollPending = false;
  /** What listeners told us they miss of our relayed voice, and when (2.13). */
  private readonly lossReports = new Map<string, { loss: number; at: number }>();
  /** What we last told each relayed speaker about their frames we miss. */
  private readonly lossTold = new Map<string, number>();
  /** Share of each relayed speaker's frames we missed lately (for the tile's connection details). */
  private readonly relayLoss = new Map<string, number>();
  private relayChecks = 0;
  private lastNetworkChange = 0;
  private readonly cleanups: Array<() => void> = [];
  /** The microphone stopped (unplugged) and no other one could be opened: nobody hears us. */
  micLost = false;
  /** Our hand is raised (since, ms), 2.13. */
  hand: number | null = null;
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
    relay?: RelayEngine | null,
  ) {
    this.channelId = channelId;
    this.relay = relay ?? null;
    this.transport = transport ?? channelTransport(channelId);
    this.me = me;
    this.onChange = onChange;
    this.options = {
      iceServers: [],
      inputDeviceId: null,
      noiseSuppression: true,
      echoCancellation: true,
      pushToTalk: false,
      sensitivity: null,
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

  private readonly linkCounts = new Map<string, { received: number; lost: number }>();

  /** Connection details per person, for the call tiles (1.0.19). */
  async linkStats(): Promise<Record<string, LinkStats>> {
    const out: Record<string, LinkStats> = {};
    for (const id of this.relayPeers)
      if (!this.peers.has(id))
        out[id] = { path: 'server', rttMs: null, loss: this.relayLoss.get(id) ?? null };
    for (const [id, p] of this.peers) {
      if (p.remote.relayed && p.pc.connectionState !== 'connected') {
        out[id] = { path: 'server', rttMs: null, loss: this.relayLoss.get(id) ?? null };
        continue;
      }
      if (p.pc.connectionState !== 'connected') {
        out[id] = { path: 'connecting', rttMs: null, loss: null };
        continue;
      }
      try {
        const report: Array<Record<string, unknown> & { type: string; id: string }> = [];
        (await p.pc.getStats()).forEach((r) =>
          report.push(r as Record<string, unknown> & { type: string; id: string }),
        );
        const { stats, counts } = readLinkStats(report, this.linkCounts.get(id) ?? null);
        this.linkCounts.set(id, counts);
        out[id] = {
          path: stats.candidateType === 'relay' ? 'relay-turn' : 'direct',
          rttMs: stats.rttMs,
          loss: stats.loss,
        };
      } catch {
        out[id] = { path: 'direct', rttMs: null, loss: null };
      }
    }
    return out;
  }

  private async microphone(): Promise<MediaStreamTrack | null> {
    const audio: MediaTrackConstraints = {
      echoCancellation: this.options.echoCancellation,
      noiseSuppression: this.options.noiseSuppression,
      autoGainControl: true,
      // Voice is mono: no second channel to process and send.
      channelCount: { ideal: 1 },
      ...(this.options.inputDeviceId ? { deviceId: { exact: this.options.inputDeviceId } } : {}),
    };
    try {
      const track =
        (await navigator.mediaDevices.getUserMedia({ audio, video: false })).getAudioTracks()[0] ?? null;
      if (track) track.onended = () => this.micEnded(track);
      return track;
    } catch (err) {
      // The saved device may be unplugged: fall back to the default microphone.
      if (!this.options.inputDeviceId || (err as Error).name !== 'OverconstrainedError') throw err;
      this.options.inputDeviceId = null;
      return this.microphone();
    }
  }

  /**
   * Opens the microphone and joins. If the call is left meanwhile (Disconnect or
   * Hang up while the microphone prompt or the join is pending), this returns
   * without joining and with the microphone released: check `closed` afterwards.
   * On failure everything opened so far is released before the error is thrown.
   */
  async start(): Promise<void> {
    if (this.closed) return;
    try {
      const mic = await this.microphone();
      if (this.closed) {
        mic?.stop();
        return;
      }
      this.local.audio = mic;
      if (this.relay?.available) {
        try {
          await this.relay.start(mic);
        } catch (err) {
          console.warn('voice relay unavailable', err);
          this.relay = null;
        }
        if (this.closed) {
          // leave() already ran while the relay was starting: release what it opened since.
          this.relay?.close();
          this.stopLocal();
          return;
        }
      } else this.relay = null;
      this.applyMic();
      this.probe(this.local.audio);
      await this.transport.join();
      if (this.closed) {
        // Left while joining: leave() may have reached the server before the join did.
        await this.transport.leave().catch(() => undefined);
        return;
      }
    } catch (err) {
      if (this.closed) return;
      this.shutdown();
      throw err;
    }
    this.speakingTimer = setInterval(() => this.measure(), 80);
    this.relayCheckTimer = setInterval(() => this.checkRelays(), RELAY_CHECK_MS);
    this.listen();
  }

  /** Follows device and network changes for as long as the call lasts. */
  private listen(): void {
    const devices = navigator.mediaDevices as MediaDevices | undefined;
    if (devices?.addEventListener) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const onDevices = (): void => {
        // Plugging a headset in fires several events: look once they settle.
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void this.devicesChanged(), 500);
      };
      devices.addEventListener('devicechange', onDevices);
      this.cleanups.push(() => {
        if (timer) clearTimeout(timer);
        devices.removeEventListener('devicechange', onDevices);
      });
    }
    const target = globalThis as Partial<Pick<EventTarget, 'addEventListener' | 'removeEventListener'>>;
    if (typeof target.addEventListener === 'function') {
      const onOnline = (): void => this.networkChanged();
      target.addEventListener('online', onOnline);
      this.cleanups.push(() => target.removeEventListener?.('online', onOnline));
    }
    const connection = (navigator as { connection?: EventTarget }).connection;
    if (connection?.addEventListener) {
      const onChange = (): void => this.networkChanged();
      connection.addEventListener('change', onChange);
      this.cleanups.push(() => connection.removeEventListener('change', onChange));
    }
  }

  /**
   * The computer's network changed (Wi-Fi to cable, a VPN, waking from sleep): direct
   * connections are restarted at once instead of waiting for them to fail, and our relay key
   * goes out again in case signals were lost meanwhile. Nobody leaves the channel.
   */
  networkChanged(): void {
    if (this.closed) return;
    const now = Date.now();
    if (now - this.lastNetworkChange < NETWORK_CHANGE_MS) return;
    this.lastNetworkChange = now;
    for (const [id, peer] of [...this.peers]) {
      if (peer.pc.connectionState === 'connected') {
        peer.restarted = true;
        if (this.me < id) void this.iceRestart(peer);
        else this.send(id, { type: 'restart', ...(peer.sid ? { sid: peer.sid } : {}) });
        this.peerTimer(peer, RESTART_TIMEOUT_MS, () => {
          if (peer.pc.connectionState !== 'connected') this.recover(id, peer, 'failed');
        });
      } else {
        this.retries.delete(id);
        this.rebuild(id);
      }
    }
    for (const [id, sent] of this.keySentTo) this.keySentTo.set(id, { at: sent.at, times: 0 });
    this.resumedAt = now;
  }

  /**
   * Audio devices changed. If the microphone was lost, try again; if you use the system's default
   * microphone and the default changed (a headset was plugged in), switch to it.
   */
  private async devicesChanged(): Promise<void> {
    if (this.closed) return;
    if (this.micLost) {
      await this.reopenMic();
      return;
    }
    if (this.options.inputDeviceId !== null || !this.local.audio) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const fallback = all.find((d) => d.kind === 'audioinput' && d.deviceId === 'default');
      const current = this.local.audio.getSettings?.().groupId;
      if (fallback?.groupId && current && fallback.groupId !== current) await this.reopenMic();
    } catch {
      // device list unavailable: keep the microphone we have
    }
  }

  /** Opens the microphone again (another device, or after it was unplugged) without leaving. */
  private async reopenMic(): Promise<void> {
    let track: MediaStreamTrack | null;
    try {
      track = await this.microphone();
    } catch {
      track = null;
    }
    if (this.closed) {
      track?.stop();
      return;
    }
    this.micLost = !track;
    if (track) {
      await this.setSlot('audio', track);
      if (this.closed) return;
      this.probe(track);
      this.applyMic();
    }
    this.onChange();
  }

  /** The microphone track ended by itself (unplugged, taken away): get another one. */
  private micEnded(track: MediaStreamTrack): void {
    if (this.closed || this.local.audio !== track) return;
    this.micLost = true;
    this.onChange();
    void this.reopenMic();
  }

  /**
   * Someone still marked "via server" while the direct connection with them is
   * up goes back to direct, and both sides are told. Signals that arrive late
   * (after a server reconnect) can otherwise leave one side playing a relayed
   * stream the other side no longer sends: a person you can see but not hear.
   */
  private checkRelays(): void {
    if (this.closed) return;
    this.pollRelayFrames();
    const now = Date.now();
    for (const id of [...this.relayPeers]) {
      if (this.peers.get(id)?.pc.connectionState === 'connected') {
        this.disableRelay(id, true);
        continue;
      }
      // Our key again, in case the first one was lost: a few times, and after a reconnect.
      const sent = this.keySentTo.get(id);
      const reconnected = sent !== undefined && this.resumedAt > sent.at;
      if (!sent || reconnected || (sent.times < RELAY_KEY_RESENDS && now - sent.at >= RELAY_KEY_RESEND_MS)) {
        if (reconnected) this.keySentTo.set(id, { at: sent.at, times: 0 });
        this.sendRelayKey(id);
      }
    }
    if (++this.relayChecks % LOSS_REPORT_EVERY === 0) this.reportLoss();
    this.tuneRelay();
  }

  /** Tells relayed speakers how much of their voice we miss, so they can send less (2.13). */
  private reportLoss(): void {
    if (!this.relay) return;
    for (const id of this.relayPeers) {
      const loss = this.relay.loss(id);
      if (loss === null) continue;
      this.relayLoss.set(id, loss);
      const told = this.lossTold.get(id) ?? 0;
      if (loss < LOSS_REPORT_FROM && told < LOSS_REPORT_FROM) continue;
      this.lossTold.set(id, loss);
      this.send(id, { type: 'relay-loss', loss: Math.round(loss * 100) / 100 });
    }
  }

  /** Relayed voice: to everyone at once in a large room, at a bitrate our listeners can take. */
  private tuneRelay(): void {
    if (!this.relay) return;
    const now = Date.now();
    let worst: number | null = null;
    for (const [id, r] of this.lossReports) {
      if (now - r.at > LOSS_REPORT_TTL_MS || !this.relayPeers.has(id)) this.lossReports.delete(id);
      else worst = Math.max(worst ?? 0, r.loss);
    }
    const large = this.largeRoom;
    this.relay.setBroadcast(large);
    this.relay.setBitrate(relayBitrate(worst, large));
  }

  /** More than MESH_MAX_PEOPLE in the call (and the relay works here): voice goes through the server. */
  get largeRoom(): boolean {
    return isLargeRoom(this.participants.length, !!this.relay);
  }

  /** Whether to connect directly with this person: always in small rooms, for video in large ones. */
  private wantsDirect(id: string): boolean {
    if (!this.largeRoom) return true;
    const view = this.views.get(id);
    return !!this.local.camera || !!this.local.screen || !!view?.cameraOn || !!view?.screenOn;
  }

  /** Starts a direct connection with this person if one is wanted and none exists. */
  private ensureDirect(id: string): void {
    if (this.closed || id === this.me || this.peers.has(id) || !this.participants.includes(id)) return;
    if (!this.wantsDirect(id)) {
      this.enableRelay(id);
      return;
    }
    // The participant with the smaller ID makes the offer, so each pair negotiates once.
    if (this.me < id) void this.offer(id);
    else this.awaitOffer(id);
  }

  /** Whether our microphone is actually transmitting right now. */
  get transmitting(): boolean {
    return (
      !this.muted &&
      !this.deafened &&
      !this.serverMuted &&
      !this.serverDeafened &&
      (this.options.pushToTalk ? this.pttActive : this.options.sensitivity === null || this.gate.open)
    );
  }

  get pushToTalk(): boolean {
    return this.options.pushToTalk;
  }

  private applyMic(): void {
    if (this.local.audio) this.local.audio.enabled = this.transmitting;
    this.relay?.setTransmitting(this.transmitting);
  }

  /** A relayed voice frame arrived from the server. */
  receiveRelay(from: string, payload: Uint8Array): void {
    if (this.closed || !this.relayPeers.has(from)) return;
    this.relay?.receive(from, payload);
    // The first frames after a silence: see soon (once they decrypted) that sound flows again.
    if (!this.views.get(from)?.relayFlowing && !this.relayPollPending) {
      this.relayPollPending = true;
      this.later(150, () => {
        this.relayPollPending = false;
        this.pollRelayFrames();
      });
    }
  }

  /** Notes who we really hear through the server (their frames decrypt), and since when. */
  private pollRelayFrames(): void {
    if (this.closed || !this.relay) return;
    const now = Date.now();
    let changed = false;
    for (const id of this.relayPeers) {
      const frames = this.relay.received(id);
      const heard = this.relayHeard.get(id);
      if (!heard) this.relayHeard.set(id, { frames, at: 0 });
      else if (frames > heard.frames) this.relayHeard.set(id, { frames, at: now });
      const view = this.views.get(id);
      if (!view) continue;
      const at = this.relayHeard.get(id)!.at;
      const flowing = at > 0 && now - at < RELAY_SILENT_MS;
      if (view.relayFlowing !== flowing) {
        view.relayFlowing = flowing;
        changed = true;
      }
    }
    if (changed) this.onChange();
  }

  /**
   * When we last knew this person was still there: now while a direct connection with them is
   * up, else when their voice last came through the server (0: never).
   */
  lastHeard(id: string): number {
    if (this.peers.get(id)?.pc.connectionState === 'connected') return Date.now();
    this.pollRelayFrames();
    return this.relayPeers.has(id) ? (this.relayHeard.get(id)?.at ?? 0) : 0;
  }

  /** Talk to this person through the server until a direct connection works. */
  private enableRelay(id: string): void {
    if (!this.relay || this.closed || !this.participants.includes(id)) return;
    if (!this.relayPeers.has(id)) {
      this.relayPeers.add(id);
      this.relay.setRecipients([...this.relayPeers]);
      // Counted from now: frames from an earlier stretch through the server say nothing of now.
      this.relayHeard.set(id, { frames: this.relay.received(id), at: 0 });
      // They may never have heard from us directly: tell them now whether we are muted, sharing
      // or have a hand up, or they would show us wrong until something changes.
      this.send(id, this.stateSignal());
    }
    if (!this.keySentTo.has(id)) this.sendRelayKey(id);
    this.refreshAudio(id);
  }

  private sendRelayKey(id: string): void {
    if (!this.relay) return;
    let key: Uint8Array;
    try {
      key = this.relay.ownKey();
    } catch {
      return; // the relay is still starting: the next relay check sends it
    }
    const sent = this.keySentTo.get(id);
    this.keySentTo.set(id, { at: Date.now(), times: (sent?.times ?? 0) + 1 });
    this.send(id, { type: 'relay', key: toBase64(key) });
  }

  private disableRelay(id: string, tell: boolean): void {
    if (!this.relayPeers.delete(id)) return;
    this.relay?.setRecipients([...this.relayPeers]);
    if (tell) this.send(id, { type: 'relay-off' });
    this.refreshAudio(id);
  }

  /** Person left the call: forget everything relay-related about them. */
  private forgetRelay(id: string): void {
    this.relayPeers.delete(id);
    this.keySentTo.delete(id);
    this.relayHeard.delete(id);
    this.lossReports.delete(id);
    this.lossTold.delete(id);
    this.relayLoss.delete(id);
    this.relay?.setRecipients([...this.relayPeers]);
    this.relay?.dropPeer(id);
  }

  /** Plays the relayed voice while relayed, the direct one otherwise. */
  private refreshAudio(id: string): void {
    if (!this.views.has(id)) return;
    const view = this.view(id);
    const relayed = this.relayPeers.has(id);
    const stream = relayed ? (this.relay?.streamFor(id) ?? null) : (this.peers.get(id)?.directAudio ?? null);
    view.relayed = relayed;
    if (!relayed) view.relayFlowing = false;
    if (view.audio !== stream) {
      view.audio = stream;
      this.watch(id, stream?.getAudioTracks()[0] ?? null);
    }
    this.onChange();
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
      if (this.closed) {
        track?.stop();
        return;
      }
      await this.setSlot('audio', track);
      if (this.closed) return;
      this.probe(track);
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

  setServerDeafened(serverDeafened: boolean): void {
    if (this.serverDeafened === serverDeafened) return;
    this.serverDeafened = serverDeafened;
    this.applyMic();
    this.onChange();
  }

  /** Incoming sound is off: deafened by us or by a moderator. */
  get hearingOff(): boolean {
    return this.deafened || this.serverDeafened;
  }

  setServerMuted(serverMuted: boolean): void {
    if (this.serverMuted === serverMuted) return;
    this.serverMuted = serverMuted;
    this.applyMic();
    this.broadcastState();
    this.onChange();
  }

  // ---- speaking detection -----------------------------------------------------------------------

  /** Listens to our own microphone through a copy that stays on while the real one is gated. */
  private probe(track: MediaStreamTrack | null): void {
    this.micProbe?.stop();
    let copy: MediaStreamTrack | null;
    try {
      copy = track?.clone() ?? null;
    } catch {
      copy = null;
    }
    // Without a copy (unusual), listen to the track itself: the gate then cannot reopen while closed,
    // so keep sending in that case.
    if (track && !copy) this.options.sensitivity = null;
    this.micProbe = copy;
    if (copy) copy.enabled = true;
    this.watch(this.me, copy ?? track);
  }

  private watch(id: string, track: MediaStreamTrack | null): void {
    const existing = this.analysers.get(id);
    if (existing?.track === track) return;
    existing?.source.disconnect();
    this.analysers.delete(id);
    if (track) {
      try {
        if (!this.audioCtx) {
          const ctx = new AudioContext();
          this.audioCtx = ctx;
          // After sleep the engine can stop: no meters, no voice activity. Start it again.
          ctx.addEventListener?.('statechange', () => {
            const state = ctx.state as string;
            if (!this.closed && (state === 'suspended' || state === 'interrupted'))
              void ctx.resume().catch(() => undefined);
          });
        }
        const source = this.audioCtx.createMediaStreamSource(new MediaStream([track]));
        const node = this.audioCtx.createAnalyser();
        node.fftSize = 512;
        source.connect(node);
        this.analysers.set(id, { node, source, track });
        return;
      } catch {
        // No audio context available: no speaking indicators.
      }
    }
    // Nothing measures this person any more: they are not speaking (no stuck ring, no ducking).
    this.lastLoud.delete(id);
    if (this.speaking.delete(id)) this.onChange();
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
      if (id === this.me && !this.options.pushToTalk && this.options.sensitivity !== null) {
        if (this.gate.update(levelOf(rms), this.options.sensitivity, now)) this.applyMic();
      }
      // Someone relayed may have no direct connection at all: their view says whether they muted.
      const live = id === this.me ? this.transmitting : !(this.views.get(id)?.muted ?? false);
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
    return this.participants.filter((id) => id !== this.me && this.views.has(id)).map((id) => this.view(id));
  }

  /** The stable view of this person (created on first sight). */
  private view(id: string): RemotePeer {
    let v = this.views.get(id);
    if (!v) {
      v = {
        id,
        audio: null,
        camera: null,
        screen: null,
        cameraOn: false,
        screenOn: false,
        muted: false,
        state: 'new',
        reconnecting: false,
        relayed: this.relayPeers.has(id),
        relayFlowing: false,
        hand: null,
        since: Date.now(),
      };
      this.views.set(id, v);
    }
    return v;
  }

  /** The person left the channel: drop their connection and everything shown for them. */
  private forget(id: string): void {
    this.dropPeer(id);
    this.forgetRelay(id);
    this.views.delete(id);
    this.analysers.get(id)?.source.disconnect();
    this.analysers.delete(id);
    this.speaking.delete(id);
    // Nothing about them lingers: big rooms see many people come and go over an evening.
    this.lastLoud.delete(id);
    this.retries.delete(id);
    this.earlyIce.delete(id);
    this.awaiting.delete(id);
    this.lastPointFrom.delete(id);
    this.linkCounts.delete(id);
    this.missingSince.delete(id);
    this.signalQueues.delete(id);
  }

  /** How many entries the call keeps per person (tests: nothing lingers after people leave). */
  bookkeeping(): number {
    return [
      this.peers,
      this.views,
      this.analysers,
      this.lastLoud,
      this.retries,
      this.earlyIce,
      this.awaiting,
      this.lastPointFrom,
      this.linkCounts,
      this.missingSince,
      this.signalQueues,
      this.keySentTo,
      this.relayHeard,
      this.lossReports,
      this.lossTold,
      this.relayLoss,
    ].reduce((n, m) => n + m.size, this.relayPeers.size + this.speaking.size);
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
    for (const id of ids) if (id !== this.me) this.view(id);
    for (const id of new Set([...this.peers.keys(), ...this.views.keys()])) {
      if (ids.includes(id)) {
        this.missingSince.delete(id);
        continue;
      }
      // Sound that still flows — directly or through the server — outlives a short gap in the
      // list (the server restarting, a reconnect race); others go now.
      const peer = this.peers.get(id);
      const flowing = peer?.pc.connectionState === 'connected' || this.relayPeers.has(id);
      if (!refilling || !flowing) {
        this.missingSince.delete(id);
        this.forget(id);
        continue;
      }
      if (!this.missingSince.has(id)) {
        this.missingSince.set(id, now);
        this.later(MISSING_GRACE_MS, () => {
          if (this.missingSince.has(id) && !this.listed.includes(id)) {
            this.missingSince.delete(id);
            this.forget(id);
            this.onChange();
          }
        });
      }
    }
    this.participants = [...ids, ...[...this.missingSince.keys()].filter((id) => !ids.includes(id))];
    this.syncShare();
    this.tuneRelay();
    for (const id of ids) this.ensureDirect(id);
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
      // In a large room, someone without video is heard through the server instead.
      if (this.me < from && this.participants.includes(from) && this.wantsDirect(from)) {
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
      } else if (this.me < from && !peer && this.participants.includes(from) && this.wantsDirect(from)) {
        this.rebuild(from);
      }
      return;
    }
    if (signal.type === 'relay-loss') {
      const loss = signal.loss;
      if (!this.relayPeers.has(from) || typeof loss !== 'number' || !(loss >= 0 && loss <= 1)) return;
      this.lossReports.set(from, { loss, at: Date.now() });
      this.tuneRelay();
      return;
    }
    if (signal.type === 'relay') {
      if (!this.relay || !this.participants.includes(from)) return;
      try {
        await this.relay.setPeerKey(from, fromBase64(signal.key));
      } catch {
        return;
      }
      // A late request (we are already connected directly): stay direct and say so.
      if (this.peers.get(from)?.pc.connectionState === 'connected') {
        this.send(from, { type: 'relay-off' });
        return;
      }
      this.enableRelay(from);
      return;
    }
    if (signal.type === 'relay-off') {
      const peer = this.peers.get(from);
      if (peer?.pc.connectionState === 'connected') this.disableRelay(from, false);
      return;
    }
    if (signal.type === 'point') {
      // Only while we share a screen, only from someone in the call, at a bounded rate.
      if (!this.local.screen || !this.participants.includes(from)) return;
      const { x, y } = signal;
      if (typeof x !== 'number' || typeof y !== 'number' || !(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
      const now = Date.now();
      if (now - (this.lastPointFrom.get(from) ?? 0) < POINT_EVERY_MS) return;
      this.lastPointFrom.set(from, now);
      window.river?.voice.point?.(x, y);
      return;
    }
    if (signal.type === 'state') {
      if (this.participants.includes(from)) {
        const view = this.view(from);
        view.cameraOn = !!signal.camera;
        view.screenOn = !!signal.screen;
        view.muted = !!signal.muted;
        view.priority = signal.priority === true;
        // A hand "raised" later than now (a clock ahead of ours) counts as raised now.
        view.hand =
          typeof signal.hand === 'number' && Number.isFinite(signal.hand) && signal.hand > 0
            ? Math.min(signal.hand, Date.now())
            : null;
        // In a large room, video needs a direct connection: make one now that they share.
        this.ensureDirect(from);
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
        await this.setLocal(peer, await peer.pc.createAnswer());
        if (this.peers.get(from) !== peer) return; // replaced meanwhile
        this.sendSdp(from, peer);
        if (!renegotiation) this.tuneSenders(peer);
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

  /** Priority speaker (1.0.33): others turn everyone else down while we talk. */
  priority = false;

  setPriority(on: boolean): void {
    this.priority = on;
    this.broadcastState();
    this.onChange();
  }

  /** Raise or lower our hand (2.13): everyone in the call sees it, in the order hands went up. */
  setHand(up: boolean): void {
    if (up === (this.hand !== null)) return;
    this.hand = up ? Date.now() : null;
    this.broadcastState();
    this.onChange();
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
  async setScreen(on: boolean, quality: ScreenQuality = 'balanced'): Promise<void> {
    if (on && !this.local.screen) {
      const wanted = screenConstraints(quality);
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: wanted.video, audio: false });
      const track = stream.getVideoTracks()[0] ?? null;
      if (track) {
        track.contentHint = wanted.contentHint;
        track.onended = () => void this.setScreen(false);
      }
      await this.setSlot('screen', track);
    } else if (!on && this.local.screen) {
      await this.setSlot('screen', null);
    }
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.shutdown();
    await this.transport.leave().catch(() => undefined);
    this.onChange();
  }

  /** Stops everything local: timers, connections, relay, microphone, camera, screen, meters. */
  private shutdown(): void {
    this.closed = true;
    if (this.speakingTimer) clearInterval(this.speakingTimer);
    if (this.relayCheckTimer) clearInterval(this.relayCheckTimer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const fn of this.cleanups.splice(0)) fn();
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.views.clear();
    this.relay?.close();
    this.relayPeers.clear();
    this.relayHeard.clear();
    this.stopLocal();
    this.syncShare();
    this.micProbe?.stop();
    this.micProbe = null;
    for (const a of this.analysers.values()) a.source.disconnect();
    this.analysers.clear();
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.speaking.clear();
    this.lastLoud.clear();
    this.lossReports.clear();
    this.lossTold.clear();
    this.relayLoss.clear();
    this.keySentTo.clear();
  }

  /** Points at (x, y) on `peerId`'s shared screen; they see a ring there (remote assistance). */
  pointAt(peerId: string, x: number, y: number): void {
    if (this.closed || !this.view(peerId).screenOn) return;
    const now = Date.now();
    if (now - this.lastPointSent < POINT_EVERY_MS) return;
    this.lastPointSent = now;
    const clamp = (v: number): number => Math.min(1, Math.max(0, Math.round(v * 10_000) / 10_000));
    this.send(peerId, { type: 'point', x: clamp(x), y: clamp(y) });
  }

  /** Tells main who can see our screen, so it shows the always-on-top bar with Stop (ADR 0007). */
  private syncShare(): void {
    const sharing = !this.closed && !!this.local.screen;
    const viewers = sharing
      ? this.participants.filter((id) => id !== this.me).map((id) => this.nameOf(id))
      : [];
    const key = JSON.stringify([sharing, viewers]);
    if (key === this.lastShare) return;
    this.lastShare = key;
    window.river?.voice.shareStatus?.({ sharing, viewers });
  }

  // ---- internals -------------------------------------------------------------------------------

  private async setSlot(slot: Slot, track: MediaStreamTrack | null): Promise<void> {
    // The call ended while the camera, screen or microphone was opening: release it, send nothing.
    if (this.closed) {
      track?.stop();
      return;
    }
    this.local[slot]?.stop();
    this.local[slot] = track;
    if (slot === 'audio') this.relay?.setMic(track);
    if (slot === 'screen') this.syncShare();
    const index = SLOTS.indexOf(slot);
    await Promise.all(
      [...this.peers.values()].map((p) => {
        const sender = p.pc.getTransceivers()[index]?.sender;
        return sender?.replaceTrack(track).catch(() => undefined);
      }),
    );
    this.broadcastState();
    if (slot !== 'audio') {
      // A large room connects directly for video only: whoever can now see ours gets a connection.
      for (const id of this.participants) this.ensureDirect(id);
      this.tuneVideo();
    }
    this.onChange();
  }

  private createPeer(id: string, sid?: string): Peer {
    const pc = new RTCPeerConnection({
      iceServers: [...ICE_SERVERS, ...this.options.iceServers],
      bundlePolicy: 'max-bundle',
      // End-to-end tests set this to make direct connections impossible and exercise the relay.
      ...((globalThis as { __riverForceRelay?: boolean }).__riverForceRelay
        ? { iceTransportPolicy: 'relay' as const, iceServers: [] }
        : {}),
    });
    const peer: Peer = {
      pc,
      sid,
      createdAt: Date.now(),
      everConnected: false,
      restarted: false,
      remote: this.view(id),
      pendingIce: [],
      sdpSent: false,
      outgoingIce: [],
      timers: new Set(),
      directAudio: null,
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
      const stream = new MediaStream([e.track]);
      if (slot === 'audio') {
        peer.directAudio = stream;
        this.refreshAudio(id);
        return;
      }
      peer.remote[slot] = stream;
      this.onChange();
    };
    peer.remote.state = 'new';
    peer.remote.camera = null;
    peer.remote.screen = null;
    this.peers.set(id, peer);
    // Voice: the relayed stream keeps playing; a direct one arrives with this connection's track.
    this.refreshAudio(id);
    // Not connected directly after a few seconds: talk through the server meanwhile.
    this.peerTimer(peer, RELAY_AFTER_MS, () => {
      if (pc.connectionState !== 'connected') this.enableRelay(id);
    });
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
      this.disableRelay(id, true);
      peer.remote.reconnecting = false;
      peer.everConnected = true;
      peer.restarted = false;
      this.send(id, this.stateSignal());
      this.tuneVideo();
    } else if (state === 'disconnected') {
      // Often a short network blip that heals by itself; if not, restart ICE (audio may keep flowing).
      peer.remote.reconnecting = true;
      this.peerTimer(peer, DISCONNECTED_GRACE_MS, () => {
        if (peer.pc.connectionState === 'disconnected') this.recover(id, peer, 'disconnected');
      });
    } else if (state === 'failed') {
      peer.remote.reconnecting = true;
      this.enableRelay(id);
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
    // A large room needs no direct connection for voice: let it go and keep talking through the server.
    if (!this.wantsDirect(id)) {
      this.dropPeer(id);
      this.retries.delete(id);
      this.enableRelay(id);
      this.onChange();
      return;
    }
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
    const delay = this.relayPeers.has(id)
      ? RELAYED_RETRY_MS
      : Math.min(RETRY_BASE_MS * 2 ** Math.min(n - 1, 4), RETRY_MAX_MS);
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
      await this.setLocal(peer, await peer.pc.createOffer({ iceRestart: true }));
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
        if (this.closed || this.peers.has(id) || !this.participants.includes(id) || !this.wantsDirect(id)) {
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
    this.tuneSenders(peer);
    await this.setLocal(peer, await peer.pc.createOffer());
    if (this.peers.get(id) !== peer) return;
    this.sendSdp(id, peer);
  }

  /**
   * Our side of the call setup, with Opus asked to send voice well (FEC, DTX, mono, 32 kbit/s).
   * Should a browser refuse the tuned description, the original is used.
   */
  private async setLocal(peer: Peer, desc: RTCSessionDescriptionInit): Promise<void> {
    const tuned = desc.sdp ? tuneOpusSdp(desc.sdp) : desc.sdp;
    if (tuned === desc.sdp) return peer.pc.setLocalDescription(desc);
    try {
      await peer.pc.setLocalDescription({ type: desc.type, sdp: tuned } as RTCSessionDescriptionInit);
    } catch {
      await peer.pc.setLocalDescription(desc);
    }
  }

  private stateSignal(): Signal {
    return {
      type: 'state',
      camera: !!this.local.camera,
      screen: !!this.local.screen,
      // What the person chose (or a moderator imposed), not the voice-activity gate or push-to-talk:
      // a gated voice is silent anyway, and people talking would otherwise look muted to others.
      muted: this.muted || this.deafened || this.serverMuted || this.serverDeafened,
      ...(this.priority ? { priority: true } : {}),
      ...(this.hand !== null ? { hand: this.hand } : {}),
    };
  }

  private broadcastState(): void {
    for (const id of this.participants) {
      if (id === this.me) continue;
      const p = this.peers.get(id);
      if (p?.pc.connectionState === 'connected' || this.relayPeers.has(id)) this.send(id, this.stateSignal());
    }
  }

  private sendSdp(to: string, peer: Peer): void {
    const sid = peer.sid ? { sid: peer.sid } : {};
    this.send(to, { type: 'sdp', description: peer.pc.localDescription!.toJSON(), ...sid });
    peer.sdpSent = true;
    for (const candidate of peer.outgoingIce.splice(0)) this.send(to, { type: 'ice', candidate, ...sid });
  }

  /**
   * Voice goes first when the network is tight; screen share keeps resolution over frame rate;
   * video bandwidth is shared between everyone watching (videoBitrates).
   */
  private tuneSenders(peer: Peer): void {
    const video = videoBitrates(this.peers.size);
    const [audio, camera, screen] = peer.pc.getTransceivers().map((t) => t.sender);
    this.tuneSender(audio, (e) => {
      e.priority = 'high';
      e.networkPriority = 'high';
    });
    this.tuneSender(camera, (e) => {
      e.maxBitrate = video.camera;
      e.scaleResolutionDownBy = video.cameraScale;
    });
    this.tuneSender(screen, (e, params) => {
      e.maxBitrate = video.screen;
      params.degradationPreference = 'maintain-resolution';
    });
  }

  private tuneSender(
    sender: RTCRtpSender | undefined,
    set: (e: RTCRtpEncodingParameters, p: RTCRtpSendParameters) => void,
  ): void {
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      set(params.encodings[0]!, params);
      void sender.setParameters(params).catch(() => undefined);
    } catch {
      // not supported here
    }
  }

  /** The number of direct connections changed: share video bandwidth out again. */
  private tuneVideo(): void {
    for (const peer of this.peers.values())
      if (peer.pc.connectionState === 'connected') this.tuneSenders(peer);
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
    if (peer.directAudio && peer.remote.audio === peer.directAudio) {
      peer.remote.audio = null;
      this.watch(id, null);
    }
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
