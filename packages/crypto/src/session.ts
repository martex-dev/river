import { randomInt } from 'node:crypto';
import {
  CiphertextMessageType,
  Direction,
  ErrorCode,
  IdentityChange,
  IdentityKeyPair,
  IdentityKeyStore,
  KEMKeyPair,
  KEMPublicKey,
  KyberPreKeyRecord,
  KyberPreKeyStore,
  LibSignalErrorBase,
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
import { paddedLengthCapped } from './padding.ts';

/**
 * End-to-end encrypted 1:1 messaging with libsignal: X3DH + ML-KEM (PQXDH)
 * session setup and the Double Ratchet, exactly as Signal uses them. River
 * only supplies storage and the wire encoding (base64 JSON).
 */

export type StoreKind = 'session' | 'identity' | 'verified' | 'prekey' | 'signed' | 'kyber' | 'meta';

/** Persistent key–value storage for protocol state (the desktop keeps it in SQLCipher). */
export interface ProtocolStorage {
  get(kind: StoreKind, id: string): Uint8Array | null;
  put(kind: StoreKind, id: string, value: Uint8Array): void;
  delete(kind: StoreKind, id: string): void;
  count(kind: StoreKind): number;
}

export interface LocalIdentity {
  riverId: string;
  deviceId: number;
  registrationId: number;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
const unb64 = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(s, 'base64'));
const bytes = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u);
const addr = (riverId: string, deviceId: number): string => `${riverId}.${deviceId}`;

/** Public prekeys uploaded to the server (base64 fields). */
export interface PreKeyUpload {
  signedPreKey: { id: number; publicKey: string; signature: string };
  kyberLastResort: { id: number; publicKey: string; signature: string };
  preKeys: Array<{ id: number; publicKey: string }>;
  kyberPreKeys: Array<{ id: number; publicKey: string; signature: string }>;
}

/** One device's prekey bundle as served by the server. */
export interface DeviceBundle {
  deviceId: number;
  registrationId: number;
  signedPreKey: { id: number; publicKey: string; signature: string };
  preKey?: { id: number; publicKey: string } | null;
  kyberPreKey: { id: number; publicKey: string; signature: string };
}

export interface Envelope {
  /** 3 = prekey message (first message of a session), 2 = normal ratchet message. */
  type: number;
  body: string;
}

/**
 * The largest padded content River produces (bytes): what is left of a 96 KB envelope
 * (MAX_ENVELOPE_BYTES) after libsignal's framing, Kyber ciphertext and MAC. Padding never makes
 * a message too large to send.
 */
export const MAX_PADDED_CONTENT = 92 * 1024;

/**
 * Signal-style padding: 0x80 then zeros, hiding message length. Up to 2560 bytes the result is a
 * multiple of 160 bytes (as in Signal); since 2.13 longer content is padded to a Padmé bucket
 * (padding.ts), at most `max` bytes. Every River's `unpad` — which only looks for the last 0x80
 * after the zeros — reads any amount of padding, so 2.11 and 2.12 read the longer padding too.
 */
export function pad(plaintext: Uint8Array, max = MAX_PADDED_CONTENT): Uint8Array<ArrayBuffer> {
  const size = paddedLengthCapped(plaintext.length + 1, max);
  const out = new Uint8Array(size);
  out.set(plaintext);
  out[plaintext.length] = 0x80;
  return out;
}

export function unpad(padded: Uint8Array): Uint8Array {
  for (let i = padded.length - 1; i >= 0; i--) {
    if (padded[i] === 0x80) return padded.subarray(0, i);
    if (padded[i] !== 0) break;
  }
  throw new Error('invalid padding');
}

export class SafetyNumberChangedError extends Error {
  readonly riverId: string;
  constructor(riverId: string) {
    super(
      'The safety number with this contact changed and they were verified. Verify them again to keep messaging.',
    );
    this.name = 'SafetyNumberChangedError';
    this.riverId = riverId;
  }
}

/** A changed identity key that River refused to accept from a contact (see `approveIdentityChange`). */
export class IdentityChangeRefusedError extends Error {
  readonly riverId: string;
  constructor(riverId: string) {
    super('A message claimed a new identity key for this contact that River could not confirm.');
    this.name = 'IdentityChangeRefusedError';
    this.riverId = riverId;
  }
}

/**
 * What River knows about a contact's identity key: 'verified' — the user verified the key held
 * now; 'changed' — they verified an earlier key and it changed since (sending stops until they
 * verify again); 'unverified' — trust on first use.
 */
export type VerificationState = 'unverified' | 'verified' | 'changed';

/** A contact's identity key changing on an incoming message (the first message of a new session). */
export interface IncomingIdentityChange {
  riverId: string;
  deviceId: number;
  /** The libsignal registration ID claimed by the sending device (from the PreKey message). */
  registrationId: number | null;
  /** The new identity public key (33 bytes). */
  identityKey: Uint8Array;
  /** The identity key River had stored before (33 bytes). */
  previousKey: Uint8Array;
}

/** The verification mark before 2.11: one byte, meaning "the stored key was verified". */
const LEGACY_VERIFIED = 1;
const isLegacyMark = (mark: Uint8Array): boolean => mark.length === 1 && mark[0] === LEGACY_VERIFIED;

/**
 * The libsignal protocol stores over a ProtocolStorage, plus helpers to
 * create and upload prekeys and to encrypt/decrypt messages.
 */
export class RiverProtocol {
  readonly local: LocalIdentity;
  private readonly storage: ProtocolStorage;
  private readonly identityPair: IdentityKeyPair;
  /** Called when a contact's identity key changes (show a safety-number warning). */
  onIdentityChanged: (riverId: string) => void = () => undefined;
  /**
   * Decides whether an incoming message may replace a contact's stored identity key (a new
   * session after they reinstalled — or a server substituting a key). The caller checks the
   * change against what the server cannot forge on its own (the device list signed by the new
   * key, the key sealed in a shared community). Without a decision the change is refused.
   */
  approveIdentityChange: (change: IncomingIdentityChange) => Promise<boolean> = async () => false;
  /**
   * Decides whether an incoming message may set up the first identity key River stores for a
   * contact (trust on first use). The caller refuses a key that contradicts what the server cannot
   * forge on its own (the key sealed in a shared community profile). Default: accepted.
   */
  acceptNewIdentity: (riverId: string, identityKey: Uint8Array) => boolean = () => true;
  /** Registration IDs claimed by PreKey messages being decrypted right now, by address. */
  private readonly incomingRegistration = new Map<string, number>();

  readonly sessions: SessionStore;
  readonly identities: IdentityKeyStore;
  readonly preKeys: PreKeyStore;
  readonly signedPreKeys: SignedPreKeyStore;
  readonly kyberPreKeys: KyberPreKeyStore;

  constructor(local: LocalIdentity, storage: ProtocolStorage) {
    this.local = local;
    this.storage = storage;
    this.identityPair = new IdentityKeyPair(
      PublicKey.deserialize(bytes(local.publicKey)),
      PrivateKey.deserialize(bytes(local.privateKey)),
    );
    const st = storage;
    const pair = this.identityPair;
    const notifyChange = (riverId: string): void => this.onIdentityChanged(riverId);

    this.sessions = new (class extends SessionStore {
      async saveSession(name: ProtocolAddress, record: SessionRecord): Promise<void> {
        st.put('session', addr(name.name(), name.deviceId()), record.serialize());
      }
      async getSession(name: ProtocolAddress): Promise<SessionRecord | null> {
        const raw = st.get('session', addr(name.name(), name.deviceId()));
        return raw ? SessionRecord.deserialize(bytes(raw)) : null;
      }
      async getExistingSessions(addresses: ProtocolAddress[]): Promise<SessionRecord[]> {
        return Promise.all(
          addresses.map(async (a) => {
            const s = await this.getSession(a);
            if (!s) throw new Error(`no session for ${a.toString()}`);
            return s;
          }),
        );
      }
    })();

    const approve = (change: IncomingIdentityChange): Promise<boolean> => this.approveIdentityChange(change);
    const acceptNew = (riverId: string, key: Uint8Array): boolean => this.acceptNewIdentity(riverId, key);
    const claimedRegistration = (address: string): number | null =>
      this.incomingRegistration.get(address) ?? null;
    const ownKey = Buffer.from(local.publicKey);
    this.identities = new (class extends IdentityKeyStore {
      async getIdentityKey(): Promise<PrivateKey> {
        return pair.privateKey;
      }
      async getLocalRegistrationId(): Promise<number> {
        return local.registrationId;
      }
      async saveIdentity(name: ProtocolAddress, key: PublicKey): Promise<IdentityChange> {
        const serialized = key.serialize();
        // This account's other devices share its identity key: never store another key for us.
        if (name.name() === local.riverId) {
          if (!ownKey.equals(Buffer.from(serialized))) throw new IdentityChangeRefusedError(name.name());
          return IdentityChange.NewOrUnchanged;
        }
        const existing = st.get('identity', name.name());
        if (existing && !Buffer.from(existing).equals(Buffer.from(serialized))) {
          // Verification is never cleared silently: a legacy mark ("the stored key was verified")
          // becomes the key that was verified, so the contact shows as changed since verification.
          const mark = st.get('verified', name.name());
          if (mark && isLegacyMark(mark)) st.put('verified', name.name(), existing);
          st.put('identity', name.name(), serialized);
          notifyChange(name.name());
          return IdentityChange.ReplacedExisting;
        }
        st.put('identity', name.name(), serialized);
        return IdentityChange.NewOrUnchanged;
      }
      async isTrustedIdentity(name: ProtocolAddress, key: PublicKey, direction: Direction): Promise<boolean> {
        const serialized = Buffer.from(key.serialize());
        if (name.name() === local.riverId) return ownKey.equals(serialized);
        const existing = st.get('identity', name.name());
        if (direction === Direction.Sending) {
          // Trust on first use, but a contact the user verified gets nothing under any other key
          // until they verify again (also after an incoming message changed the stored key).
          const mark = st.get('verified', name.name());
          if (mark && !isLegacyMark(mark)) return serialized.equals(Buffer.from(mark));
          if (mark && existing) return serialized.equals(Buffer.from(existing));
          return true;
        }
        // A first message from someone River holds no key for yet: trust on first use, unless the
        // key contradicts one the caller knows from elsewhere.
        if (!existing) return acceptNew(name.name(), new Uint8Array(serialized));
        if (Buffer.from(existing).equals(serialized)) return true;
        // An incoming message under a new identity key: accepted only when the caller confirmed it.
        return approve({
          riverId: name.name(),
          deviceId: name.deviceId(),
          registrationId: claimedRegistration(addr(name.name(), name.deviceId())),
          identityKey: new Uint8Array(serialized),
          previousKey: new Uint8Array(existing),
        });
      }
      async getIdentity(name: ProtocolAddress): Promise<PublicKey | null> {
        if (name.name() === local.riverId) return PublicKey.deserialize(bytes(ownKey));
        const raw = st.get('identity', name.name());
        return raw ? PublicKey.deserialize(bytes(raw)) : null;
      }
    })();

    this.preKeys = new (class extends PreKeyStore {
      async savePreKey(id: number, record: PreKeyRecord): Promise<void> {
        st.put('prekey', String(id), record.serialize());
      }
      async getPreKey(id: number): Promise<PreKeyRecord> {
        const raw = st.get('prekey', String(id));
        if (!raw) throw new Error('unknown prekey');
        return PreKeyRecord.deserialize(bytes(raw));
      }
      async removePreKey(id: number): Promise<void> {
        st.delete('prekey', String(id));
      }
    })();

    this.signedPreKeys = new (class extends SignedPreKeyStore {
      async saveSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> {
        st.put('signed', String(id), record.serialize());
      }
      async getSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
        const raw = st.get('signed', String(id));
        if (!raw) throw new Error('unknown signed prekey');
        return SignedPreKeyRecord.deserialize(bytes(raw));
      }
    })();

    this.kyberPreKeys = new (class extends KyberPreKeyStore {
      async saveKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void> {
        st.put('kyber', String(id), record.serialize());
      }
      async getKyberPreKey(id: number): Promise<KyberPreKeyRecord> {
        const raw = st.get('kyber', String(id));
        if (!raw) throw new Error('unknown kyber prekey');
        return KyberPreKeyRecord.deserialize(bytes(raw));
      }
      async markKyberPreKeyUsed(id: number): Promise<void> {
        // One-time Kyber keys are deleted; the last-resort key stays.
        if (readId(st.get('meta', 'kyberLastResort')) === id) return;
        st.delete('kyber', String(id));
      }
    })();
  }

  private address(riverId: string, deviceId: number): ProtocolAddress {
    return ProtocolAddress.new(riverId, deviceId);
  }

  private get localAddress(): ProtocolAddress {
    return this.address(this.local.riverId, this.local.deviceId);
  }

  private nextId(counter: string): number {
    const current = readId(this.storage.get('meta', counter)) || randomInt(1, 0xffffff);
    const next = current >= 0xfffffe ? 1 : current + 1;
    this.storage.put('meta', counter, writeId(next));
    return current;
  }

  private sign(data: Uint8Array): Uint8Array<ArrayBuffer> {
    return this.identityPair.privateKey.sign(bytes(data));
  }

  /**
   * Makes keys to upload. With `rotate`, also a new signed prekey and Kyber
   * last-resort key (do this on registration and periodically).
   */
  generatePreKeys(options: { oneTime: number; rotate: boolean }): PreKeyUpload {
    const now = Date.now();
    let signed: SignedPreKeyRecord;
    let lastResort: KyberPreKeyRecord;
    if (options.rotate || !this.storage.get('meta', 'signedPreKey')) {
      const id = this.nextId('nextSignedId');
      const priv = PrivateKey.generate();
      signed = SignedPreKeyRecord.new(
        id,
        now,
        priv.getPublicKey(),
        priv,
        this.sign(priv.getPublicKey().serialize()),
      );
      this.storage.put('signed', String(id), signed.serialize());
      this.storage.put('meta', 'signedPreKey', writeId(id));
      const kid = this.nextId('nextKyberId');
      const pair = KEMKeyPair.generate();
      lastResort = KyberPreKeyRecord.new(kid, now, pair, this.sign(pair.getPublicKey().serialize()));
      this.storage.put('kyber', String(kid), lastResort.serialize());
      this.storage.put('meta', 'kyberLastResort', writeId(kid));
    } else {
      signed = SignedPreKeyRecord.deserialize(
        bytes(this.storage.get('signed', String(readId(this.storage.get('meta', 'signedPreKey'))))!),
      );
      lastResort = KyberPreKeyRecord.deserialize(
        bytes(this.storage.get('kyber', String(readId(this.storage.get('meta', 'kyberLastResort'))))!),
      );
    }
    const preKeys: PreKeyUpload['preKeys'] = [];
    const kyberPreKeys: PreKeyUpload['kyberPreKeys'] = [];
    for (let i = 0; i < options.oneTime; i++) {
      const id = this.nextId('nextPreKeyId');
      const priv = PrivateKey.generate();
      this.storage.put('prekey', String(id), PreKeyRecord.new(id, priv.getPublicKey(), priv).serialize());
      preKeys.push({ id, publicKey: b64(priv.getPublicKey().serialize()) });
      const kid = this.nextId('nextKyberId');
      const pair = KEMKeyPair.generate();
      const rec = KyberPreKeyRecord.new(kid, now, pair, this.sign(pair.getPublicKey().serialize()));
      this.storage.put('kyber', String(kid), rec.serialize());
      kyberPreKeys.push({
        id: kid,
        publicKey: b64(pair.getPublicKey().serialize()),
        signature: b64(rec.signature()),
      });
    }
    return {
      signedPreKey: {
        id: signed.id(),
        publicKey: b64(signed.publicKey().serialize()),
        signature: b64(signed.signature()),
      },
      kyberLastResort: {
        id: lastResort.id(),
        publicKey: b64(lastResort.publicKey().serialize()),
        signature: b64(lastResort.signature()),
      },
      preKeys,
      kyberPreKeys,
    };
  }

  hasSession(riverId: string, deviceId: number): boolean {
    const raw = this.storage.get('session', addr(riverId, deviceId));
    return !!raw && SessionRecord.deserialize(bytes(raw)).hasCurrentState();
  }

  /** Starts a session from a server-provided bundle (libsignal verifies the prekey signatures). */
  async startSession(riverId: string, identityKey: Uint8Array, device: DeviceBundle): Promise<void> {
    const bundle = PreKeyBundle.new(
      device.registrationId,
      device.deviceId,
      device.preKey ? device.preKey.id : null,
      device.preKey ? PublicKey.deserialize(unb64(device.preKey.publicKey)) : null,
      device.signedPreKey.id,
      PublicKey.deserialize(unb64(device.signedPreKey.publicKey)),
      unb64(device.signedPreKey.signature),
      PublicKey.deserialize(bytes(identityKey)),
      device.kyberPreKey.id,
      KEMPublicKey.deserialize(unb64(device.kyberPreKey.publicKey)),
      unb64(device.kyberPreKey.signature),
    );
    try {
      await processPreKeyBundle(
        bundle,
        this.address(riverId, device.deviceId),
        this.localAddress,
        this.sessions,
        this.identities,
      );
    } catch (err) {
      if (LibSignalErrorBase.is(err, ErrorCode.UntrustedIdentity))
        throw new SafetyNumberChangedError(riverId);
      throw err;
    }
  }

  async encrypt(riverId: string, deviceId: number, plaintext: Uint8Array): Promise<Envelope> {
    try {
      const msg = await signalEncrypt(
        pad(plaintext),
        this.address(riverId, deviceId),
        this.localAddress,
        this.sessions,
        this.identities,
      );
      return { type: msg.type(), body: b64(msg.serialize()) };
    } catch (err) {
      if (LibSignalErrorBase.is(err, ErrorCode.UntrustedIdentity))
        throw new SafetyNumberChangedError(riverId);
      throw err;
    }
  }

  async decrypt(riverId: string, deviceId: number, envelope: Envelope): Promise<Uint8Array> {
    const from = this.address(riverId, deviceId);
    const raw = unb64(envelope.body);
    let padded: Uint8Array;
    if (envelope.type === CiphertextMessageType.PreKey) {
      const message = PreKeySignalMessage.deserialize(raw);
      const address = addr(riverId, deviceId);
      this.incomingRegistration.set(address, message.registrationId());
      try {
        padded = await signalDecryptPreKey(
          message,
          from,
          this.localAddress,
          this.sessions,
          this.identities,
          this.preKeys,
          this.signedPreKeys,
          this.kyberPreKeys,
        );
      } catch (err) {
        if (LibSignalErrorBase.is(err, ErrorCode.UntrustedIdentity))
          throw new IdentityChangeRefusedError(riverId);
        throw err;
      } finally {
        this.incomingRegistration.delete(address);
      }
    } else if (envelope.type === CiphertextMessageType.Whisper) {
      padded = await signalDecrypt(
        SignalMessage.deserialize(raw),
        from,
        this.localAddress,
        this.sessions,
        this.identities,
      );
    } else {
      throw new Error('unsupported message type');
    }
    return unpad(padded);
  }

  /** The stored identity key of a contact (TOFU), or null. */
  identityOf(riverId: string): Uint8Array | null {
    return this.storage.get('identity', riverId);
  }

  /**
   * Marks the contact's current identity key as verified (the key itself is recorded), or clears
   * the mark. With `expected`, only while that is still the stored key — the one whose safety
   * number the user compared. Returns whether the mark was set.
   */
  setVerified(riverId: string, verified: boolean, expected?: Uint8Array): boolean {
    if (!verified) {
      this.storage.delete('verified', riverId);
      return true;
    }
    const current = this.storage.get('identity', riverId);
    if (!current) return false;
    if (expected && !Buffer.from(expected).equals(Buffer.from(current))) return false;
    this.storage.put('verified', riverId, current);
    return true;
  }

  verificationState(riverId: string): VerificationState {
    const mark = this.storage.get('verified', riverId);
    if (!mark) return 'unverified';
    if (isLegacyMark(mark)) return 'verified';
    const current = this.storage.get('identity', riverId);
    return current && Buffer.from(current).equals(Buffer.from(mark)) ? 'verified' : 'changed';
  }

  /** True only while the key the user verified is still the contact's key. */
  isVerified(riverId: string): boolean {
    return this.verificationState(riverId) === 'verified';
  }

  /** Remaining one-time prekeys stored locally (the server count is authoritative for uploads). */
  localPreKeyCount(): number {
    return this.storage.count('prekey');
  }
}

function readId(raw: Uint8Array | null): number {
  if (!raw || raw.length !== 4) return 0;
  return Buffer.from(raw).readUInt32BE(0);
}

function writeId(id: number): Uint8Array {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(id);
  return b;
}
