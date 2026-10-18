import { describe, expect, it } from 'vitest';
import { createIdentity } from '../src/identity.ts';
import {
  IdentityChangeRefusedError,
  MAX_PADDED_CONTENT,
  RiverProtocol,
  SafetyNumberChangedError,
  pad,
  unpad,
  type DeviceBundle,
  type PreKeyUpload,
  type ProtocolStorage,
  type StoreKind,
} from '../src/session.ts';

function memoryStorage(): ProtocolStorage & { dump(): string } {
  const map = new Map<string, Uint8Array>();
  const k = (kind: StoreKind, id: string): string => `${kind}:${id}`;
  return {
    get: (kind, id) => map.get(k(kind, id)) ?? null,
    put: (kind, id, value) => void map.set(k(kind, id), new Uint8Array(value)),
    delete: (kind, id) => void map.delete(k(kind, id)),
    count: (kind) => [...map.keys()].filter((x) => x.startsWith(`${kind}:`)).length,
    dump: () => JSON.stringify([...map.keys()]),
  };
}

function party(): {
  protocol: RiverProtocol;
  identity: ReturnType<typeof createIdentity>;
  storage: ReturnType<typeof memoryStorage>;
} {
  const identity = createIdentity();
  const storage = memoryStorage();
  const protocol = new RiverProtocol({ ...identity, deviceId: 1 }, storage);
  return { protocol, identity, storage };
}

/** What a server would hand out: one one-time prekey and one Kyber key per request. */
function serve(upload: PreKeyUpload, registrationId: number, useOneTime = true): DeviceBundle {
  return {
    deviceId: 1,
    registrationId,
    signedPreKey: upload.signedPreKey,
    preKey: useOneTime ? (upload.preKeys.shift() ?? null) : null,
    kyberPreKey: (useOneTime ? upload.kyberPreKeys.shift() : undefined) ?? upload.kyberLastResort,
  };
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const str = (u: Uint8Array): string => new TextDecoder().decode(u);

describe('libsignal sessions', () => {
  it('pads to 160-byte blocks and unpads exactly', () => {
    for (const n of [0, 1, 158, 159, 160, 1000]) {
      const data = new Uint8Array(n).fill(7);
      const p = pad(data);
      expect(p.length % 160).toBe(0);
      expect(Buffer.from(unpad(p))).toEqual(Buffer.from(data));
    }
    expect(() => unpad(new Uint8Array(160))).toThrow();
  });

  it('pads long content to Padmé buckets (2.13), never past MAX_PADDED_CONTENT', () => {
    const sizes = new Set<number>();
    for (let n = 3000; n < 60_000; n += 13) sizes.add(pad(new Uint8Array(n)).length);
    // Signal's 160-byte blocks would leave ~360 different sizes here.
    expect(sizes.size).toBeLessThan(120);
    for (const n of [2559, 2560, 2561, 10_000, 50_000]) {
      const p = pad(new Uint8Array(n).fill(1));
      expect(p.length).toBeGreaterThan(n);
      expect(p.length).toBeLessThanOrEqual(Math.ceil((n + 1) * 1.12));
    }
    expect(pad(new Uint8Array(MAX_PADDED_CONTENT - 100)).length).toBe(MAX_PADDED_CONTENT);
    expect(pad(new Uint8Array(MAX_PADDED_CONTENT + 5)).length).toBe(MAX_PADDED_CONTENT + 6);
  });

  it('2.11 and 2.12 read the new padding: their unpad (copied as released) finds the same content', () => {
    // apps 2.11.0 – 2.12.1, packages/crypto/src/session.ts, unchanged:
    const unpad212 = (padded: Uint8Array): Uint8Array => {
      for (let i = padded.length - 1; i >= 0; i--) {
        if (padded[i] === 0x80) return padded.subarray(0, i);
        if (padded[i] !== 0) break;
      }
      throw new Error('invalid padding');
    };
    for (const n of [0, 1, 159, 2600, 9000, 70_000, MAX_PADDED_CONTENT]) {
      const data = new Uint8Array(n).map((_, i) => (i * 7) & 0xff);
      expect(Buffer.from(unpad212(pad(data)))).toEqual(Buffer.from(data));
      expect(Buffer.from(unpad(pad(data)))).toEqual(Buffer.from(data));
    }
  });

  it('a message of the largest padded size still fits an envelope (PreKey message included)', async () => {
    const alice = party();
    const bob = party();
    const keys = bob.protocol.generatePreKeys({ oneTime: 1, rotate: true });
    await alice.protocol.startSession(
      bob.identity.riverId,
      bob.identity.publicKey,
      serve(keys, bob.identity.registrationId),
    );
    const big = new Uint8Array(MAX_PADDED_CONTENT - 200).fill(0x61);
    const env = await alice.protocol.encrypt(bob.identity.riverId, 1, big);
    expect(env.type).toBe(3);
    // MAX_ENVELOPE_BYTES (packages/protocol/src/messaging.ts) is 96 KiB.
    expect(Buffer.from(env.body, 'base64').length).toBeLessThanOrEqual(96 * 1024);
    expect(Buffer.from(await bob.protocol.decrypt(alice.identity.riverId, 1, env))).toEqual(Buffer.from(big));
  });

  it('establishes a PQXDH session and ratchets in both directions', async () => {
    const alice = party();
    const bob = party();
    const bobKeys = bob.protocol.generatePreKeys({ oneTime: 5, rotate: true });
    expect(bobKeys.preKeys).toHaveLength(5);
    expect(bobKeys.kyberPreKeys).toHaveLength(5);

    await alice.protocol.startSession(
      bob.identity.riverId,
      bob.identity.publicKey,
      serve(bobKeys, bob.identity.registrationId),
    );
    const first = await alice.protocol.encrypt(bob.identity.riverId, 1, text('hi bob'));
    expect(first.type).toBe(3); // prekey message
    expect(str(await bob.protocol.decrypt(alice.identity.riverId, 1, first))).toBe('hi bob');

    const reply = await bob.protocol.encrypt(alice.identity.riverId, 1, text('hi alice'));
    expect(reply.type).toBe(2);
    expect(str(await alice.protocol.decrypt(bob.identity.riverId, 1, reply))).toBe('hi alice');

    // Out-of-order delivery works; replays are rejected.
    const m1 = await alice.protocol.encrypt(bob.identity.riverId, 1, text('one'));
    const m2 = await alice.protocol.encrypt(bob.identity.riverId, 1, text('two'));
    expect(str(await bob.protocol.decrypt(alice.identity.riverId, 1, m2))).toBe('two');
    expect(str(await bob.protocol.decrypt(alice.identity.riverId, 1, m1))).toBe('one');
    await expect(bob.protocol.decrypt(alice.identity.riverId, 1, m1)).rejects.toThrow();

    // The one-time prekey was consumed.
    expect(bob.protocol.localPreKeyCount()).toBe(4);
    expect(alice.protocol.identityOf(bob.identity.riverId)).toEqual(bob.identity.publicKey);
  });

  it('works with only the signed and last-resort keys (one-time keys exhausted)', async () => {
    const alice = party();
    const bob = party();
    const keys = bob.protocol.generatePreKeys({ oneTime: 0, rotate: true });
    await alice.protocol.startSession(
      bob.identity.riverId,
      bob.identity.publicKey,
      serve(keys, bob.identity.registrationId, false),
    );
    const m = await alice.protocol.encrypt(bob.identity.riverId, 1, text('still works'));
    expect(str(await bob.protocol.decrypt(alice.identity.riverId, 1, m))).toBe('still works');
  });

  it('rejects tampered ciphertext and bundles with forged signatures', async () => {
    const alice = party();
    const bob = party();
    const keys = bob.protocol.generatePreKeys({ oneTime: 2, rotate: true });
    const forged = serve(structuredClone(keys), bob.identity.registrationId);
    forged.signedPreKey = { ...forged.signedPreKey, signature: Buffer.alloc(64, 1).toString('base64') };
    await expect(
      alice.protocol.startSession(bob.identity.riverId, bob.identity.publicKey, forged),
    ).rejects.toThrow();
    // A server substituting its own identity key cannot produce valid prekey signatures either.
    const mallory = party();
    await expect(
      alice.protocol.startSession(
        bob.identity.riverId,
        mallory.identity.publicKey,
        serve(structuredClone(keys), bob.identity.registrationId),
      ),
    ).rejects.toThrow();

    await alice.protocol.startSession(
      bob.identity.riverId,
      bob.identity.publicKey,
      serve(keys, bob.identity.registrationId),
    );
    const m = await alice.protocol.encrypt(bob.identity.riverId, 1, text('secret'));
    const raw = Buffer.from(m.body, 'base64');
    raw[raw.length - 5]! ^= 1;
    await expect(
      bob.protocol.decrypt(alice.identity.riverId, 1, { ...m, body: raw.toString('base64') }),
    ).rejects.toThrow();
  });

  it('warns when a contact’s identity changes and blocks sending if they were verified', async () => {
    const alice = party();
    const bob = party();
    const changed: string[] = [];
    alice.protocol.onIdentityChanged = (id) => changed.push(id);
    await alice.protocol.startSession(
      bob.identity.riverId,
      bob.identity.publicKey,
      serve(bob.protocol.generatePreKeys({ oneTime: 1, rotate: true }), bob.identity.registrationId),
    );
    alice.protocol.setVerified(bob.identity.riverId, true);

    // Bob reinstalls: same River ID, new identity key.
    const bob2Identity = { ...createIdentity(), riverId: bob.identity.riverId };
    const bob2 = new RiverProtocol({ ...bob2Identity, deviceId: 1 }, memoryStorage());
    const keys2 = bob2.generatePreKeys({ oneTime: 1, rotate: true });
    await expect(
      alice.protocol.startSession(
        bob.identity.riverId,
        bob2Identity.publicKey,
        serve(keys2, bob2Identity.registrationId),
      ),
    ).rejects.toBeInstanceOf(SafetyNumberChangedError);

    // After the user accepts the new safety number, messaging continues and the change was reported.
    alice.protocol.setVerified(bob.identity.riverId, false);
    await alice.protocol.startSession(
      bob.identity.riverId,
      bob2Identity.publicKey,
      serve(keys2, bob2Identity.registrationId),
    );
    expect(changed).toEqual([bob.identity.riverId]);
    expect(alice.protocol.isVerified(bob.identity.riverId)).toBe(false);
    const m = await alice.protocol.encrypt(bob.identity.riverId, 1, text('welcome back'));
    expect(str(await bob2.decrypt(alice.identity.riverId, 1, m))).toBe('welcome back');
  });

  it('accepts a changed key on an incoming message only when the caller confirms it; verification is kept', async () => {
    const alice = party();
    const bob = party();
    await alice.protocol.startSession(
      bob.identity.riverId,
      bob.identity.publicKey,
      serve(bob.protocol.generatePreKeys({ oneTime: 1, rotate: true }), bob.identity.registrationId),
    );
    const hello = await alice.protocol.encrypt(bob.identity.riverId, 1, text('hi'));
    await bob.protocol.decrypt(alice.identity.riverId, 1, hello);
    expect(alice.protocol.setVerified(bob.identity.riverId, true)).toBe(true);
    expect(alice.protocol.verificationState(bob.identity.riverId)).toBe('verified');

    // Someone with Bob's River ID and a new key starts a session with Alice.
    const bob2Identity = { ...createIdentity(), riverId: bob.identity.riverId };
    const bob2 = new RiverProtocol({ ...bob2Identity, deviceId: 1 }, memoryStorage());
    const aliceKeys = alice.protocol.generatePreKeys({ oneTime: 2, rotate: true });
    const seen: Array<{ deviceId: number; registrationId: number | null }> = [];
    await bob2.startSession(
      alice.identity.riverId,
      alice.identity.publicKey,
      serve(aliceKeys, alice.identity.registrationId),
    );
    const claim = await bob2.encrypt(alice.identity.riverId, 1, text('new phone'));

    // Nobody confirmed it: refused, and the stored key stays.
    await expect(alice.protocol.decrypt(bob.identity.riverId, 1, claim)).rejects.toBeInstanceOf(
      IdentityChangeRefusedError,
    );
    expect(alice.protocol.identityOf(bob.identity.riverId)).toEqual(bob.identity.publicKey);

    // Confirmed (the caller checked the device list signed by the new key): accepted, and the
    // contact shows as changed since verification — never silently unverified.
    alice.protocol.approveIdentityChange = async (change) => {
      seen.push({ deviceId: change.deviceId, registrationId: change.registrationId });
      return Buffer.from(change.identityKey).equals(Buffer.from(bob2Identity.publicKey));
    };
    const claim2 = await bob2.encrypt(alice.identity.riverId, 1, text('new phone, again'));
    expect(str(await alice.protocol.decrypt(bob.identity.riverId, 1, claim2))).toBe('new phone, again');
    expect(seen).toEqual([{ deviceId: 1, registrationId: bob2Identity.registrationId }]);
    expect(alice.protocol.verificationState(bob.identity.riverId)).toBe('changed');
    expect(alice.protocol.isVerified(bob.identity.riverId)).toBe(false);
    // Sending stops until the user verifies the new key.
    await expect(alice.protocol.encrypt(bob.identity.riverId, 1, text('hello?'))).rejects.toBeInstanceOf(
      SafetyNumberChangedError,
    );
    // Verifying needs the key that was compared.
    expect(alice.protocol.setVerified(bob.identity.riverId, true, bob.identity.publicKey)).toBe(false);
    expect(alice.protocol.setVerified(bob.identity.riverId, true, bob2Identity.publicKey)).toBe(true);
    const back = await alice.protocol.encrypt(bob.identity.riverId, 1, text('verified again'));
    expect(str(await bob2.decrypt(alice.identity.riverId, 1, back))).toBe('verified again');
  });

  it('keeps a verification mark from before 2.11 as "changed" when the key changes', async () => {
    const alice = party();
    const bob = party();
    await alice.protocol.startSession(
      bob.identity.riverId,
      bob.identity.publicKey,
      serve(bob.protocol.generatePreKeys({ oneTime: 1, rotate: true }), bob.identity.registrationId),
    );
    alice.storage.put('verified', bob.identity.riverId, new Uint8Array([1]));
    expect(alice.protocol.verificationState(bob.identity.riverId)).toBe('verified');
    const bob2Identity = { ...createIdentity(), riverId: bob.identity.riverId };
    const bob2 = new RiverProtocol({ ...bob2Identity, deviceId: 1 }, memoryStorage());
    await bob2.startSession(
      alice.identity.riverId,
      alice.identity.publicKey,
      serve(alice.protocol.generatePreKeys({ oneTime: 1, rotate: true }), alice.identity.registrationId),
    );
    alice.protocol.approveIdentityChange = async () => true;
    await alice.protocol.decrypt(
      bob.identity.riverId,
      1,
      await bob2.encrypt(alice.identity.riverId, 1, text('x')),
    );
    expect(alice.protocol.verificationState(bob.identity.riverId)).toBe('changed');
  });

  it('never accepts another identity key for its own account (forged copies from "our" devices)', async () => {
    const alice = party();
    const laptopStorage = memoryStorage();
    const laptop = new RiverProtocol({ ...alice.identity, deviceId: 2 }, laptopStorage);
    // Someone else's session, relabelled by the server as coming from Alice's device 3.
    const forger = new RiverProtocol({ ...createIdentity(), deviceId: 3 }, memoryStorage());
    const keys = alice.protocol.generatePreKeys({ oneTime: 2, rotate: true });
    // Even with a caller that would approve anything.
    alice.protocol.approveIdentityChange = async () => true;
    await forger.startSession(
      alice.identity.riverId,
      alice.identity.publicKey,
      serve(keys, alice.identity.registrationId),
    );
    const forged = await forger.encrypt(alice.identity.riverId, 1, text('block everyone'));
    await expect(alice.protocol.decrypt(alice.identity.riverId, 3, forged)).rejects.toBeInstanceOf(
      IdentityChangeRefusedError,
    );
    // The account's real other device works.
    await laptop.startSession(
      alice.identity.riverId,
      alice.identity.publicKey,
      serve(keys, alice.identity.registrationId),
    );
    const copy = await laptop.encrypt(alice.identity.riverId, 1, text('a copy'));
    expect(str(await alice.protocol.decrypt(alice.identity.riverId, 2, copy))).toBe('a copy');
    // And a server handing out another key for our own account is refused when sending.
    const other = party();
    await expect(
      alice.protocol.startSession(
        alice.identity.riverId,
        other.identity.publicKey,
        serve(other.protocol.generatePreKeys({ oneTime: 1, rotate: true }), other.identity.registrationId),
      ),
    ).rejects.toThrow();
  });

  it('never stores keys outside the provided storage', async () => {
    const bob = party();
    bob.protocol.generatePreKeys({ oneTime: 3, rotate: true });
    expect(bob.storage.count('prekey')).toBe(3);
    expect(bob.storage.count('kyber')).toBe(4);
    expect(bob.storage.count('signed')).toBe(1);
  });
});
