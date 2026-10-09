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

/** Signal-style padding: 0x80 then zeros up to a multiple of 160 bytes, hiding message length. */
export function pad(plaintext: Uint8Array): Uint8Array<ArrayBuffer> {
  const size = Math.ceil((plaintext.length + 1) / 160) * 160;
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

    this.identities = new (class extends IdentityKeyStore {
      async getIdentityKey(): Promise<PrivateKey> {
        return pair.privateKey;
      }
      async getLocalRegistrationId(): Promise<number> {
        return local.registrationId;
      }
      async saveIdentity(name: ProtocolAddress, key: PublicKey): Promise<IdentityChange> {
        const existing = st.get('identity', name.name());
        const serialized = key.serialize();
        st.put('identity', name.name(), serialized);
        if (existing && !Buffer.from(existing).equals(Buffer.from(serialized))) {
          st.delete('verified', name.name());
          notifyChange(name.name());
          return IdentityChange.ReplacedExisting;
        }
        return IdentityChange.NewOrUnchanged;
      }
      async isTrustedIdentity(name: ProtocolAddress, key: PublicKey, direction: Direction): Promise<boolean> {
        const existing = st.get('identity', name.name());
        if (!existing || Buffer.from(existing).equals(Buffer.from(key.serialize()))) return true;
        // Trust on first use. A changed key is accepted (with a warning) unless the
        // user had verified this contact, in which case sending stops until they re-verify.
        if (direction === Direction.Sending && st.get('verified', name.name())) return false;
        return true;
      }
      async getIdentity(name: ProtocolAddress): Promise<PublicKey | null> {
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
      padded = await signalDecryptPreKey(
        PreKeySignalMessage.deserialize(raw),
        from,
        this.localAddress,
        this.sessions,
        this.identities,
        this.preKeys,
        this.signedPreKeys,
        this.kyberPreKeys,
      );
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

  setVerified(riverId: string, verified: boolean): void {
    if (verified) this.storage.put('verified', riverId, new Uint8Array([1]));
    else this.storage.delete('verified', riverId);
  }

  isVerified(riverId: string): boolean {
    return this.storage.get('verified', riverId) !== null;
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
