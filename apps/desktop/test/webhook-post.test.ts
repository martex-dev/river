import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { open } from '../src/main/community/sealed.ts';
// @ts-expect-error -- plain JavaScript reference script, no type declarations
import { parseAddress, sealPost } from '../../../scripts/webhook/post.mjs';

describe('webhook reference script (ADR 0004)', () => {
  const key = randomBytes(32);
  const address = `https://river.example/v1/webhooks/abc#${new URLSearchParams({
    c: 'community1',
    ch: 'channel1',
    t: 'tok',
    k: key.toString('base64url'),
  }).toString()}`;

  it('keeps the token and key out of the URL it posts to', () => {
    const hook = parseAddress(address);
    expect(hook.endpoint).toBe('https://river.example/v1/webhooks/abc');
    expect(hook.token).toBe('tok');
    expect(Buffer.compare(hook.key, key)).toBe(0);
  });

  it('seals posts that River opens with the webhook key, bound to the channel', () => {
    const sealed = sealPost(parseAddress(address), 'Build #42 passed');
    expect(open(key, 'community1', 'message:channel1', sealed)).toEqual({ text: 'Build #42 passed' });
    expect(() => open(key, 'community1', 'message:other', sealed)).toThrow();
    expect(() => open(randomBytes(32), 'community1', 'message:channel1', sealed)).toThrow();
  });

  it('rejects incomplete addresses', () => {
    expect(() => parseAddress('https://river.example/v1/webhooks/abc#t=x')).toThrow();
  });
});
