import { describe, expect, it } from 'vitest';
import { classifyNat } from '../src/renderer/src/diagnostics.ts';

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
