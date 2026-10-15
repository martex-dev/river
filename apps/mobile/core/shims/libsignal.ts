import { native, NativeError, type LocalAddress, type PreKeyKind } from '../native.ts';

/**
 * The part of @signalapp/libsignal-client River uses (packages/crypto), backed
 * by libsignal-android through the native interface. Same library, same wire
 * format: phones and desktops talk to each other directly.
 *
 * Keys and records are kept as their libsignal serialisations. Session
 * operations follow libsignal's own order — trust check, crypto, save identity,
 * save session — with the stores staying in JavaScript (River's SQLCipher
 * database), while the ratchet itself runs natively.
 */

type Bytes = Uint8Array<ArrayBuffer>;

const b64 = (u: Uint8Array): string => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString('base64');
const raw = (s: string): Bytes => new Uint8Array(Buffer.from(s, 'base64'));

export const CiphertextMessageType = {
  Whisper: 2,
  PreKey: 3,
  SenderKey: 7,
  Plaintext: 8,
} as const;
export type CiphertextMessageType = (typeof CiphertextMessageType)[keyof typeof CiphertextMessageType];

export const Direction = {
  Sending: 0,
  Receiving: 1,
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

export const IdentityChange = {
  NewOrUnchanged: 0,
  ReplacedExisting: 1,
} as const;
export type IdentityChange = (typeof IdentityChange)[keyof typeof IdentityChange];

export const ErrorCode = {
  Generic: 0,
  DuplicatedMessage: 1,
  SealedSenderSelfSend: 2,
  UntrustedIdentity: 3,
  InvalidRegistrationId: 4,
  InvalidProtocolAddress: 5,
  VerificationFailed: 6,
  InvalidSession: 7,
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const CODES: Record<string, ErrorCode> = {
  DuplicatedMessage: ErrorCode.DuplicatedMessage,
  UntrustedIdentity: ErrorCode.UntrustedIdentity,
  InvalidRegistrationId: ErrorCode.InvalidRegistrationId,
  VerificationFailed: ErrorCode.VerificationFailed,
  InvalidSession: ErrorCode.InvalidSession,
};

export class LibSignalErrorBase extends Error {
  readonly code: ErrorCode;
  readonly operation: string;
  readonly addr: string | undefined;
  constructor(message: string, code: ErrorCode, operation: string, addr?: string) {
    super(message);
    this.name = 'LibSignalError';
    this.code = code;
    this.operation = operation;
    this.addr = addr;
  }
  static is(error: unknown, code: ErrorCode): boolean {
    return error instanceof LibSignalErrorBase && error.code === code;
  }
}

/** Runs a native libsignal call; native failures become LibSignalErrorBase like in Node. */
function sig<T>(operation: string, fn: () => T, addr?: string): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof NativeError) {
      throw new LibSignalErrorBase(err.message, CODES[err.code ?? ''] ?? ErrorCode.Generic, operation, addr);
    }
    throw err;
  }
}

export class PublicKey {
  private readonly bytes: Bytes;
  private constructor(bytes: Bytes) {
    this.bytes = bytes;
  }
  static deserialize(bytes: Uint8Array): PublicKey {
    return new PublicKey(
      raw(sig('PublicKey.deserialize', () => native('sig.checkPublic', { pub: b64(bytes) }))),
    );
  }
  /** @internal */
  static trusted(bytes: Bytes): PublicKey {
    return new PublicKey(bytes);
  }
  serialize(): Bytes {
    return new Uint8Array(this.bytes);
  }
  getPublicKeyBytes(): Bytes {
    return this.bytes.slice(1);
  }
  verify(msg: Uint8Array, signature: Uint8Array): boolean {
    return native('sig.verify', { pub: b64(this.bytes), data: b64(msg), sig: b64(signature) });
  }
  seal(msg: Uint8Array, info: string | Uint8Array, associatedData: Uint8Array = new Uint8Array()): Bytes {
    const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
    return raw(
      native('sig.seal', {
        pub: b64(this.bytes),
        data: b64(msg),
        info: b64(infoBytes),
        aad: b64(associatedData),
      }),
    );
  }
  equals(other: PublicKey): boolean {
    return Buffer.from(this.bytes).equals(Buffer.from(other.bytes));
  }
  compare(other: PublicKey): number {
    return Buffer.compare(Buffer.from(this.bytes), Buffer.from(other.bytes));
  }
}

export class PrivateKey {
  private readonly bytes: Bytes;
  private constructor(bytes: Bytes) {
    this.bytes = bytes;
  }
  static generate(): PrivateKey {
    return new PrivateKey(raw(native('sig.keyPair', {}).priv));
  }
  static deserialize(bytes: Uint8Array): PrivateKey {
    return new PrivateKey(
      raw(sig('PrivateKey.deserialize', () => native('sig.checkPrivate', { priv: b64(bytes) }))),
    );
  }
  serialize(): Bytes {
    return new Uint8Array(this.bytes);
  }
  sign(msg: Uint8Array): Bytes {
    return raw(native('sig.sign', { priv: b64(this.bytes), data: b64(msg) }));
  }
  getPublicKey(): PublicKey {
    return PublicKey.trusted(raw(native('sig.publicOf', { priv: b64(this.bytes) })));
  }
  open(
    ciphertext: Uint8Array,
    info: string | Uint8Array,
    associatedData: Uint8Array = new Uint8Array(),
  ): Bytes {
    const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
    return raw(
      sig('PrivateKey.open', () =>
        native('sig.open', {
          priv: b64(this.bytes),
          data: b64(ciphertext),
          info: b64(infoBytes),
          aad: b64(associatedData),
        }),
      ),
    );
  }
}

export class IdentityKeyPair {
  readonly publicKey: PublicKey;
  readonly privateKey: PrivateKey;
  constructor(publicKey: PublicKey, privateKey: PrivateKey) {
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }
  static generate(): IdentityKeyPair {
    const pair = native('sig.keyPair', {});
    return new IdentityKeyPair(PublicKey.trusted(raw(pair.pub)), PrivateKey.deserialize(raw(pair.priv)));
  }
  serialize(): never {
    throw new Error('IdentityKeyPair.serialize is not used by River');
  }
}

export class KEMPublicKey {
  private readonly bytes: Bytes;
  private constructor(bytes: Bytes) {
    this.bytes = bytes;
  }
  static deserialize(bytes: Uint8Array): KEMPublicKey {
    return new KEMPublicKey(
      raw(sig('KEMPublicKey.deserialize', () => native('sig.checkKemPublic', { pub: b64(bytes) }))),
    );
  }
  /** @internal */
  static trusted(bytes: Bytes): KEMPublicKey {
    return new KEMPublicKey(bytes);
  }
  serialize(): Bytes {
    return new Uint8Array(this.bytes);
  }
}

/** A Kyber-1024 key pair that lives natively until a record is made from it. */
export class KEMKeyPair {
  /** @internal */
  readonly handle: number;
  private readonly pub: Bytes;
  private constructor(handle: number, pub: Bytes) {
    this.handle = handle;
    this.pub = pub;
  }
  static generate(): KEMKeyPair {
    const pair = native('sig.kemKeyPair', {});
    return new KEMKeyPair(pair.handle, raw(pair.pub));
  }
  getPublicKey(): KEMPublicKey {
    return KEMPublicKey.trusted(this.pub);
  }
}

abstract class KeyRecord {
  protected readonly bytes: Bytes;
  private info: { id: number; pub: string; sig: string | null } | null = null;
  protected constructor(bytes: Bytes) {
    this.bytes = bytes;
  }
  protected abstract readonly kind: 'prekey' | 'signed' | 'kyber';
  protected fields(): { id: number; pub: string; sig: string | null } {
    this.info ??= sig('record', () => native('sig.recordInfo', { kind: this.kind, record: b64(this.bytes) }));
    return this.info;
  }
  serialize(): Bytes {
    return new Uint8Array(this.bytes);
  }
  id(): number {
    return this.fields().id;
  }
}

export class PreKeyRecord extends KeyRecord {
  protected readonly kind = 'prekey' as const;
  static new(id: number, pub: PublicKey, priv: PrivateKey): PreKeyRecord {
    return new PreKeyRecord(
      raw(native('sig.preKeyRecord', { id, pub: b64(pub.serialize()), priv: b64(priv.serialize()) })),
    );
  }
  static deserialize(bytes: Uint8Array): PreKeyRecord {
    const r = new PreKeyRecord(new Uint8Array(bytes));
    r.id();
    return r;
  }
  publicKey(): PublicKey {
    return PublicKey.trusted(raw(this.fields().pub));
  }
}

export class SignedPreKeyRecord extends KeyRecord {
  protected readonly kind = 'signed' as const;
  static new(
    id: number,
    timestamp: number,
    pub: PublicKey,
    priv: PrivateKey,
    signature: Uint8Array,
  ): SignedPreKeyRecord {
    return new SignedPreKeyRecord(
      raw(
        native('sig.signedPreKeyRecord', {
          id,
          ts: timestamp,
          pub: b64(pub.serialize()),
          priv: b64(priv.serialize()),
          sig: b64(signature),
        }),
      ),
    );
  }
  static deserialize(bytes: Uint8Array): SignedPreKeyRecord {
    const r = new SignedPreKeyRecord(new Uint8Array(bytes));
    r.id();
    return r;
  }
  publicKey(): PublicKey {
    return PublicKey.trusted(raw(this.fields().pub));
  }
  signature(): Bytes {
    return raw(this.fields().sig ?? '');
  }
}

export class KyberPreKeyRecord extends KeyRecord {
  protected readonly kind = 'kyber' as const;
  static new(id: number, timestamp: number, pair: KEMKeyPair, signature: Uint8Array): KyberPreKeyRecord {
    return new KyberPreKeyRecord(
      raw(native('sig.kyberPreKeyRecord', { id, ts: timestamp, handle: pair.handle, sig: b64(signature) })),
    );
  }
  static deserialize(bytes: Uint8Array): KyberPreKeyRecord {
    const r = new KyberPreKeyRecord(new Uint8Array(bytes));
    r.id();
    return r;
  }
  publicKey(): KEMPublicKey {
    return KEMPublicKey.trusted(raw(this.fields().pub));
  }
  signature(): Bytes {
    return raw(this.fields().sig ?? '');
  }
}

export class SessionRecord {
  private readonly bytes: Bytes;
  private constructor(bytes: Bytes) {
    this.bytes = bytes;
  }
  static deserialize(bytes: Uint8Array): SessionRecord {
    return new SessionRecord(new Uint8Array(bytes));
  }
  serialize(): Bytes {
    return new Uint8Array(this.bytes);
  }
  hasCurrentState(): boolean {
    return sig(
      'SessionRecord.hasCurrentState',
      () => native('sig.sessionInfo', { record: b64(this.bytes) }).current,
    );
  }
}

export class ProtocolAddress {
  private readonly _name: string;
  private readonly _deviceId: number;
  private constructor(name: string, deviceId: number) {
    this._name = name;
    this._deviceId = deviceId;
  }
  static new(name: string, deviceId: number): ProtocolAddress {
    return new ProtocolAddress(name, deviceId);
  }
  name(): string {
    return this._name;
  }
  deviceId(): number {
    return this._deviceId;
  }
  toString(): string {
    return `${this._name}.${this._deviceId}`;
  }
}

export class PreKeyBundle {
  /** @internal */
  readonly wire: {
    registrationId: number;
    deviceId: number;
    preKeyId: number | null;
    preKey: string | null;
    signedPreKeyId: number;
    signedPreKey: string;
    signedPreKeySignature: string;
    identityKey: string;
    kyberPreKeyId: number;
    kyberPreKey: string;
    kyberPreKeySignature: string;
  };
  /** @internal */
  readonly identity: PublicKey;
  private constructor(wire: PreKeyBundle['wire'], identity: PublicKey) {
    this.wire = wire;
    this.identity = identity;
  }
  static new(
    registrationId: number,
    deviceId: number,
    prekeyId: number | null,
    prekey: PublicKey | null,
    signedPrekeyId: number,
    signedPrekey: PublicKey,
    signedPrekeySignature: Uint8Array,
    identityKey: PublicKey,
    kyberPrekeyId: number,
    kyberPrekey: KEMPublicKey,
    kyberPrekeySignature: Uint8Array,
  ): PreKeyBundle {
    return new PreKeyBundle(
      {
        registrationId,
        deviceId,
        preKeyId: prekeyId,
        preKey: prekey ? b64(prekey.serialize()) : null,
        signedPreKeyId: signedPrekeyId,
        signedPreKey: b64(signedPrekey.serialize()),
        signedPreKeySignature: b64(signedPrekeySignature),
        identityKey: b64(identityKey.serialize()),
        kyberPreKeyId: kyberPrekeyId,
        kyberPreKey: b64(kyberPrekey.serialize()),
        kyberPreKeySignature: b64(kyberPrekeySignature),
      },
      identityKey,
    );
  }
  identityKey(): PublicKey {
    return this.identity;
  }
}

export class SignalMessage {
  private readonly bytes: Bytes;
  private constructor(bytes: Bytes) {
    this.bytes = bytes;
  }
  static deserialize(bytes: Uint8Array): SignalMessage {
    return new SignalMessage(new Uint8Array(bytes));
  }
  serialize(): Bytes {
    return new Uint8Array(this.bytes);
  }
}

export class PreKeySignalMessage {
  private readonly bytes: Bytes;
  private constructor(bytes: Bytes) {
    this.bytes = bytes;
  }
  /** libsignal validates the message when it is decrypted. */
  static deserialize(bytes: Uint8Array): PreKeySignalMessage {
    return new PreKeySignalMessage(new Uint8Array(bytes));
  }
  serialize(): Bytes {
    return new Uint8Array(this.bytes);
  }
}

export class CiphertextMessage {
  private readonly _type: CiphertextMessageType;
  private readonly bytes: Bytes;
  constructor(type: CiphertextMessageType, bytes: Bytes) {
    this._type = type;
    this.bytes = bytes;
  }
  type(): CiphertextMessageType {
    return this._type;
  }
  serialize(): Bytes {
    return new Uint8Array(this.bytes);
  }
}

export abstract class SessionStore {
  abstract saveSession(name: ProtocolAddress, record: SessionRecord): Promise<void>;
  abstract getSession(name: ProtocolAddress): Promise<SessionRecord | null>;
  abstract getExistingSessions(addresses: ProtocolAddress[]): Promise<SessionRecord[]>;
}

export abstract class IdentityKeyStore {
  abstract getIdentityKey(): Promise<PrivateKey>;
  async getIdentityKeyPair(): Promise<IdentityKeyPair> {
    const priv = await this.getIdentityKey();
    return new IdentityKeyPair(priv.getPublicKey(), priv);
  }
  abstract getLocalRegistrationId(): Promise<number>;
  abstract saveIdentity(name: ProtocolAddress, key: PublicKey): Promise<IdentityChange>;
  abstract isTrustedIdentity(name: ProtocolAddress, key: PublicKey, direction: Direction): Promise<boolean>;
  abstract getIdentity(name: ProtocolAddress): Promise<PublicKey | null>;
}

export abstract class PreKeyStore {
  abstract savePreKey(id: number, record: PreKeyRecord): Promise<void>;
  abstract getPreKey(id: number): Promise<PreKeyRecord>;
  abstract removePreKey(id: number): Promise<void>;
}

export abstract class SignedPreKeyStore {
  abstract saveSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void>;
  abstract getSignedPreKey(id: number): Promise<SignedPreKeyRecord>;
}

export abstract class KyberPreKeyStore {
  abstract saveKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void>;
  abstract getKyberPreKey(id: number): Promise<KyberPreKeyRecord>;
  abstract markKyberPreKeyUsed(
    kyberPreKeyId: number,
    signedPreKeyId: number,
    baseKey: PublicKey,
  ): Promise<void>;
}

async function localOf(local: ProtocolAddress, identities: IdentityKeyStore): Promise<LocalAddress> {
  const pair = await identities.getIdentityKeyPair();
  return {
    priv: b64(pair.privateKey.serialize()),
    pub: b64(pair.publicKey.serialize()),
    regId: await identities.getLocalRegistrationId(),
    name: local.name(),
    deviceId: local.deviceId(),
  };
}

function untrusted(address: ProtocolAddress, operation: string): LibSignalErrorBase {
  return new LibSignalErrorBase(
    `untrusted identity for address ${address.toString()}`,
    ErrorCode.UntrustedIdentity,
    operation,
    address.toString(),
  );
}

const remoteOf = (a: ProtocolAddress): { name: string; deviceId: number } => ({
  name: a.name(),
  deviceId: a.deviceId(),
});

export async function processPreKeyBundle(
  bundle: PreKeyBundle,
  address: ProtocolAddress,
  localAddress: ProtocolAddress,
  sessionStore: SessionStore,
  identityStore: IdentityKeyStore,
): Promise<void> {
  if (!(await identityStore.isTrustedIdentity(address, bundle.identityKey(), Direction.Sending))) {
    throw untrusted(address, 'processPreKeyBundle');
  }
  const existing = await sessionStore.getSession(address);
  const local = await localOf(localAddress, identityStore);
  const out = sig(
    'processPreKeyBundle',
    () =>
      native('sig.processBundle', {
        local,
        remote: remoteOf(address),
        session: existing ? b64(existing.serialize()) : null,
        bundle: bundle.wire,
      }),
    address.toString(),
  );
  await identityStore.saveIdentity(address, bundle.identityKey());
  await sessionStore.saveSession(address, SessionRecord.deserialize(raw(out.session)));
}

function noSession(address: ProtocolAddress, operation: string): LibSignalErrorBase {
  return new LibSignalErrorBase(
    `session with ${address.toString()} not found`,
    ErrorCode.InvalidSession,
    operation,
    address.toString(),
  );
}

export async function signalEncrypt(
  message: Uint8Array,
  address: ProtocolAddress,
  localAddress: ProtocolAddress,
  sessionStore: SessionStore,
  identityStore: IdentityKeyStore,
): Promise<CiphertextMessage> {
  const session = await sessionStore.getSession(address);
  if (!session) throw noSession(address, 'signalEncrypt');
  const local = await localOf(localAddress, identityStore);
  const out = sig(
    'signalEncrypt',
    () =>
      native('sig.encrypt', {
        local,
        remote: remoteOf(address),
        session: b64(session.serialize()),
        data: b64(message),
      }),
    address.toString(),
  );
  const theirs = PublicKey.trusted(raw(out.remoteIdentity));
  if (!(await identityStore.isTrustedIdentity(address, theirs, Direction.Sending))) {
    throw untrusted(address, 'signalEncrypt');
  }
  await identityStore.saveIdentity(address, theirs);
  await sessionStore.saveSession(address, SessionRecord.deserialize(raw(out.session)));
  return new CiphertextMessage(out.type as CiphertextMessageType, raw(out.body));
}

export async function signalDecrypt(
  message: SignalMessage,
  address: ProtocolAddress,
  localAddress: ProtocolAddress,
  sessionStore: SessionStore,
  identityStore: IdentityKeyStore,
): Promise<Bytes> {
  const session = await sessionStore.getSession(address);
  if (!session) throw noSession(address, 'signalDecrypt');
  const local = await localOf(localAddress, identityStore);
  const out = sig(
    'signalDecrypt',
    () =>
      native('sig.decrypt', {
        local,
        remote: remoteOf(address),
        session: b64(session.serialize()),
        data: b64(message.serialize()),
      }),
    address.toString(),
  );
  const theirs = PublicKey.trusted(raw(out.remoteIdentity));
  if (!(await identityStore.isTrustedIdentity(address, theirs, Direction.Receiving))) {
    throw untrusted(address, 'signalDecrypt');
  }
  await identityStore.saveIdentity(address, theirs);
  await sessionStore.saveSession(address, SessionRecord.deserialize(raw(out.session)));
  return raw(out.data);
}

export async function signalDecryptPreKey(
  message: PreKeySignalMessage,
  address: ProtocolAddress,
  localAddress: ProtocolAddress,
  sessionStore: SessionStore,
  identityStore: IdentityKeyStore,
  prekeyStore: PreKeyStore,
  signedPrekeyStore: SignedPreKeyStore,
  kyberPrekeyStore: KyberPreKeyStore,
): Promise<Bytes> {
  const data = b64(message.serialize());
  const session = await sessionStore.getSession(address);
  const local = await localOf(localAddress, identityStore);
  const records: Array<{ kind: PreKeyKind; id: number; record: string }> = [];
  const missing: Array<{ kind: PreKeyKind; id: number }> = [];
  const load = async (kind: PreKeyKind, id: number): Promise<Uint8Array> => {
    if (kind === 'prekey') return (await prekeyStore.getPreKey(id)).serialize();
    if (kind === 'signed') return (await signedPrekeyStore.getSignedPreKey(id)).serialize();
    return (await kyberPrekeyStore.getKyberPreKey(id)).serialize();
  };
  // libsignal needs at most a signed prekey, a Kyber prekey and a one-time prekey.
  for (let round = 0; round < 6; round++) {
    const out = sig(
      'signalDecryptPreKey',
      () =>
        native('sig.decryptPreKey', {
          local,
          remote: remoteOf(address),
          session: session ? b64(session.serialize()) : null,
          data,
          records,
          missing,
        }),
      address.toString(),
    );
    if ('need' in out) {
      const { kind, id } = out.need;
      try {
        records.push({ kind, id, record: b64(await load(kind, id)) });
      } catch {
        missing.push({ kind, id });
      }
      continue;
    }
    const theirs = PublicKey.trusted(raw(out.remoteIdentity));
    if (!(await identityStore.isTrustedIdentity(address, theirs, Direction.Receiving))) {
      throw untrusted(address, 'signalDecryptPreKey');
    }
    await identityStore.saveIdentity(address, theirs);
    await sessionStore.saveSession(address, SessionRecord.deserialize(raw(out.session)));
    if (out.usedPreKey !== null) await prekeyStore.removePreKey(out.usedPreKey);
    const kyber = out.usedKyberPreKey;
    if (kyber) {
      await kyberPrekeyStore.markKyberPreKeyUsed(
        kyber.id,
        kyber.signedPreKeyId,
        PublicKey.trusted(raw(kyber.baseKey)),
      );
    }
    return raw(out.data);
  }
  throw new LibSignalErrorBase(
    'prekey message needs too many keys',
    ErrorCode.Generic,
    'signalDecryptPreKey',
  );
}

class DisplayableFingerprint {
  private readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
  toString(): string {
    return this.text;
  }
}

class ScannableFingerprint {
  private readonly bytes: Bytes;
  constructor(bytes: Bytes) {
    this.bytes = bytes;
  }
  toBuffer(): Bytes {
    return new Uint8Array(this.bytes);
  }
}

export class Fingerprint {
  private readonly display: string;
  private readonly scannable: Bytes;
  private constructor(display: string, scannable: Bytes) {
    this.display = display;
    this.scannable = scannable;
  }
  static new(
    iterations: number,
    version: number,
    localIdentifier: Uint8Array,
    localKey: PublicKey,
    remoteIdentifier: Uint8Array,
    remoteKey: PublicKey,
  ): Fingerprint {
    const out = native('sig.fingerprint', {
      iterations,
      version,
      localId: b64(localIdentifier),
      localKey: b64(localKey.serialize()),
      remoteId: b64(remoteIdentifier),
      remoteKey: b64(remoteKey.serialize()),
    });
    return new Fingerprint(out.display, raw(out.scannable));
  }
  displayableFingerprint(): DisplayableFingerprint {
    return new DisplayableFingerprint(this.display);
  }
  scannableFingerprint(): ScannableFingerprint {
    return new ScannableFingerprint(this.scannable);
  }
}
