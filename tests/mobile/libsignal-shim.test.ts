import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as real from '@signalapp/libsignal-client';
import { describe, expect, it } from 'vitest';
import * as shim from '../../apps/mobile/core/shims/libsignal.ts';

/**
 * The phone's libsignal (apps/mobile/core/shims/libsignal.ts) stands in for
 * @signalapp/libsignal-client in the core bundle. It must offer everything
 * packages/crypto uses, with the same wire numbers: a phone and a computer
 * exchange these messages directly.
 */

const CRYPTO = resolve(import.meta.dirname, '../../packages/crypto/src');

/** Every name packages/crypto imports from libsignal-client (values and types). */
function importedNames(): { values: Set<string>; types: Set<string> } {
  const values = new Set<string>();
  const types = new Set<string>();
  for (const file of readdirSync(CRYPTO).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(CRYPTO, file), 'utf8');
    for (const m of source.matchAll(
      /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'@signalapp\/libsignal-client'/g,
    )) {
      for (const raw of m[2]!.split(',')) {
        const name = raw.trim();
        if (!name) continue;
        if (m[1] || name.startsWith('type ')) types.add(name.replace(/^type\s+/, ''));
        else values.add(name);
      }
    }
  }
  return { values, types };
}

/** What packages/crypto calls on each import (session.ts, identity.ts, signing.ts). */
const USED: Record<string, { statics?: string[]; methods?: string[] }> = {
  PublicKey: { statics: ['deserialize'], methods: ['serialize', 'verify', 'seal'] },
  PrivateKey: {
    statics: ['generate', 'deserialize'],
    methods: ['serialize', 'sign', 'getPublicKey', 'open'],
  },
  IdentityKeyPair: { statics: ['generate'] },
  KEMKeyPair: { statics: ['generate'], methods: ['getPublicKey'] },
  KEMPublicKey: { statics: ['deserialize'], methods: ['serialize'] },
  PreKeyRecord: { statics: ['new', 'deserialize'], methods: ['serialize'] },
  SignedPreKeyRecord: {
    statics: ['new', 'deserialize'],
    methods: ['serialize', 'id', 'publicKey', 'signature'],
  },
  KyberPreKeyRecord: {
    statics: ['new', 'deserialize'],
    methods: ['serialize', 'id', 'publicKey', 'signature'],
  },
  SessionRecord: { statics: ['deserialize'], methods: ['serialize', 'hasCurrentState'] },
  ProtocolAddress: { statics: ['new'], methods: ['name', 'deviceId', 'toString'] },
  PreKeyBundle: { statics: ['new'], methods: ['identityKey'] },
  SignalMessage: { statics: ['deserialize'], methods: ['serialize'] },
  PreKeySignalMessage: { statics: ['deserialize'], methods: ['serialize', 'registrationId'] },
  Fingerprint: { statics: ['new'], methods: ['displayableFingerprint', 'scannableFingerprint'] },
  LibSignalErrorBase: { statics: ['is'] },
};

const lib = (m: object, name: string): unknown => (m as Record<string, unknown>)[name];

describe("the phone's libsignal stand-in", () => {
  it('exports every value packages/crypto imports from libsignal-client', () => {
    const { values } = importedNames();
    expect(values.size).toBeGreaterThan(20);
    for (const name of values) {
      expect(lib(shim, name), `${name} is missing from shims/libsignal.ts`).toBeDefined();
      expect(lib(real, name), `${name} is not libsignal's`).toBeDefined();
    }
  });

  it('has every method packages/crypto calls, as libsignal-client has them', () => {
    const { values } = importedNames();
    for (const [name, used] of Object.entries(USED)) {
      expect(values.has(name), `${name} is no longer imported: update USED`).toBe(true);
      const mine = lib(shim, name) as Record<string, unknown> & { prototype: Record<string, unknown> };
      const theirs = lib(real, name) as Record<string, unknown> & { prototype: Record<string, unknown> };
      for (const s of used.statics ?? []) {
        expect(typeof theirs[s], `libsignal has no ${name}.${s}`).toBe('function');
        expect(typeof mine[s], `${name}.${s} is missing from the shim`).toBe('function');
      }
      for (const m of used.methods ?? []) {
        expect(typeof theirs.prototype[m], `libsignal has no ${name}#${m}`).toBe('function');
        expect(typeof mine.prototype[m], `${name}#${m} is missing from the shim`).toBe('function');
      }
    }
    // The functions and the stores River subclasses.
    for (const name of [
      'processPreKeyBundle',
      'signalEncrypt',
      'signalDecrypt',
      'signalDecryptPreKey',
      'SessionStore',
      'IdentityKeyStore',
      'PreKeyStore',
      'SignedPreKeyStore',
      'KyberPreKeyStore',
    ]) {
      expect(typeof lib(shim, name), name).toBe('function');
    }
    // IdentityKeyPair's keys are fields, not methods.
    const pair = new shim.IdentityKeyPair(
      undefined as unknown as shim.PublicKey,
      undefined as unknown as shim.PrivateKey,
    );
    expect(Object.keys(pair).sort()).toEqual(['privateKey', 'publicKey']);
  });

  it("uses libsignal's own numbers for message types and the values River compares", () => {
    // Message types travel between phones and computers in every envelope.
    expect(shim.CiphertextMessageType.Whisper).toBe(real.CiphertextMessageType.Whisper);
    expect(shim.CiphertextMessageType.PreKey).toBe(real.CiphertextMessageType.PreKey);
    expect(shim.Direction.Sending).toBe(real.Direction.Sending);
    expect(shim.Direction.Receiving).toBe(real.Direction.Receiving);
    expect(shim.IdentityChange.NewOrUnchanged).toBe(real.IdentityChange.NewOrUnchanged);
    expect(shim.IdentityChange.ReplacedExisting).toBe(real.IdentityChange.ReplacedExisting);
    for (const code of [
      'UntrustedIdentity',
      'DuplicatedMessage',
      'InvalidSession',
      'VerificationFailed',
    ] as const) {
      expect(shim.ErrorCode[code], code).toBe(real.ErrorCode[code]);
    }
    const err = new shim.LibSignalErrorBase('untrusted', shim.ErrorCode.UntrustedIdentity, 'test');
    expect(shim.LibSignalErrorBase.is(err, shim.ErrorCode.UntrustedIdentity)).toBe(true);
    expect(shim.LibSignalErrorBase.is(err, shim.ErrorCode.InvalidSession)).toBe(false);
  });
});
