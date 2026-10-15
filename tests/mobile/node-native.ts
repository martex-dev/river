import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3-multiple-ciphers';
import {
  Fingerprint,
  IdentityChange,
  IdentityKeyPair,
  IdentityKeyStore,
  KEMKeyPair,
  KEMPublicKey,
  KyberPreKeyRecord,
  KyberPreKeyStore,
  PreKeyBundle,
  PreKeyRecord,
  PreKeySignalMessage,
  PreKeyStore,
  PrivateKey,
  ProtocolAddress,
  PublicKey,
  SessionRecord,
  SessionStore,
  SignalMessage,
  SignedPreKeyRecord,
  SignedPreKeyStore,
  processPreKeyBundle,
  signalDecrypt,
  signalDecryptPreKey,
  signalEncrypt,
} from '@signalapp/libsignal-client';
import type {
  LocalAddress,
  NativeInterface,
  NativeMethod,
  NativeMethods,
  PreKeyKind,
  RemoteAddress,
} from '../../apps/mobile/core/native.ts';

/**
 * The phone's native contract (apps/mobile/core/native.ts) implemented with
 * Node crypto, libsignal-client and SQLite, so the mobile core bundle can be
 * tested on a computer. It mirrors apps/mobile/android's RiverNative.java:
 * session operations run over throw-away stores and report what changed.
 */

type Args<M extends NativeMethod> = NativeMethods[M][0];
type Result<M extends NativeMethod> = NativeMethods[M][1];

const b = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(s, 'base64'));
const s64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');

class Failure extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/** One remote session plus our identity, as the native side builds per call. */
class CallStores {
  session: SessionRecord | null;
  remoteIdentity: PublicKey | null = null;
  readonly records: Map<string, Uint8Array<ArrayBuffer>>;
  readonly missing: Set<string>;
  need: { kind: PreKeyKind; id: number } | null = null;
  usedPreKey: number | null = null;
  usedKyber: { id: number; signedPreKeyId: number; baseKey: string } | null = null;

  readonly sessions: SessionStore;
  readonly identities: IdentityKeyStore;
  readonly preKeys: PreKeyStore;
  readonly signed: SignedPreKeyStore;
  readonly kyber: KyberPreKeyStore;

  constructor(
    local: LocalAddress,
    session: string | null,
    records: Array<{ kind: PreKeyKind; id: number; record: string }> = [],
    missing: Array<{ kind: PreKeyKind; id: number }> = [],
  ) {
    this.session = session ? SessionRecord.deserialize(b(session)) : null;
    this.records = new Map(records.map((r) => [`${r.kind}:${r.id}`, b(r.record)]));
    this.missing = new Set(missing.map((m) => `${m.kind}:${m.id}`));
    // The store classes below have their own `this`; they report into this call's state.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const priv = PrivateKey.deserialize(b(local.priv));
    const fetch = (kind: PreKeyKind, id: number): Uint8Array<ArrayBuffer> => {
      const r = self.records.get(`${kind}:${id}`);
      if (r) return r;
      if (!self.missing.has(`${kind}:${id}`)) self.need = { kind, id };
      throw new Error(`no ${kind} prekey ${id}`);
    };
    this.sessions = new (class extends SessionStore {
      async saveSession(_a: ProtocolAddress, record: SessionRecord): Promise<void> {
        self.session = record;
      }
      async getSession(): Promise<SessionRecord | null> {
        return self.session;
      }
      async getExistingSessions(): Promise<SessionRecord[]> {
        return self.session ? [self.session] : [];
      }
    })();
    this.identities = new (class extends IdentityKeyStore {
      async getIdentityKey(): Promise<PrivateKey> {
        return priv;
      }
      async getLocalRegistrationId(): Promise<number> {
        return local.regId;
      }
      async saveIdentity(_a: ProtocolAddress, key: PublicKey): Promise<IdentityChange> {
        self.remoteIdentity = key;
        return IdentityChange.NewOrUnchanged;
      }
      // River decides trust in JavaScript, before anything is stored.
      async isTrustedIdentity(_a: ProtocolAddress, key: PublicKey): Promise<boolean> {
        self.remoteIdentity = key;
        return true;
      }
      async getIdentity(): Promise<PublicKey | null> {
        return self.remoteIdentity;
      }
    })();
    this.preKeys = new (class extends PreKeyStore {
      async savePreKey(): Promise<void> {}
      async getPreKey(id: number): Promise<PreKeyRecord> {
        return PreKeyRecord.deserialize(fetch('prekey', id));
      }
      async removePreKey(id: number): Promise<void> {
        self.usedPreKey = id;
      }
    })();
    this.signed = new (class extends SignedPreKeyStore {
      async saveSignedPreKey(): Promise<void> {}
      async getSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
        return SignedPreKeyRecord.deserialize(fetch('signed', id));
      }
    })();
    this.kyber = new (class extends KyberPreKeyStore {
      async saveKyberPreKey(): Promise<void> {}
      async getKyberPreKey(id: number): Promise<KyberPreKeyRecord> {
        return KyberPreKeyRecord.deserialize(fetch('kyber', id));
      }
      async markKyberPreKeyUsed(id: number, signedPreKeyId: number, baseKey: PublicKey): Promise<void> {
        self.usedKyber = { id, signedPreKeyId, baseKey: s64(baseKey.serialize()) };
      }
    })();
  }
}

const addr = (r: RemoteAddress): ProtocolAddress => ProtocolAddress.new(r.name, r.deviceId);
const localAddr = (l: LocalAddress): ProtocolAddress => ProtocolAddress.new(l.name, l.deviceId);

/**
 * libsignal-client's session functions are asynchronous in Node; the phone's
 * are synchronous. Tests run the core in a worker and block it on a
 * SharedArrayBuffer while the main thread runs these (see core-worker.ts).
 */
export const asyncMethods = new Set<NativeMethod>([
  'sig.processBundle',
  'sig.encrypt',
  'sig.decrypt',
  'sig.decryptPreKey',
]);

export function createNodeNative(root: string): {
  sync: (method: NativeMethod, args: unknown) => unknown;
  async: (method: NativeMethod, args: unknown) => Promise<unknown>;
  close: () => void;
} {
  const inRoot = (p: string): string => {
    const full = path.resolve(p);
    if (full !== root && !full.startsWith(root + path.sep))
      throw new Failure(`outside app storage: ${p}`, 'EACCES');
    return full;
  };
  const dbs = new Map<number, Database.Database>();
  const kems = new Map<number, KEMKeyPair>();
  let next = 1;

  const enoent = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') throw new Failure((err as Error).message, 'ENOENT');
      throw err;
    }
  };

  const toCell = (v: unknown): unknown => (Buffer.isBuffer(v) ? { $b: v.toString('base64') } : v);
  const fromParam = (v: unknown): unknown =>
    v && typeof v === 'object' && '$b' in v ? Buffer.from((v as { $b: string }).$b, 'base64') : v;

  const sync: { [M in NativeMethod]?: (a: Args<M>) => Result<M> } = {
    random: (a) => s64(crypto.randomBytes(a.n)),
    digest: (a) => s64(crypto.createHash(a.alg).update(b(a.data)).digest()),
    hmac: (a) => s64(crypto.createHmac(a.alg, b(a.key)).update(b(a.data)).digest()),
    hkdf: (a) => s64(new Uint8Array(crypto.hkdfSync(a.alg, b(a.ikm), b(a.salt), b(a.info), a.length))),
    aesGcmSeal: (a) => {
      const c = crypto.createCipheriv('aes-256-gcm', b(a.key), b(a.iv));
      c.setAAD(b(a.aad));
      return s64(Buffer.concat([c.update(b(a.data)), c.final(), c.getAuthTag()]));
    },
    aesGcmOpen: (a) => {
      const data = b(a.data);
      try {
        const d = crypto.createDecipheriv('aes-256-gcm', b(a.key), b(a.iv));
        d.setAAD(b(a.aad));
        d.setAuthTag(data.subarray(data.length - 16));
        return s64(Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]));
      } catch {
        throw new Failure('authentication failed', 'auth');
      }
    },
    aesCbc: (a) => {
      const c = (a.encrypt ? crypto.createCipheriv : crypto.createDecipheriv)(
        'aes-256-cbc',
        b(a.key),
        b(a.iv),
      );
      return s64(Buffer.concat([c.update(b(a.data)), c.final()]));
    },
    gzip: (a) => s64(zlib.gzipSync(b(a.data))),
    gunzip: (a) => {
      try {
        return s64(zlib.gunzipSync(b(a.data), { maxOutputLength: a.max }));
      } catch (err) {
        throw new Failure((err as Error).message, 'too_large');
      }
    },

    'fs.paths': () => ({
      data: path.join(root, 'files'),
      cache: path.join(root, 'cache'),
      documents: path.join(root, 'documents'),
      downloads: path.join(root, 'downloads'),
    }),
    'fs.read': (a) => enoent(() => fs.readFileSync(inRoot(a.path)).toString('base64')),
    'fs.write': (a) => {
      const p = inRoot(a.path);
      enoent(() => (a.append ? fs.appendFileSync : fs.writeFileSync)(p, b(a.data)));
      return null;
    },
    'fs.stat': (a) => {
      const st = fs.statSync(inRoot(a.path), { throwIfNoEntry: false });
      return st ? { size: st.size, mtimeMs: st.mtimeMs, dir: st.isDirectory() } : null;
    },
    'fs.list': (a) => enoent(() => fs.readdirSync(inRoot(a.path))),
    'fs.mkdir': (a) => {
      fs.mkdirSync(inRoot(a.path), { recursive: true });
      return null;
    },
    'fs.rename': (a) => {
      enoent(() => fs.renameSync(inRoot(a.from), inRoot(a.to)));
      return null;
    },
    'fs.remove': (a) => {
      const p = inRoot(a.path);
      if (!fs.existsSync(p)) throw new Failure(`no such file: ${a.path}`, 'ENOENT');
      fs.rmSync(p, { recursive: !!a.recursive });
      return null;
    },
    'fs.copy': (a) => {
      enoent(() => fs.copyFileSync(inRoot(a.from), inRoot(a.to)));
      return null;
    },

    // A test "keystore": a fixed key, standing in for the Android Keystore.
    'keystore.usable': () => true,
    'keystore.name': () => 'Test keystore',
    'keystore.wrap': (a) => s64(Buffer.concat([Buffer.from('wrapped:'), b(a.data)])),
    'keystore.unwrap': (a) => s64(b(a.data).subarray(8)),

    'db.open': (a) => {
      const db = new Database(inRoot(a.path));
      try {
        db.pragma("cipher = 'sqlcipher'");
        db.pragma('legacy = 4');
        db.pragma(`key = "x'${Buffer.from(a.key, 'base64').toString('hex')}'"`);
        db.prepare('SELECT count(*) FROM sqlite_master').get();
      } catch (err) {
        db.close();
        throw new Failure((err as Error).message, (err as { code?: string }).code);
      }
      const id = next++;
      dbs.set(id, db);
      return id;
    },
    'db.close': (a) => {
      dbs.get(a.db)?.close();
      dbs.delete(a.db);
      return null;
    },
    'db.run': (a) => {
      const db = dbs.get(a.db);
      if (!db) throw new Failure('database is closed', 'SQLITE_MISUSE');
      try {
        const st = db.prepare(a.sql);
        if (st.reader) {
          st.all(...a.params.map(fromParam));
          return { changes: 0, lastInsertRowid: 0 };
        }
        const r = st.run(...a.params.map(fromParam));
        return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
      } catch (err) {
        throw new Failure((err as Error).message, (err as { code?: string }).code);
      }
    },
    'db.all': (a) => {
      const db = dbs.get(a.db);
      if (!db) throw new Failure('database is closed', 'SQLITE_MISUSE');
      try {
        const st = db.prepare(a.sql);
        if (!st.reader) {
          st.run(...a.params.map(fromParam));
          return { columns: [], rows: [] };
        }
        const columns = st.columns().map((c) => c.name);
        const rows = (st.raw(true).all(...a.params.map(fromParam)) as unknown[][]).map((r) => r.map(toCell));
        return { columns, rows };
      } catch (err) {
        throw new Failure((err as Error).message, (err as { code?: string }).code);
      }
    },

    'sig.keyPair': () => {
      const pair = IdentityKeyPair.generate();
      return { priv: s64(pair.privateKey.serialize()), pub: s64(pair.publicKey.serialize()) };
    },
    'sig.publicOf': (a) => s64(PrivateKey.deserialize(b(a.priv)).getPublicKey().serialize()),
    'sig.checkPublic': (a) => s64(PublicKey.deserialize(b(a.pub)).serialize()),
    'sig.checkPrivate': (a) => s64(PrivateKey.deserialize(b(a.priv)).serialize()),
    'sig.sign': (a) => s64(PrivateKey.deserialize(b(a.priv)).sign(b(a.data))),
    'sig.verify': (a) => {
      try {
        return PublicKey.deserialize(b(a.pub)).verify(b(a.data), b(a.sig));
      } catch {
        return false;
      }
    },
    'sig.kemKeyPair': () => {
      const pair = KEMKeyPair.generate();
      const handle = next++;
      kems.set(handle, pair);
      return { handle, pub: s64(pair.getPublicKey().serialize()) };
    },
    'sig.checkKemPublic': (a) => s64(KEMPublicKey.deserialize(b(a.pub)).serialize()),
    'sig.preKeyRecord': (a) =>
      s64(
        PreKeyRecord.new(
          a.id,
          PublicKey.deserialize(b(a.pub)),
          PrivateKey.deserialize(b(a.priv)),
        ).serialize(),
      ),
    'sig.signedPreKeyRecord': (a) =>
      s64(
        SignedPreKeyRecord.new(
          a.id,
          a.ts,
          PublicKey.deserialize(b(a.pub)),
          PrivateKey.deserialize(b(a.priv)),
          b(a.sig),
        ).serialize(),
      ),
    'sig.kyberPreKeyRecord': (a) => {
      const pair = kems.get(a.handle);
      if (!pair) throw new Failure('unknown KEM key pair');
      kems.delete(a.handle);
      return s64(KyberPreKeyRecord.new(a.id, a.ts, pair, b(a.sig)).serialize());
    },
    'sig.recordInfo': (a) => {
      if (a.kind === 'prekey') {
        const r = PreKeyRecord.deserialize(b(a.record));
        return { id: r.id(), pub: s64(r.publicKey().serialize()), sig: null };
      }
      if (a.kind === 'signed') {
        const r = SignedPreKeyRecord.deserialize(b(a.record));
        return { id: r.id(), pub: s64(r.publicKey().serialize()), sig: s64(r.signature()) };
      }
      const r = KyberPreKeyRecord.deserialize(b(a.record));
      return { id: r.id(), pub: s64(r.publicKey().serialize()), sig: s64(r.signature()) };
    },
    'sig.sessionInfo': (a) => ({
      current: SessionRecord.deserialize(b(a.record)).hasCurrentState(),
      remoteIdentity: null,
    }),
    'sig.fingerprint': (a) => {
      const fp = Fingerprint.new(
        a.iterations,
        a.version,
        b(a.localId),
        PublicKey.deserialize(b(a.localKey)),
        b(a.remoteId),
        PublicKey.deserialize(b(a.remoteKey)),
      );
      return {
        display: fp.displayableFingerprint().toString(),
        scannable: s64(fp.scannableFingerprint().toBuffer()),
      };
    },
  };

  const asyncImpl: { [M in NativeMethod]?: (a: Args<M>) => Promise<Result<M>> } = {
    'sig.processBundle': async (a) => {
      const st = new CallStores(a.local, a.session);
      const w = a.bundle;
      const bundle = PreKeyBundle.new(
        w.registrationId,
        w.deviceId,
        w.preKeyId,
        w.preKey ? PublicKey.deserialize(b(w.preKey)) : null,
        w.signedPreKeyId,
        PublicKey.deserialize(b(w.signedPreKey)),
        b(w.signedPreKeySignature),
        PublicKey.deserialize(b(w.identityKey)),
        w.kyberPreKeyId,
        KEMPublicKey.deserialize(b(w.kyberPreKey)),
        b(w.kyberPreKeySignature),
      );
      await processPreKeyBundle(bundle, addr(a.remote), localAddr(a.local), st.sessions, st.identities);
      return { session: s64(st.session!.serialize()) };
    },
    'sig.encrypt': async (a) => {
      const st = new CallStores(a.local, a.session);
      const msg = await signalEncrypt(
        b(a.data),
        addr(a.remote),
        localAddr(a.local),
        st.sessions,
        st.identities,
      );
      return {
        type: msg.type(),
        body: s64(msg.serialize()),
        session: s64(st.session!.serialize()),
        remoteIdentity: s64(st.remoteIdentity!.serialize()),
      };
    },
    'sig.decrypt': async (a) => {
      const st = new CallStores(a.local, a.session);
      const data = await signalDecrypt(
        SignalMessage.deserialize(b(a.data)),
        addr(a.remote),
        localAddr(a.local),
        st.sessions,
        st.identities,
      );
      return {
        data: s64(data),
        session: s64(st.session!.serialize()),
        remoteIdentity: s64(st.remoteIdentity!.serialize()),
      };
    },
    'sig.decryptPreKey': async (a) => {
      const st = new CallStores(a.local, a.session, a.records, a.missing);
      try {
        const data = await signalDecryptPreKey(
          PreKeySignalMessage.deserialize(b(a.data)),
          addr(a.remote),
          localAddr(a.local),
          st.sessions,
          st.identities,
          st.preKeys,
          st.signed,
          st.kyber,
        );
        return {
          data: s64(data),
          session: s64(st.session!.serialize()),
          remoteIdentity: s64(st.remoteIdentity!.serialize()),
          usedPreKey: st.usedPreKey,
          usedKyberPreKey: st.usedKyber,
        };
      } catch (err) {
        if (st.need) return { need: st.need };
        throw err;
      }
    },
  };

  const failure = (err: unknown): Failure => {
    if (err instanceof Failure) return err;
    const e = err as { message?: string; code?: unknown };
    // libsignal-client errors carry a numeric ErrorCode; the contract uses names.
    const names: Record<number, string> = {
      1: 'DuplicatedMessage',
      3: 'UntrustedIdentity',
      6: 'VerificationFailed',
      7: 'InvalidSession',
    };
    return new Failure(
      e.message ?? String(err),
      typeof e.code === 'number' ? names[e.code] : (e.code as string | undefined),
    );
  };

  return {
    close: () => {
      for (const db of dbs.values()) db.close();
      dbs.clear();
    },
    sync: (method, args) => {
      const fn = sync[method] as ((a: unknown) => unknown) | undefined;
      if (!fn) throw new Failure(`unknown native method ${method}`);
      try {
        return fn(args);
      } catch (err) {
        throw failure(err);
      }
    },
    async: async (method, args) => {
      const fn = asyncImpl[method] as ((a: unknown) => Promise<unknown>) | undefined;
      if (!fn) throw new Failure(`unknown native method ${method}`);
      try {
        return await fn(args);
      } catch (err) {
        throw failure(err);
      }
    },
  };
}

/** Encodes a call result as the native interface does. */
export function respond(run: () => unknown): string {
  try {
    return JSON.stringify({ v: run() ?? null });
  } catch (err) {
    return JSON.stringify({ e: (err as Error).message, code: (err as { code?: string }).code });
  }
}

export type { NativeInterface };
