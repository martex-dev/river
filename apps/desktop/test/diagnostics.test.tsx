import { describe, expect, it } from 'vitest';
import { classifyNat } from '../src/renderer/src/diagnostics.ts';
import { formatReport, runMainDiagnostics, type DiagnosticsDeps } from '../src/main/diagnostics.ts';

const host = (port: number) => ({
  candidate: `candidate:1 1 udp 2122260223 192.168.0.10 ${port} typ host generation 0`,
});
const srflx = (pub: string, pport: number, base: number, url: string) => ({
  candidate: `candidate:2 1 udp 1686052607 ${pub} ${pport} typ srflx raddr 192.168.0.10 rport ${base} generation 0`,
  url,
});

describe('network type for calls', () => {
  it('one consistent public address is an open network', () => {
    const r = classifyNat([
      host(50000),
      srflx('203.0.113.5', 50000, 50000, 'stun:a'),
      srflx('203.0.113.5', 50000, 50000, 'stun:b'),
    ]);
    expect(r.kind).toBe('open');
  });

  it('different public ports for the same local socket is a strict (symmetric) network', () => {
    const r = classifyNat([
      host(50000),
      srflx('203.0.113.5', 61001, 50000, 'stun:a'),
      srflx('203.0.113.5', 61002, 50000, 'stun:b'),
    ]);
    expect(r.kind).toBe('strict');
  });

  it('no public address at all means call traffic is blocked', () => {
    expect(classifyNat([host(50000), host(50001)]).kind).toBe('blocked');
  });

  it('nothing gathered cannot be judged', () => {
    expect(classifyNat([]).kind).toBe('unknown');
  });

  it('ignores malformed lines', () => {
    expect(classifyNat([{ candidate: 'garbage' }, host(1)]).kind).toBe('blocked');
  });
});

describe('main-process connection checks', () => {
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
