import { createDecipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SEALED_MESSAGE,
  SEALED_PROFILE,
  SEALED_SMALL,
  sendMessageRequestSchema,
  profileRequestSchema,
  sealedSchema,
} from '@river/protocol';
import { messageBinding, open, openBound, seal, sealBound } from '../src/main/community/sealed.ts';

/**
 * How River 2.11.0 – 2.12.1 open community values, copied as released
 * (apps/desktop/src/main/community/sealed.ts: aad, aadV2, openWithAad). Those versions know
 * nothing about padding; this proves they read padded values (2.13) unchanged.
 */
const aad212 = (communityId: string, purpose: string): Buffer =>
  Buffer.from(`river-community-v1|${communityId}|${purpose}`, 'utf8');
const aadV2212 = (communityId: string, purpose: string, binding: string): Buffer =>
  Buffer.from(`river-community-v2|${communityId}|${purpose}|${binding}`, 'utf8');
function openWithAad212<T>(key: Uint8Array, associated: Buffer, sealed: string): T {
  const raw = Buffer.from(sealed, 'base64');
  if (raw.length < 12 + 16) throw new Error('sealed value too short');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(associated);
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  const pt = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
  return JSON.parse(pt.toString('utf8')) as T;
}

const bytes = (sealed: string): number => Buffer.from(sealed, 'base64').length;

describe('padded community values (2.13)', () => {
  const key = randomBytes(32);
  const community = 'c'.repeat(22);
  const me = '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e4b71';

  it('hides the length of short messages: different texts seal to the same size', () => {
    const purpose = 'message:chan' as const;
    const a = sealBound(key, community, purpose, messageBinding('m1', me), { text: 'ok' }, true);
    const b = sealBound(
      key,
      community,
      purpose,
      messageBinding('m2', me),
      { text: 'a rather longer message that is still short' },
      true,
    );
    expect(bytes(a)).toBe(bytes(b));
    expect(bytes(a)).toBe(12 + 160 + 16);
    // Reactions too: which emoji was picked no longer shows in the size.
    expect(bytes(seal(key, community, 'reaction:m1', { emoji: '👍' }))).toBe(
      bytes(seal(key, community, 'reaction:m1', { emoji: '🏳️‍🌈' })),
    );
  });

  it('2.11 / 2.12 open padded v1 and v2 values exactly as before', () => {
    const value = { text: 'hello from 2.13', attachments: [], reply: null };
    const v1 = seal(key, community, 'message:chan', value);
    expect(openWithAad212(key, aad212(community, 'message:chan'), v1)).toEqual(value);
    const binding = messageBinding('msg1', me);
    const v2 = sealBound(key, community, 'message:chan', binding, value, true);
    expect(openWithAad212(key, aadV2212(community, 'message:chan', binding), v2)).toEqual(value);
    const profile = { name: 'Ana', avatar: `data:image/webp;base64,${'A'.repeat(5000)}` };
    const p = sealBound(key, community, 'profile', me, profile, true);
    expect(openWithAad212(key, aadV2212(community, 'profile', me), p)).toEqual(profile);
    // And this River still opens them (and values sealed without padding).
    expect(open(key, community, 'message:chan', v1)).toEqual(value);
    expect(openBound(key, community, 'message:chan', binding, v2)).toEqual({ value, version: 2 });
  });

  it('never seals a value larger than the server accepts for it', () => {
    // Just under the message limit: padding stops at the limit instead of overflowing it.
    const text = 'x'.repeat(SEALED_MESSAGE - 28 - 20);
    const body = sealBound(key, community, 'message:chan', messageBinding('m', me), { text }, true);
    expect(bytes(body)).toBeLessThanOrEqual(SEALED_MESSAGE);
    expect(sendMessageRequestSchema.safeParse({ id: 'A'.repeat(22), body }).success).toBe(true);
    const avatar = 'A'.repeat(SEALED_PROFILE - 28 - 40);
    const profile = sealBound(key, community, 'profile', me, { avatar }, true);
    expect(profileRequestSchema.safeParse({ profile }).success).toBe(true);
    const name = seal(key, community, 'channel:x', { name: 'n'.repeat(SEALED_SMALL - 28 - 12) });
    expect(sealedSchema(SEALED_SMALL).safeParse(name).success).toBe(true);
  });

  it('keeps key proofs under the 400 characters 2.11 accepts in a key message', () => {
    const proof = seal(key, community, 'epoch:7', { key: randomBytes(32).toString('base64'), prev: 6 });
    expect(proof.length).toBeLessThanOrEqual(400);
  });

  it('pads larger values to Padmé buckets', () => {
    const sizes = new Set<number>();
    for (let n = 3000; n < 30_000; n += 97) {
      sizes.add(bytes(seal(key, community, 'message:chan', { text: 'y'.repeat(n) })));
    }
    expect(sizes.size).toBeLessThan(60);
  });
});
