import { describe, expect, it } from 'vitest';
import { runMainDiagnostics } from '../src/main/diagnostics.ts';
import { StartupTimings } from '../src/shared/startup-timings.ts';

describe('start-up timings', () => {
  it('records each step once, in order', () => {
    let t = 0;
    const s = new StartupTimings(() => t);
    expect(s.summary()).toBeNull();
    t = 180.4;
    s.mark('ready');
    t = 240.6;
    s.mark('data');
    t = 999;
    s.mark('ready');
    expect(s.get('ready')).toBe(180);
    expect(s.get('window')).toBeNull();
    expect(s.summary()).toBe('ready 180 ms · data 241 ms');
  });

  it('shows up in the connection check when there is something to show', async () => {
    const base = {
      fetchBytes: async () => new Uint8Array(),
      account: () => ({ state: 'none' }),
      connection: () => 'offline' as const,
      hosting: () => ({ state: 'off', address: null }),
      homeServerEnabled: false,
      version: '2.21.0',
      platform: 'win32-x64',
    };
    const withTimes = await runMainDiagnostics({ ...base, startup: () => 'ready 180 ms · window 260 ms' });
    expect(withTimes.find((c) => c.id === 'startup')).toEqual({
      id: 'startup',
      label: 'Start-up',
      status: 'ok',
      detail: 'ready 180 ms · window 260 ms',
    });
    expect((await runMainDiagnostics(base)).some((c) => c.id === 'startup')).toBe(false);
  });
});
