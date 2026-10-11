/**
 * AudioWorklet processors for the voice relay (1.0.17): `river-capture` cuts
 * the microphone into 20 ms chunks for the Opus encoder; `river-playout`
 * plays decoded voice through a small jitter buffer.
 */
import { JitterBuffer } from './jitter.ts';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

/** 20 ms at 48 kHz: one Opus frame. */
const FRAME = 960;

class Capture extends AudioWorkletProcessor {
  private buf = new Float32Array(FRAME);
  private n = 0;
  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i]!;
      if (this.n === FRAME) {
        const out = this.buf;
        this.port.postMessage(out, [out.buffer]);
        this.buf = new Float32Array(FRAME);
        this.n = 0;
      }
    }
    return true;
  }
}

class Playout extends AudioWorkletProcessor {
  private readonly jitter = new JitterBuffer(sampleRate);
  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<Float32Array | 'stats'>) => {
      if (e.data === 'stats')
        this.port.postMessage({ underruns: this.jitter.underruns, dropped: this.jitter.dropped });
      else this.jitter.push(e.data);
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    if (out) this.jitter.pull(out);
    return true;
  }
}

registerProcessor('river-capture', Capture);
registerProcessor('river-playout', Playout);
