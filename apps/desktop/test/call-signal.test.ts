import { generateKeyPair, sign } from '@river/crypto';
import { describe, expect, it } from 'vitest';
import { openSignal, signSignal, type SignalKeys } from '../src/main/community/call-signal.ts';

const alice = generateKeyPair();
const mallory = generateKeyPair();
const route = { communityId: 'c1', channelId: 'v1', from: 'alice', to: 'bob' };
const offer = { kind: 'offer', sdp: 'v=0 a=fingerprint:sha-256 AA:BB' };

function keys(init: { session?: Uint8Array; profile?: Uint8Array; pinned?: Uint8Array } = {}) {
  const pins = new Map<string, Uint8Array>();
  if (init.pinned) pins.set('alice', init.pinned);
  const k: SignalKeys = {
    sessionKey: () => init.session ?? null,
    pinned: (id) => pins.get(id) ?? null,
    pin: (id, key) => pins.set(id, key),
    profileKey: () => init.profile ?? null,
  };
  return { k, pins };
}

const signedBy = (privateKey: Uint8Array, r = route) => signSignal(r, offer, (m) => sign(privateKey, m));

describe('identity-bound call signals', () => {
  it('accepts a signal signed by the key in the community profile, and pins it', () => {
    const { k, pins } = keys({ profile: alice.publicKey });
    expect(openSignal(route, signedBy(alice.privateKey), k)).toEqual({
      ok: true,
      payload: offer,
      signed: true,
    });
    expect(pins.get('alice')).toEqual(alice.publicKey);
  });

  it('refuses a signal forged with another key, even if the profile is swapped later', () => {
    const { k } = keys({ profile: alice.publicKey });
    expect(openSignal(route, signedBy(alice.privateKey), k).ok).toBe(true);
    // A member holding the community key re-seals a profile with their own key: the pin wins.
    const swapped = { ...k, profileKey: () => mallory.publicKey };
    expect(openSignal(route, signedBy(mallory.privateKey), swapped)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('prefers the key libsignal holds from direct messages', () => {
    const { k } = keys({ session: alice.publicKey, profile: mallory.publicKey });
    expect(openSignal(route, signedBy(mallory.privateKey), k).ok).toBe(false);
    expect(openSignal(route, signedBy(alice.privateKey), k).ok).toBe(true);
  });

  it('binds the signature to community, channel, sender and recipient', () => {
    const { k } = keys({ profile: alice.publicKey });
    for (const r of [
      { ...route, to: 'carol' },
      { ...route, channelId: 'v2' },
      { ...route, communityId: 'c2' },
    ]) {
      expect(openSignal(route, signedBy(alice.privateKey, r), k)).toEqual({
        ok: false,
        reason: 'bad-signature',
      });
    }
  });

  it('refuses a tampered payload', () => {
    const { k } = keys({ profile: alice.publicKey });
    const s = signedBy(alice.privateKey);
    const tampered = { ...s, j: s.j.replace('AA:BB', 'CC:DD') };
    expect(openSignal(route, tampered, k).ok).toBe(false);
  });

  it('accepts unsigned signals only from people who never signed (River before 1.5)', () => {
    expect(openSignal(route, offer, keys().k)).toEqual({ ok: true, payload: offer, signed: false });
    expect(openSignal(route, offer, keys({ pinned: alice.publicKey }).k)).toEqual({
      ok: false,
      reason: 'unsigned',
    });
  });

  it('treats a signed signal with no known key like an unsigned one (and pins nothing)', () => {
    const { k, pins } = keys();
    expect(openSignal(route, signedBy(alice.privateKey), k)).toEqual({
      ok: true,
      payload: offer,
      signed: false,
    });
    expect(pins.size).toBe(0);
  });
});
