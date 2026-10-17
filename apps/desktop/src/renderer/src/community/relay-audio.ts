import workletUrl from './relay-worklet.ts?worker&url';
import { ReplayGuard, importSenderKey, newSenderKey, openFrame, sealFrame } from './relay-crypto.ts';

/**
 * Voice through the River server for people who cannot connect directly
 * (1.0.17). The microphone is encoded with Opus (WebCodecs), each frame is
 * encrypted with this call's sender key (relay-crypto.ts) and sent over the
 * existing server connection to just those people; their frames are decrypted,
 * decoded and played through a jitter buffer. Audio only: camera and screen
 * still need a direct connection.
 */
export interface RelayEngine {
  /** WebCodecs and AudioWorklet are available. */
  readonly available: boolean;
  start(mic: MediaStreamTrack | null): Promise<void>;
  setMic(mic: MediaStreamTrack | null): void;
  setTransmitting(on: boolean): void;
  /** People our voice goes to through the server (empty: nothing is sent). */
  setRecipients(ids: string[]): void;
  /** Our sender key, to give to people we relay with. */
  ownKey(): Uint8Array;
  setPeerKey(id: string, raw: Uint8Array): Promise<void>;
  receive(from: string, payload: Uint8Array): void;
  /** Playable voice of a relayed person (created on first use). */
  streamFor(id: string): MediaStream | null;
  /** Frames received from a person (diagnostics). */
  received(id: string): number;
  dropPeer(id: string): void;
  close(): void;
}

const SAMPLE_RATE = 48_000;
/**
 * While not transmitting (muted, deafened, push-to-talk released), one quiet frame goes out every
 * this many frames (≈1 s), so the other side still knows we are there (2.11.3: a call whose other
 * side vanished ends; a muted person has not vanished).
 */
const KEEPALIVE_EVERY = 50;
const OPUS = { codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1 } as const;

interface RemoteVoice {
  key: CryptoKey;
  replay: ReplayGuard;
  decoder: AudioDecoder;
  node: AudioWorkletNode;
  out: MediaStreamAudioDestinationNode;
  frames: number;
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
  private readonly send: (to: string[], payload: Uint8Array) => void;
  private ctx: AudioContext | null = null;
  private ready: Promise<void> | null = null;
  private key: { key: CryptoKey; raw: Uint8Array } | null = null;
  private encoder: AudioEncoder | null = null;
  private capture: AudioWorkletNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private recipients: string[] = [];
  private transmitting = true;
  private seq = 0;
  private quietFrames = 0;
  private timestamp = 0;
  private readonly remotes = new Map<string, RemoteVoice>();
  private readonly pendingKeys = new Map<string, Uint8Array>();
  private closed = false;

  constructor(me: string, send: (to: string[], payload: Uint8Array) => void) {
    this.me = me;
    this.send = send;
  }

  async start(mic: MediaStreamTrack | null): Promise<void> {
    if (!this.available || this.ready) return this.ready ?? undefined;
    this.ready = (async () => {
      this.key = await newSenderKey();
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
      await this.ctx.audioWorklet.addModule(workletUrl);
      this.capture = new AudioWorkletNode(this.ctx, 'river-capture', { numberOfOutputs: 0 });
      this.capture.port.onmessage = (e: MessageEvent<Float32Array>) => this.encode(e.data);
      this.encoder = new AudioEncoder({
        output: (chunk) => void this.ship(chunk),
        error: (err) => console.warn('voice relay: encoder failed', err),
      });
      this.encoder.configure({ ...OPUS, bitrate: 32_000 });
      this.setMic(mic);
    })();
    return this.ready;
  }

  setMic(mic: MediaStreamTrack | null): void {
    if (!this.ctx || !this.capture) return;
    this.micSource?.disconnect();
    this.micSource = null;
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

  ownKey(): Uint8Array {
    if (!this.key) throw new Error('relay not started');
    return this.key.raw;
  }

  async setPeerKey(id: string, raw: Uint8Array): Promise<void> {
    if (!this.ctx) {
      this.pendingKeys.set(id, raw);
      await this.ready;
      if (!this.ctx) return;
    }
    const key = await importSenderKey(raw);
    const existing = this.remotes.get(id);
    if (existing) {
      existing.key = key;
      existing.replay.reset();
      return;
    }
    this.remotes.set(id, this.makeRemote(key));
  }

  receive(from: string, payload: Uint8Array): void {
    const r = this.remotes.get(from);
    if (!r || this.closed) return;
    r.chain = r.chain.then(async () => {
      try {
        const { seq, plain } = await openFrame(r.key, from, payload);
        if (!r.replay.accept(seq)) return;
        r.frames += 1;
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

  dropPeer(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    try {
      r.decoder.close();
    } catch {
      // already closed
    }
    r.node.disconnect();
  }

  close(): void {
    this.closed = true;
    for (const id of [...this.remotes.keys()]) this.dropPeer(id);
    this.micSource?.disconnect();
    try {
      this.encoder?.close();
    } catch {
      // already closed
    }
    void this.ctx?.close().catch(() => undefined);
  }

  private makeRemote(key: CryptoKey): RemoteVoice {
    const ctx = this.ctx!;
    const node = new AudioWorkletNode(ctx, 'river-playout', { numberOfInputs: 0, outputChannelCount: [1] });
    const out = ctx.createMediaStreamDestination();
    node.connect(out);
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
    return { key, replay: new ReplayGuard(), decoder, node, out, frames: 0, chain: Promise.resolve() };
  }

  private encode(captured: Float32Array): void {
    if (!this.encoder || this.encoder.state !== 'configured') return;
    if (this.recipients.length === 0) return;
    let samples = captured;
    if (!this.transmitting) {
      // Muted: only now and then, and only silence.
      if (++this.quietFrames % KEEPALIVE_EVERY !== 0) return;
      samples = new Float32Array(captured.length);
    }
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

  private async ship(chunk: EncodedAudioChunk): Promise<void> {
    if (!this.key || this.recipients.length === 0) return;
    const bytes = new Uint8Array(chunk.byteLength);
    chunk.copyTo(bytes);
    const frame = await sealFrame(this.key.key, this.me, this.seq++, bytes);
    this.send(this.recipients, frame);
  }
}
