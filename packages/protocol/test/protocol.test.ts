import { describe, expect, it } from 'vitest';
import {
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  checkCompatibility,
  errorResponseSchema,
  serverSupports,
  versionResponseSchema,
} from '../src/index.ts';

describe('protocol', () => {
  it('has a consistent version range', () => {
    expect(MIN_PROTOCOL_VERSION).toBeLessThanOrEqual(PROTOCOL_VERSION);
  });

  it('decides compatibility from both ranges', () => {
    expect(checkCompatibility({ current: 1, min: 1 }, { current: 1, min: 1 })).toBe('compatible');
    expect(checkCompatibility({ current: 3, min: 2 }, { current: 1, min: 1 })).toBe('client-too-old');
    expect(checkCompatibility({ current: 1, min: 1 }, { current: 3, min: 2 })).toBe('server-too-old');
    expect(checkCompatibility({ current: 3, min: 1 }, { current: 2, min: 1 })).toBe('compatible');
  });

  it('validates version responses strictly enough to reject junk', () => {
    expect(
      versionResponseSchema.safeParse({
        product: 'river-server',
        version: '0.0.2',
        protocol: { current: 1, min: 1 },
      }).success,
    ).toBe(true);
    expect(
      versionResponseSchema.safeParse({ product: 'other', version: '1', protocol: { current: 1, min: 1 } })
        .success,
    ).toBe(false);
    expect(
      versionResponseSchema.safeParse({ product: 'river-server', version: '', protocol: {} }).success,
    ).toBe(false);
  });

  it('treats a server without capabilities (before 1.1) as supporting none', () => {
    const old = versionResponseSchema.parse({
      product: 'river-server',
      version: '1.0.46',
      protocol: { current: 1, min: 1 },
    });
    expect(old.capabilities).toEqual([]);
    expect(serverSupports(old, 'voice-relay')).toBe(false);
  });

  it('accepts capabilities a newer server adds and rejects malformed names', () => {
    const base = { product: 'river-server', version: '2.0.0', protocol: { current: 1, min: 1 } };
    const newer = versionResponseSchema.parse({ ...base, capabilities: ['voice-relay', 'future-thing'] });
    expect(serverSupports(newer, 'voice-relay')).toBe(true);
    expect(serverSupports(newer, 'attachments')).toBe(false);
    for (const bad of ['Voice', 'a b', '', 'x'.repeat(49), '-lead']) {
      expect(versionResponseSchema.safeParse({ ...base, capabilities: [bad] }).success).toBe(false);
    }
    expect(versionResponseSchema.safeParse({ ...base, capabilities: Array(65).fill('a') }).success).toBe(
      false,
    );
  });

  it('error bodies cannot carry long internal messages', () => {
    expect(errorResponseSchema.safeParse({ error: { code: 'x', message: 'a'.repeat(501) } }).success).toBe(
      false,
    );
  });
});
