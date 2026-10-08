import { describe, expect, it } from 'vitest';
import {
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  checkCompatibility,
  errorResponseSchema,
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

  it('error bodies cannot carry long internal messages', () => {
    expect(errorResponseSchema.safeParse({ error: { code: 'x', message: 'a'.repeat(501) } }).success).toBe(
      false,
    );
  });
});
