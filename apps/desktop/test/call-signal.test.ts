import { generateKeyPair, sign } from '@river/crypto';
import { describe, expect, it } from 'vitest';
import {
  openSignal,
  SIGNAL_MAX_AGE_MS,
  SignalReplayGuard,
  signSignal,
  type SignalKeys,
} from '../src/main/community/call-signal.ts';

const alice = generateKeyPair();
const mallory = generateKeyPair();
const route = { communityId: 'c1', channelId: 'v1', from: 'alice', to: 'bob' };
const offer = { kind: 'offer', sdp: 'v=0 a=fingerprint:sha-256 AA:BB' };
const NOW = 1_800_000_000_000;

const knows = (key: Uint8Array | null): SignalKeys => ({ sessionKey: () => key });
const signedBy = (privateKey: Uint8Array, r = route, at = NOW) =>
  signSignal(r, offer, (m) => sign(privateKey, m), at);

describe('identity-bound call signals', () => {
  it('accepts a fresh signal signed by the key libsignal holds for the sender', () => {
    expect(openSignal(route, signedBy(alice.privateKey), knows(alice.publicKey), NOW)).toEqual({
      ok: true,
      payload: offer,
      identityBound: true,
    });
  });

  it('refuses a signal forged by anyone else (a member holding the community key)', () => {
    expect(openSignal(route, signedBy(mallory.privateKey), knows(alice.publicKey), NOW)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('refuses a stripped (unsigned) signal from someone River holds a key for', () => {
    expect(openSignal(route, offer, knows(alice.publicKey), NOW)).toEqual({ ok: false, reason: 'unsigned' });
  });

  it('binds the signature to community, channel, sender and recipient', () => {
    for (const r of [
      { ...route, to: 'carol' },
      { ...route, channelId: 'v2' },
      { ...route, communityId: 'c2' },
    ]) {
      expect(openSignal(route, signedBy(alice.privateKey, r), knows(alice.publicKey), NOW)).toEqual({
        ok: false,
        reason: 'bad-signature',
      });
    }
  });

  it('refuses tampered payloads and changed times', () => {
    const s = signedBy(alice.privateKey);
    const tampered = { ...s, j: s.j.replace('AA:BB', 'CC:DD') };
    expect(openSignal(route, tampered, knows(alice.publicKey), NOW).ok).toBe(false);
    expect(openSignal(route, { ...s, t: s.t + 1 }, knows(alice.publicKey), NOW).ok).toBe(false);
  });

  it('refuses replays of old signals', () => {
    const old = signedBy(alice.privateKey, route, NOW - SIGNAL_MAX_AGE_MS - 1);
    expect(openSignal(route, old, knows(alice.publicKey), NOW)).toEqual({ ok: false, reason: 'stale' });
  });

  it('without a libsignal key, signals rest on the community key alone (and say so)', () => {
    expect(openSignal(route, offer, knows(null), NOW)).toEqual({
      ok: true,
      payload: offer,
      identityBound: false,
    });
    expect(openSignal(route, signedBy(mallory.privateKey), knows(null), NOW)).toEqual({
      ok: true,
      payload: offer,
      identityBound: false,
    });
  });
});

describe('call signal replays and changed keys (2.11)', () => {
  it('refuses the same signed signal a second time within its lifetime', () => {
    const guard = new SignalReplayGuard();
    const s = signedBy(alice.privateKey);
    expect(openSignal(route, s, knows(alice.publicKey), NOW, guard)).toMatchObject({ ok: true });
    expect(openSignal(route, s, knows(alice.publicKey), NOW + 1000, guard)).toEqual({
      ok: false,
      reason: 'replayed',
    });
    // A fresh signal from the same person still goes through.
    expect(openSignal(route, signedBy(alice.privateKey), knows(alice.publicKey), NOW, guard)).toMatchObject({
      ok: true,
    });
    // A forged signature never takes a place in the guard.
    expect(openSignal(route, signedBy(mallory.privateKey), knows(alice.publicKey), NOW, guard)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  it('forgets signatures once they would be stale anyway, and stays bounded', () => {
    const guard = new SignalReplayGuard(3);
    for (let i = 0; i < 10; i++) expect(guard.remember(`sig${i}`, NOW, NOW)).toBe(true);
    expect(guard.remember('sig9', NOW, NOW)).toBe(false);
    expect(guard.remember('sig0', NOW, NOW)).toBe(true);
    expect(guard.remember('sig9', NOW, NOW + SIGNAL_MAX_AGE_MS * 2)).toBe(true);
  });

  it('does not trust a key that just changed (or changed after it was verified)', () => {
    const changed: SignalKeys = { sessionKey: () => alice.publicKey, keyChanged: () => true };
    expect(openSignal(route, signedBy(alice.privateKey), changed, NOW)).toEqual({
      ok: false,
      reason: 'changed',
    });
  });
});
