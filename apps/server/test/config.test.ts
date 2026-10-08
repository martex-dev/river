import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('has safe defaults: loopback only, sqlite, no proxy trust', () => {
    const c = loadConfig({});
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(8787);
    expect(c.databaseUrl).toBe('sqlite:./data/river.sqlite');
    expect(c.trustProxy).toBe(false);
    expect(c.publicUrl).toBeUndefined();
  });

  it('reads and coerces RIVER_* variables and ignores others', () => {
    const c = loadConfig({
      RIVER_HOST: '0.0.0.0',
      RIVER_PORT: '9000',
      RIVER_DATABASE_URL: 'postgres://river@db/river',
      RIVER_TRUST_PROXY: 'true',
      RIVER_PUBLIC_URL: 'https://river.example.org',
      HOME: '/root',
    });
    expect(c.host).toBe('0.0.0.0');
    expect(c.port).toBe(9000);
    expect(c.databaseUrl).toBe('postgres://river@db/river');
    expect(c.trustProxy).toBe(true);
    expect(c.publicUrl).toBe('https://river.example.org');
  });

  it('treats empty values as unset', () => {
    expect(loadConfig({ RIVER_PORT: '' }).port).toBe(8787);
  });

  it('rejects invalid values with every problem listed', () => {
    try {
      loadConfig({
        RIVER_PORT: '99999',
        RIVER_DATABASE_URL: 'mysql://x',
        RIVER_PUBLIC_URL: 'http://insecure.example',
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as Error).message;
      expect(msg).toContain('RIVER_PORT');
      expect(msg).toContain('RIVER_DATABASE_URL');
      expect(msg).toContain('RIVER_PUBLIC_URL');
    }
  });

  it('rejects ambiguous booleans', () => {
    expect(() => loadConfig({ RIVER_TRUST_PROXY: 'maybe' })).toThrow(ConfigError);
  });
});
