import { PreKeySignalMessage } from '@signalapp/libsignal-client';
import { describe, expect, it } from 'vitest';
import { createIdentity } from '../../packages/crypto/src/identity.ts';
import { RiverProtocol, type ProtocolStorage, type StoreKind } from '../../packages/crypto/src/session.ts';
import { preKeyRegistrationId } from '../../apps/mobile/core/shims/libsignal.ts';

function memory(): ProtocolStorage {
  const map = new Map<string, Uint8Array>();
  const k = (kind: StoreKind, id: string): string => `${kind}:${id}`;
  return {
    get: (kind, id) => map.get(k(kind, id)) ?? null,
    put: (kind, id, value) => void map.set(k(kind, id), new Uint8Array(value)),
    delete: (kind, id) => void map.delete(k(kind, id)),
    count: (kind) => [...map.keys()].filter((x) => x.startsWith(`${kind}:`)).length,
  };
}

describe("the phone's PreKeySignalMessage", () => {
  it('reads the same registration ID as libsignal itself', async () => {
    for (let n = 0; n < 5; n++) {
      const alice = createIdentity();
      const bob = createIdentity();
      const a = new RiverProtocol({ ...alice, deviceId: 1 }, memory());
      const b = new RiverProtocol({ ...bob, deviceId: 1 }, memory());
      const keys = b.generatePreKeys({ oneTime: 1, rotate: true });
      await a.startSession(bob.riverId, bob.publicKey, {
        deviceId: 1,
        registrationId: bob.registrationId,
        signedPreKey: keys.signedPreKey,
        preKey: keys.preKeys[0] ?? null,
        kyberPreKey: keys.kyberPreKeys[0] ?? keys.kyberLastResort,
      });
      const first = await a.encrypt(bob.riverId, 1, new TextEncoder().encode('hi'));
      const bytes = Buffer.from(first.body, 'base64');
      expect(preKeyRegistrationId(bytes)).toBe(PreKeySignalMessage.deserialize(bytes).registrationId());
      expect(preKeyRegistrationId(bytes)).toBe(alice.registrationId);
    }
  });

  it('gives 0 for malformed bytes instead of throwing', () => {
    expect(preKeyRegistrationId(new Uint8Array([0x33, 0xff, 0xff]))).toBe(0);
    expect(preKeyRegistrationId(new Uint8Array([]))).toBe(0);
  });
});
