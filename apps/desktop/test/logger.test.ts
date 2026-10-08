import { describe, expect, it } from 'vitest';
import { redact } from '../src/main/logger.ts';

describe('log redaction', () => {
  it('scrubs keys and tokens', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nNOT-A-REAL-KEY\n-----END PRIVATE KEY-----';
    expect(redact(`loaded ${pem}`)).toBe('loaded [redacted key]');
    expect(redact(`token=${'gh' + 'p_'}${'x'.repeat(36)}`)).not.toContain('ghp_');
    expect(redact('Authorization: Bearer abc')).not.toContain('Bearer abc');
  });
});
