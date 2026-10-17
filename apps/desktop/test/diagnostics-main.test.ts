import { describe, expect, it } from 'vitest';
import { formatReport, runMainDiagnostics, type DiagnosticsDeps } from '../src/main/diagnostics.ts';

// The first test imports the diagnostics module cold: slow on a busy machine.
describe('main-process connection checks', { timeout: 30_000 }, () => {
  const base = (over: Partial<DiagnosticsDeps> = {}): DiagnosticsDeps => ({
    fetchBytes: async () => new Uint8Array(),
    account: () => ({ state: 'registered', serverUrl: 'https://srv.example', username: 'martex' }),
    connection: () => 'online',
    hosting: () => ({ state: 'off', address: null }),
    homeServerEnabled: true,
    version: '1.0.16',
    platform: 'win32-x64',
    ...over,
  });

  it('all good', async () => {
    const checks = await runMainDiagnostics(base());
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ['app', 'ok'],
      ['relay', 'ok'],
      ['account', 'ok'],
      ['server', 'ok'],
      ['live', 'ok'],
    ]);
  });

  it('an unreachable server and a dropped connection are failures with advice', async () => {
    const checks = await runMainDiagnostics(
      base({
        fetchBytes: async (url) => {
          if (url.includes('/v1/health')) throw new Error('ECONNREFUSED');
          return new Uint8Array();
        },
        connection: () => 'offline',
      }),
    );
    const server = checks.find((c) => c.id === 'server')!;
    expect(server.status).toBe('fail');
    expect(server.advice).toBeTruthy();
    expect(checks.find((c) => c.id === 'live')!.status).toBe('fail');
  });

  it('a blocked relay is a warning, and no account says so', async () => {
    const checks = await runMainDiagnostics(
      base({
        fetchBytes: async () => {
          throw new Error('blocked');
        },
        account: () => ({ state: 'none' }),
      }),
    );
    expect(checks.find((c) => c.id === 'relay')!.status).toBe('warn');
    expect(checks.find((c) => c.id === 'account')!.status).toBe('warn');
    expect(checks.some((c) => c.id === 'server')).toBe(false);
  });

  it('the report is plain text with no server address or token', async () => {
    const text = formatReport(await runMainDiagnostics(base()));
    expect(text).toContain('OK   Server: answers in');
    expect(text).not.toContain('srv.example');
  });
});

describe('links from messages', () => {
  it('only web addresses without embedded credentials may be offered to the browser', async () => {
    const { safeExternalUrl } = await import('../src/main/ipc.ts');
    expect(safeExternalUrl('https://example.org/x')?.href).toBe('https://example.org/x');
    expect(safeExternalUrl('http://example.org')?.hostname).toBe('example.org');
    expect(safeExternalUrl('https://аpple.com')?.hostname).toBe('xn--pple-43d.com'); // look-alike shown as punycode
    for (const bad of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'river://x',
      'https://u:p@example.org',
      42,
      'x'.repeat(3000),
    ])
      expect(safeExternalUrl(bad)).toBeNull();
  });
});
