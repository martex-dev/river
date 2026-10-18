import workletUrl from './relay-worklet.ts?worker&url';
import { ReplayGuard, importSenderKey, newSenderKey, openFrame, sealFrame } from './relay-crypto.ts';
import { LossMeter, SendGate, chunk } from './relay-quality.ts';

/**
 * Voice through the River server for people who cannot connect directly
 * (1.0.17), and for everyone in large rooms (2.13). The microphone is encoded
 * with Opus (WebCodecs), each frame is encrypted with this call's sender key
 * (relay-crypto.ts) and sent over the existing server connection — to just the
 * people relayed with, or in a large room once for everyone in the call; their
 * frames are decrypted, decoded and played through a jitter buffer. Frames go
 * out only while you talk (SendGate), plus one quiet frame about once a second.
 * Audio only: camera and screen still need a direct connection.
 */
export interface RelayEngine {
  /** WebCodecs and AudioWorklet are available. */
  readonly available: boolean;
  start(mic: MediaStreamTrack | null): Promise<void>;
  setMic(mic: MediaStreamTrack | null): void;
  setTransmitting(on: boolean): void;
  /** People our voice goes to through the server (empty: nothing is sent). */
  setRecipients(ids: string[]): void;
  /** Large room: each frame goes once to everyone in the call instead of to each recipient. */
  setBroadcast(on: boolean): void;
  /** Opus bitrate (bits per second) for our voice. */
  setBitrate(bps: number): void;
  /** Our sender key, to give to people we relay with. */
  ownKey(): Uint8Array;
  setPeerKey(id: string, raw: Uint8Array): Promise<void>;
  receive(from: string, payload: Uint8Array): void;
  /** Playable voice of a relayed person (created on first use). */
  streamFor(id: string): MediaStream | null;
  /** Frames received from a person (diagnostics). */
  received(id: string): number;
  /** Share of this person's frames we missed since last asked (null: too few to tell). */
  loss(id: string): number | null;
  dropPeer(id: string): void;
  close(): void;
}

/** How relayed frames leave this app (the server connection, in main). */
export interface RelaySink {
  /** To these people (at most MAX_RELAY_RECIPIENTS per frame). */
  to(ids: string[], payload: Uint8Array): void;
  /** To everyone else in the call; null when the server cannot (then `to` is used in groups). */
  all: ((payload: Uint8Array) => void) | null;
}

const SAMPLE_RATE = 48_000;
/**
 * While not sending (muted, deafened, push-to-talk released, or just silent), one quiet frame goes
 * out every this many frames (≈1 s), so the other side still knows we are there (2.11.3: a call
 * whose other side vanished ends; a muted person has not vanished).
 */
const KEEPALIVE_EVERY = 50;
/** Recipients per frame the wire format allows (MAX_RELAY_RECIPIENTS). */
const RECIPIENTS_PER_FRAME = 24;
const OPUS = { codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1 } as const;
const DEFAULT_BITRATE = 32_000;

/**
 * Opus tuned for voice over the relay: 20 ms frames, full complexity. No in-band FEC (a frame the
 * server drops cannot be rebuilt from the next one through WebCodecs) and no DTX (SendGate already
 * stops sending during silence, and the keep-alive frames must not be swallowed).
 */
function encoderConfig(bitrate: number): AudioEncoderConfig {
  return {
    ...OPUS,
    bitrate,
    bitrateMode: 'variable',
    opus: { frameDuration: 20_000, complexity: 10, useinbandfec: false, usedtx: false },
  } as AudioEncoderConfig;
}

interface RemoteVoice {
  key: CryptoKey;
  replay: ReplayGuard;
  decoder: AudioDecoder;
  node: AudioWorkletNode;
  out: MediaStreamAudioDestinationNode;
  frames: number;
  meter: LossMeter;
  /** Decryption chains in order so frames are decoded in sequence. */
  chain: Promise<void>;
}

export function webCodecsAvailable(): boolean {
  return (
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioDecoder !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined'
  );
}

export class WebCodecsRelay implements RelayEngine {
  readonly available = webCodecsAvailable();
  private readonly me: string;
  private readonly sink: RelaySink;
  private ctx: AudioContext | null = null;
  private ready: Promise<void> | null = null;
  private key: { key: CryptoKey; raw: Uint8Array } | null = null;
  private encoder: AudioEncoder | null = null;
  private tuned = true;
  private bitrate = DEFAULT_BITRATE;
  private capture: AudioWorkletNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private recipients: string[] = [];
  private broadcast = false;
  private transmitting = true;
  private readonly gate = new SendGate();
  private seq = 0;
  /** Frames are sealed and sent strictly in order (receivers accept sequence numbers moving forward). */
  private shipping: Promise<void> = Promise.resolve();
  private quietFrames = 0;
  private timestamp = 0;
  private readonly remotes = new Map<string, RemoteVoice>();
  private closed = false;

  /** `send` is the old form (to these people only); a RelaySink also knows "to everyone". */
  constructor(me: string, send: ((to: string[], payload: Uint8Array) => void) | RelaySink) {
    this.me = me;
    this.sink = typeof send === 'function' ? { to: send, all: null } : send;
  }

  async start(mic: MediaStreamTrack | null): Promise<void> {
    if (!this.available || this.ready) return this.ready ?? undefined;
    this.ready = (async () => {
      this.key = await newSenderKey();
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
      // After sleep (or an audio device change) the engine can stop: start it again.
      this.ctx.addEventListener?.('statechange', () => this.wake());
      await this.ctx.audioWorklet.addModule(workletUrl);
      this.capture = new AudioWorkletNode(this.ctx, 'river-capture', { numberOfOutputs: 0 });
      this.capture.port.onmessage = (e: MessageEvent<Float32Array>) => this.encode(e.data);
      this.tuned = await Promise.resolve()
        .then(() => AudioEncoder.isConfigSupported(encoderConfig(this.bitrate)))
        .then((r) => r.supported === true)
        .catch(() => false);
      this.makeEncoder();
      this.setMic(mic);
    })();
    return this.ready;
  }

  /** A suspended or interrupted engine plays and captures nothing: resume it (unless we closed it). */
  private wake(): void {
    const state = this.ctx?.state as string | undefined;
    if (this.closed || !this.ctx || (state !== 'suspended' && state !== 'interrupted')) return;
    void this.ctx.resume().catch(() => undefined);
  }

  /** (Re)creates the encoder: at start, after it failed, or for a new bitrate. */
  private makeEncoder(): void {
    try {
      if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    } catch {
      // already closed
    }
    const encoder = new AudioEncoder({
      output: (encoded) => {
        const bytes = new Uint8Array(encoded.byteLength);
        encoded.copyTo(bytes);
        this.shipping = this.shipping.then(() => this.ship(bytes)).catch(() => undefined);
      },
      error: (err) => {
        console.warn('voice relay: encoder failed, starting a new one', err);
        // A failed encoder is closed for good: without a new one our voice would just stop.
        if (!this.closed && this.encoder === encoder) queueMicrotask(() => this.makeEncoder());
      },
    });
    try {
      encoder.configure(this.tuned ? encoderConfig(this.bitrate) : { ...OPUS, bitrate: this.bitrate });
    } catch {
      this.tuned = false;
      encoder.configure({ ...OPUS, bitrate: this.bitrate });
    }
    this.encoder = encoder;
  }

  setMic(mic: MediaStreamTrack | null): void {
    if (!this.ctx || !this.capture) return;
    this.micSource?.disconnect();
    this.micSource = null;
    this.gate.reset();
    if (!mic) return;
    this.micSource = this.ctx.createMediaStreamSource(new MediaStream([mic]));
    this.micSource.connect(this.capture);
  }

  setTransmitting(on: boolean): void {
    this.transmitting = on;
  }

  setRecipients(ids: string[]): void {
    this.recipients = ids;
  }

  setBroadcast(on: boolean): void {
    this.broadcast = on;
  }

  setBitrate(bps: number): void {
    const next = Math.round(Math.min(64_000, Math.max(8_000, bps)));
    if (next === this.bitrate) return;
    this.bitrate = next;
    if (this.encoder && !this.closed) this.makeEncoder();
  }

  ownKey(): Uint8Array {
    if (!this.key) throw new Error('relay not started');
    return this.key.raw;
  }

  async setPeerKey(id: string, raw: Uint8Array): Promise<void> {
    if (!this.ctx) {
      await this.ready;
      if (!this.ctx || this.closed) return;
    }
    const key = await importSenderKey(raw);
    if (this.closed) return;
    const existing = this.remotes.get(id);
    if (existing) {
      // The same key again (senders repeat it): nothing changes, its sequence included.
      if (!existing.replay.rekey(raw)) return;
      existing.key = key;
      existing.meter.restart();
      return;
    }
    this.remotes.set(id, this.makeRemote(key, raw));
  }

  receive(from: string, payload: Uint8Array): void {
    const r = this.remotes.get(from);
    if (!r || this.closed) return;
    r.chain = r.chain.then(async () => {
      try {
        const { seq, plain } = await openFrame(r.key, from, payload);
        if (!r.replay.accept(seq)) return;
        r.frames += 1;
        r.meter.frame(seq);
        // A decoder that failed (a damaged packet) is closed for good: start a new one, or this
        // person would go silent for the rest of the call.
        if (r.decoder.state === 'closed') r.decoder = this.makeDecoder(r.node);
        if (r.decoder.state === 'configured')
          r.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: seq * 20_000, data: plain }));
      } catch {
        // Tampered with, or from before a key change: dropped.
      }
    });
  }

  streamFor(id: string): MediaStream | null {
    return this.remotes.get(id)?.out.stream ?? null;
  }

  received(id: string): number {
    return this.remotes.get(id)?.frames ?? 0;
  }

  loss(id: string): number | null {
    return this.remotes.get(id)?.meter.take() ?? null;
  }

  dropPeer(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    try {
      r.decoder.close();
    } catch {
      // already closed
    }
    r.node.port.onmessage = null;
    r.node.disconnect();
    r.out.disconnect();
  }

  close(): void {
    this.closed = true;
    for (const id of [...this.remotes.keys()]) this.dropPeer(id);
    this.micSource?.disconnect();
    this.micSource = null;
    if (this.capture) this.capture.port.onmessage = null;
    try {
      this.encoder?.close();
    } catch {
      // already closed
    }
    void this.ctx?.close().catch(() => undefined);
  }

  private makeDecoder(node: AudioWorkletNode): AudioDecoder {
    const decoder = new AudioDecoder({
      output: (data) => {
        const samples = new Float32Array(data.numberOfFrames);
        data.copyTo(samples, { planeIndex: 0, format: 'f32-planar' });
        data.close();
        node.port.postMessage(samples, [samples.buffer]);
      },
      error: (err) => console.warn('voice relay: decoder failed', err),
    });
    decoder.configure(OPUS);
    return decoder;
  }

  private makeRemote(key: CryptoKey, raw: Uint8Array): RemoteVoice {
    const ctx = this.ctx!;
    const node = new AudioWorkletNode(ctx, 'river-playout', { numberOfInputs: 0, outputChannelCount: [1] });
    const out = ctx.createMediaStreamDestination();
    node.connect(out);
    return {
      key,
      replay: new ReplayGuard(raw),
      decoder: this.makeDecoder(node),
      node,
      out,
      frames: 0,
      meter: new LossMeter(),
      chain: Promise.resolve(),
    };
  }

  private encode(captured: Float32Array): void {
    if (!this.encoder || this.encoder.state !== 'configured') return;
    if (this.recipients.length === 0) return;
    // Talking: what the gate lets through (with the moment before). Silent, muted or push-to-talk
    // released: only now and then, and only silence.
    const frames = this.transmitting ? this.gate.push(captured) : [];
    if (!this.transmitting) this.gate.reset();
    if (frames.length > 0) this.quietFrames = 0;
    else if (++this.quietFrames % KEEPALIVE_EVERY === 0) frames.push(new Float32Array(captured.length));
    for (const samples of frames) {
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: SAMPLE_RATE,
        numberOfFrames: samples.length,
        numberOfChannels: 1,
        timestamp: this.timestamp,
        data: samples as Float32Array<ArrayBuffer>,
      });
      this.timestamp += 20_000;
      this.encoder.encode(data);
      data.close();
    }
  }

  private async ship(bytes: Uint8Array): Promise<void> {
    if (!this.key || this.recipients.length === 0 || this.closed) return;
    const frame = await sealFrame(this.key.key, this.me, this.seq++, bytes);
    if (this.broadcast && this.sink.all) this.sink.all(frame);
    else for (const group of chunk(this.recipients, RECIPIENTS_PER_FRAME)) this.sink.to(group, frame);
  }
}
