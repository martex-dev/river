import sodium from 'libsodium-wrappers-sumo';
import { native, NativeError } from '../native.ts';

/**
 * The subset of node:crypto River's client core uses, backed by the platform
 * (javax.crypto on Android) through the native interface, and libsodium for
 * Ed25519. Same algorithms, same bytes as on the desktop.
 */

const b64 = (u: Uint8Array): string => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString('base64');
const fromB64 = (s: string): Buffer => Buffer.from(s, 'base64');
const bytesOf = (data: Uint8Array | string, encoding?: BufferEncoding): Buffer =>
  typeof data === 'string' ? Buffer.from(data, encoding ?? 'utf8') : Buffer.from(data);

function encode(buf: Buffer, encoding?: BufferEncoding): Buffer | string {
  return encoding ? buf.toString(encoding) : buf;
}

export function randomBytes(n: number): Buffer {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('randomBytes: bad size');
  if (n === 0) return Buffer.alloc(0);
  const out = Buffer.alloc(n);
  // Web Crypto's CSPRNG is synchronous; it is limited to 64 KiB per call.
  for (let i = 0; i < n; i += 65536)
    globalThis.crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

/** Uniform integer in [min, max) without modulo bias, like Node's. */
export function randomInt(min: number, max?: number): number {
  if (max === undefined) {
    max = min;
    min = 0;
  }
  const range = max - min;
  if (!Number.isSafeInteger(range) || range <= 0 || range > 2 ** 48)
    throw new RangeError('randomInt: bad range');
  const limit = Math.floor(2 ** 48 / range) * range;
  for (;;) {
    const b = randomBytes(6);
    const x = b.readUIntBE(0, 6);
    if (x < limit) return min + (x % range);
  }
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

class Hash {
  private readonly parts: Buffer[] = [];
  private readonly alg: 'sha256' | 'sha512';
  constructor(alg: string) {
    if (alg !== 'sha256' && alg !== 'sha512') throw new Error(`Digest method not supported: ${alg}`);
    this.alg = alg;
  }
  update(data: Uint8Array | string, encoding?: BufferEncoding): this {
    this.parts.push(bytesOf(data, encoding));
    return this;
  }
  digest(): Buffer;
  digest(encoding: BufferEncoding): string;
  digest(encoding?: BufferEncoding): Buffer | string {
    return encode(
      fromB64(native('digest', { alg: this.alg, data: b64(Buffer.concat(this.parts)) })),
      encoding,
    );
  }
}

export function createHash(alg: string): Hash {
  return new Hash(alg);
}

class Hmac {
  private readonly parts: Buffer[] = [];
  private readonly key: Buffer;
  constructor(alg: string, key: Uint8Array | string) {
    if (alg !== 'sha256') throw new Error(`HMAC digest not supported: ${alg}`);
    this.key = bytesOf(key);
  }
  update(data: Uint8Array | string, encoding?: BufferEncoding): this {
    this.parts.push(bytesOf(data, encoding));
    return this;
  }
  digest(): Buffer;
  digest(encoding: BufferEncoding): string;
  digest(encoding?: BufferEncoding): Buffer | string {
    const out = native('hmac', { alg: 'sha256', key: b64(this.key), data: b64(Buffer.concat(this.parts)) });
    return encode(fromB64(out), encoding);
  }
}

export function createHmac(alg: string, key: Uint8Array | string): Hmac {
  return new Hmac(alg, key);
}

export function hkdfSync(
  alg: string,
  ikm: Uint8Array | string,
  salt: Uint8Array | string,
  info: Uint8Array | string,
  length: number,
): ArrayBuffer {
  if (alg !== 'sha256') throw new Error(`HKDF digest not supported: ${alg}`);
  const out = fromB64(
    native('hkdf', {
      alg: 'sha256',
      ikm: b64(bytesOf(ikm)),
      salt: b64(bytesOf(salt)),
      info: b64(bytesOf(info)),
      length,
    }),
  );
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

type CipherAlg = 'aes-256-gcm' | 'aes-256-cbc';

function checkCipher(alg: string, key: Uint8Array, iv: Uint8Array): CipherAlg {
  if (alg !== 'aes-256-gcm' && alg !== 'aes-256-cbc') throw new Error(`Unknown cipher: ${alg}`);
  if (key.length !== 32) throw new RangeError('Invalid key length');
  if (alg === 'aes-256-gcm' ? iv.length !== 12 : iv.length !== 16)
    throw new RangeError('Invalid initialization vector');
  return alg;
}

/**
 * Collects input and encrypts on final(): River only ever encrypts whole
 * messages, so streaming is not needed. update() returns an empty buffer.
 */
class Cipher {
  private readonly alg: CipherAlg;
  private readonly key: Buffer;
  private readonly iv: Buffer;
  private aad = Buffer.alloc(0);
  private readonly parts: Buffer[] = [];
  private tag: Buffer | null = null;
  constructor(alg: string, key: Uint8Array, iv: Uint8Array) {
    this.alg = checkCipher(alg, key, iv);
    this.key = Buffer.from(key);
    this.iv = Buffer.from(iv);
  }
  setAAD(aad: Uint8Array): this {
    this.aad = Buffer.from(aad);
    return this;
  }
  update(data: Uint8Array | string, encoding?: BufferEncoding): Buffer {
    this.parts.push(bytesOf(data, encoding));
    return Buffer.alloc(0);
  }
  final(): Buffer {
    const data = b64(Buffer.concat(this.parts));
    if (this.alg === 'aes-256-cbc') {
      return fromB64(native('aesCbc', { encrypt: true, key: b64(this.key), iv: b64(this.iv), data }));
    }
    const sealed = fromB64(
      native('aesGcmSeal', { key: b64(this.key), iv: b64(this.iv), aad: b64(this.aad), data }),
    );
    this.tag = sealed.subarray(sealed.length - 16);
    return sealed.subarray(0, sealed.length - 16);
  }
  getAuthTag(): Buffer {
    if (!this.tag) throw new Error('Authentication tag is only available after final()');
    return this.tag;
  }
}

class Decipher {
  private readonly alg: CipherAlg;
  private readonly key: Buffer;
  private readonly iv: Buffer;
  private aad = Buffer.alloc(0);
  private readonly parts: Buffer[] = [];
  private tag: Buffer | null = null;
  constructor(alg: string, key: Uint8Array, iv: Uint8Array) {
    this.alg = checkCipher(alg, key, iv);
    this.key = Buffer.from(key);
    this.iv = Buffer.from(iv);
  }
  setAAD(aad: Uint8Array): this {
    this.aad = Buffer.from(aad);
    return this;
  }
  setAuthTag(tag: Uint8Array): this {
    if (tag.length !== 16) throw new Error('Invalid authentication tag length');
    this.tag = Buffer.from(tag);
    return this;
  }
  update(data: Uint8Array | string, encoding?: BufferEncoding): Buffer {
    this.parts.push(bytesOf(data, encoding));
    return Buffer.alloc(0);
  }
  final(): Buffer {
    const body = Buffer.concat(this.parts);
    try {
      if (this.alg === 'aes-256-cbc') {
        return fromB64(
          native('aesCbc', { encrypt: false, key: b64(this.key), iv: b64(this.iv), data: b64(body) }),
        );
      }
      if (!this.tag) throw new Error('Missing authentication tag');
      return fromB64(
        native('aesGcmOpen', {
          key: b64(this.key),
          iv: b64(this.iv),
          aad: b64(this.aad),
          data: b64(Buffer.concat([body, this.tag])),
        }),
      );
    } catch (err) {
      if (err instanceof NativeError) {
        throw new Error('Unsupported state or unable to authenticate data', { cause: err });
      }
      throw err;
    }
  }
}

export function createCipheriv(alg: string, key: Uint8Array, iv: Uint8Array): Cipher {
  return new Cipher(alg, key, iv);
}

export function createDecipheriv(alg: string, key: Uint8Array, iv: Uint8Array): Decipher {
  return new Decipher(alg, key, iv);
}

/** Only Ed25519 public keys in JWK form (the home-server beacon key). */
interface Ed25519Key {
  readonly type: 'public';
  readonly raw: Uint8Array;
}

export function createPublicKey(input: {
  key: { kty: string; crv: string; x: string };
  format: 'jwk';
}): Ed25519Key {
  if (input.format !== 'jwk' || input.key.kty !== 'OKP' || input.key.crv !== 'Ed25519') {
    throw new Error('Only Ed25519 JWK public keys are supported');
  }
  const raw = Buffer.from(input.key.x, 'base64url');
  if (raw.length !== 32) throw new Error('Invalid Ed25519 public key');
  return { type: 'public', raw };
}

/** Ed25519 verification with libsodium (crypto_sign_verify_detached). Call ready() first. */
export function verify(alg: null, data: Uint8Array, key: Ed25519Key, signature: Uint8Array): boolean {
  if (alg !== null) throw new Error('Only Ed25519 (algorithm null) is supported');
  if (signature.length !== 64) return false;
  return sodium.crypto_sign_verify_detached(signature, data, key.raw);
}

/** Release signing (desktop updates) is not part of the phone app. */
export function createPrivateKey(): never {
  throw new Error('Private key objects are not available on phones');
}

export function sign(): never {
  throw new Error('Signing with key objects is not available on phones');
}

export type KeyObject = Ed25519Key;

/** Resolves once libsodium is initialised; the core awaits it before starting. */
export const ready: Promise<void> = sodium.ready;

export default {
  randomBytes,
  randomUUID,
  randomInt,
  timingSafeEqual,
  createHash,
  createHmac,
  hkdfSync,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  createPrivateKey,
  sign,
  verify,
};
