/**
 * The native contract of River's mobile client core.
 *
 * On a phone the client core (the same TypeScript that runs in the desktop's
 * main process) runs in a private, headless WebView. Everything it cannot do
 * with Web APIs goes through one synchronous JavaScript interface installed by
 * the app: `RiverNative.call(method, argsJson) → resultJson`.
 *
 * - Bytes travel as standard base64 strings.
 * - The result is `{"v": value}` or `{"e": message, "code"?: string}`.
 * - Cryptography is platform or libsignal code only (javax.crypto, Android
 *   Keystore, libsignal-android, SQLCipher). Nothing here is a custom primitive.
 *
 * The Android implementation lives in apps/mobile/android (RiverNative.java);
 * tests/mobile/node-native.ts implements the same contract with Node crypto,
 * libsignal-client and SQLite so the core bundle can be tested on a computer.
 * docs/mobile/native-contract.md lists every method.
 */

export type B64 = string;

export interface LocalAddress {
  priv: B64;
  pub: B64;
  regId: number;
  name: string;
  deviceId: number;
}

export type PreKeyKind = 'prekey' | 'signed' | 'kyber';

export interface RemoteAddress {
  name: string;
  deviceId: number;
}

export interface NativeMethods {
  // Platform cryptography
  random: [{ n: number }, B64];
  digest: [{ alg: 'sha256' | 'sha512'; data: B64 }, B64];
  hmac: [{ alg: 'sha256'; key: B64; data: B64 }, B64];
  hkdf: [{ alg: 'sha256'; ikm: B64; salt: B64; info: B64; length: number }, B64];
  /** Returns ciphertext ‖ 16-byte tag. */
  aesGcmSeal: [{ key: B64; iv: B64; aad: B64; data: B64 }, B64];
  /** `data` is ciphertext ‖ tag. Fails with code "auth" when the tag does not verify. */
  aesGcmOpen: [{ key: B64; iv: B64; aad: B64; data: B64 }, B64];
  /** AES-256-CBC with PKCS#7 padding. */
  aesCbc: [{ encrypt: boolean; key: B64; iv: B64; data: B64 }, B64];
  gzip: [{ data: B64 }, B64];
  /** Fails with code "too_large" past `max` output bytes. */
  gunzip: [{ data: B64; max: number }, B64];

  // Files, confined to the app's private storage
  'fs.paths': [Record<string, never>, { data: string; cache: string; documents: string; downloads: string }];
  'fs.read': [{ path: string }, B64];
  'fs.write': [{ path: string; data: B64; append?: boolean }, null];
  'fs.stat': [{ path: string }, { size: number; mtimeMs: number; dir: boolean } | null];
  'fs.list': [{ path: string }, string[]];
  'fs.mkdir': [{ path: string }, null];
  'fs.rename': [{ from: string; to: string }, null];
  'fs.remove': [{ path: string; recursive?: boolean }, null];
  'fs.copy': [{ from: string; to: string }, null];

  // Android Keystore: wraps the local database key
  'keystore.usable': [Record<string, never>, boolean];
  'keystore.name': [Record<string, never>, string];
  'keystore.wrap': [{ data: B64 }, B64];
  'keystore.unwrap': [{ data: B64 }, B64];

  // SQLCipher (SQLCipher 4 format, same as the desktop)
  /** Opens (or creates) the file keyed with a raw 32-byte key; fails with SQLITE_NOTADB on a wrong key. */
  'db.open': [{ path: string; key: B64 }, number];
  'db.close': [{ db: number }, null];
  /** One statement per call; the core splits scripts. */
  'db.run': [{ db: number; sql: string; params: unknown[] }, { changes: number; lastInsertRowid: number }];
  'db.all': [{ db: number; sql: string; params: unknown[] }, { columns: string[]; rows: unknown[][] }];

  // libsignal
  'sig.keyPair': [Record<string, never>, { priv: B64; pub: B64 }];
  'sig.publicOf': [{ priv: B64 }, B64];
  /** Validates a serialised public key and returns it. */
  'sig.checkPublic': [{ pub: B64 }, B64];
  'sig.checkPrivate': [{ priv: B64 }, B64];
  'sig.sign': [{ priv: B64; data: B64 }, B64];
  'sig.verify': [{ pub: B64; data: B64; sig: B64 }, boolean];
  'sig.kemKeyPair': [Record<string, never>, { handle: number; pub: B64 }];
  'sig.checkKemPublic': [{ pub: B64 }, B64];
  'sig.preKeyRecord': [{ id: number; pub: B64; priv: B64 }, B64];
  'sig.signedPreKeyRecord': [{ id: number; ts: number; pub: B64; priv: B64; sig: B64 }, B64];
  /** Consumes (frees) the KEM key pair handle. */
  'sig.kyberPreKeyRecord': [{ id: number; ts: number; handle: number; sig: B64 }, B64];
  'sig.recordInfo': [
    { kind: 'prekey' | 'signed' | 'kyber'; record: B64 },
    { id: number; pub: B64; sig: B64 | null },
  ];
  'sig.sessionInfo': [{ record: B64 }, { current: boolean; remoteIdentity: B64 | null }];
  'sig.fingerprint': [
    { iterations: number; version: number; localId: B64; localKey: B64; remoteId: B64; remoteKey: B64 },
    { display: string; scannable: B64 },
  ];
  'sig.processBundle': [
    {
      local: LocalAddress;
      remote: RemoteAddress;
      session: B64 | null;
      bundle: {
        registrationId: number;
        deviceId: number;
        preKeyId: number | null;
        preKey: B64 | null;
        signedPreKeyId: number;
        signedPreKey: B64;
        signedPreKeySignature: B64;
        identityKey: B64;
        kyberPreKeyId: number;
        kyberPreKey: B64;
        kyberPreKeySignature: B64;
      };
    },
    { session: B64 },
  ];
  'sig.encrypt': [
    { local: LocalAddress; remote: RemoteAddress; session: B64; data: B64 },
    { type: number; body: B64; session: B64; remoteIdentity: B64 },
  ];
  'sig.decrypt': [
    { local: LocalAddress; remote: RemoteAddress; session: B64; data: B64 },
    { data: B64; session: B64; remoteIdentity: B64 },
  ];
  /**
   * Decrypts a first (prekey) message. libsignal asks for the prekeys it needs;
   * the native side answers `{need}` for a record that is neither in `records`
   * nor in `missing`, and the caller retries with it (nothing is stored until
   * the call succeeds). Records in `missing` fail like an unknown key id.
   */
  'sig.decryptPreKey': [
    {
      local: LocalAddress;
      remote: RemoteAddress;
      session: B64 | null;
      data: B64;
      records: Array<{ kind: PreKeyKind; id: number; record: B64 }>;
      missing: Array<{ kind: PreKeyKind; id: number }>;
    },
    (
      | { need: { kind: PreKeyKind; id: number } }
      | {
          data: B64;
          session: B64;
          remoteIdentity: B64;
          usedPreKey: number | null;
          usedKyberPreKey: { id: number; signedPreKeyId: number; baseKey: B64 } | null;
        }
    ),
  ];
}

export type NativeMethod = keyof NativeMethods;

export interface NativeInterface {
  call(method: string, argsJson: string): string;
}

/** A failure reported by the native side; `code` mirrors libsignal / errno names where one exists. */
export class NativeError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'NativeError';
    this.code = code;
  }
}

function host(): NativeInterface {
  const n = (globalThis as { RiverNative?: NativeInterface }).RiverNative;
  if (!n) throw new Error('River native interface is not available');
  return n;
}

export function native<M extends NativeMethod>(method: M, args: NativeMethods[M][0]): NativeMethods[M][1] {
  const out = JSON.parse(host().call(method, JSON.stringify(args))) as {
    v?: unknown;
    e?: string;
    code?: string;
  };
  if (typeof out.e === 'string') throw new NativeError(out.e, out.code);
  return out.v as NativeMethods[M][1];
}
