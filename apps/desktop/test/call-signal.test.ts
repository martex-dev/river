import { generateKeyPair, sign } from '@river/crypto';
import { describe, expect, it } from 'vitest';
import {
  openSignal,
  SIGNAL_MAX_AGE_MS,
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
