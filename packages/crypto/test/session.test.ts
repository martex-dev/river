import { describe, expect, it } from 'vitest';
import { createIdentity } from '../src/identity.ts';
import {
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

  it('never stores keys outside the provided storage', async () => {
    const bob = party();
    bob.protocol.generatePreKeys({ oneTime: 3, rotate: true });
    expect(bob.storage.count('prekey')).toBe(3);
    expect(bob.storage.count('kyber')).toBe(4);
    expect(bob.storage.count('signed')).toBe(1);
  });
});
