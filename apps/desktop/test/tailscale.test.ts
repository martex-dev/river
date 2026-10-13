import { describe, expect, it } from 'vitest';
import {
  approvalLink,
  parseTailscaleStatus,
  tailscaleCandidates,
  tailscaleFunnel,
} from '../src/main/host/tailscale.ts';

describe('Tailscale Funnel', () => {
  it('reads the permanent address from tailscale status', () => {
    expect(
      parseTailscaleStatus(
        JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'My-PC.tail1234.ts.net.' } }),
      ),
    ).toEqual({ state: 'ready', address: 'https://my-pc.tail1234.ts.net' });
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: 'NeedsLogin', Self: {} }))).toEqual({
      state: 'signed-out',
    });
    expect(parseTailscaleStatus('not json')).toEqual({ state: 'signed-out' });
    // Only real tailnet names: nothing else can become River's public address.
    expect(
      parseTailscaleStatus(
        JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'evil.example.com.' } }),
      ),
    ).toEqual({ state: 'signed-out' });
  });

  it('finds the approval page in the output of tailscale', () => {
    expect(
      approvalLink(
        'Funnel is not enabled on your tailnet. To enable, visit: https://login.tailscale.com/f/funnel?node=nX1',
      ),
    ).toBe('https://login.tailscale.com/f/funnel?node=nX1');
    expect(approvalLink('Available on the internet: https://my-pc.tail1234.ts.net/')).toBeNull();
  });

  it('looks for Tailscale where its installers put it', () => {
    expect(tailscaleCandidates('win32', { ProgramFiles: 'C:\\Program Files' })[0]).toMatch(
      /Program Files[\\/]Tailscale[\\/]tailscale\.exe$/,
    );
    expect(tailscaleCandidates('darwin', {})).toContain(
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    );
    expect(tailscaleCandidates('linux', {})).toContain('/usr/bin/tailscale');
  });

  it('runs funnel in the background for the local server only, and turns it off again', async () => {
    const calls: string[][] = [];
    const funnel = tailscaleFunnel({
      platform: 'linux',
      env: {},
      exists: (p) => p === '/usr/bin/tailscale',
      run: async (_bin, args, opts) => {
        calls.push(args);
        if (args[0] === 'status')
          return {
            code: 0,
            output: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pc.t.ts.net.' } }),
          };
        if (args[0] === 'funnel' && args.includes('--bg')) {
          opts.onLine?.('To enable, visit: https://login.tailscale.com/f/funnel?node=1');
        }
        return { code: 0, output: '' };
      },
    });
    expect(await funnel.check()).toEqual({ state: 'ready', address: 'https://pc.t.ts.net' });
    const approvals: string[] = [];
    await funnel.open('http://127.0.0.1:8790', (u) => approvals.push(u));
    await funnel.close();
    expect(calls).toEqual([
      ['status', '--json'],
      ['funnel', '--bg', '--yes', '--https=443', 'http://127.0.0.1:8790'],
      ['funnel', '--https=443', 'off'],
    ]);
    expect(approvals).toEqual(['https://login.tailscale.com/f/funnel?node=1']);
  });

  it('reports a missing Tailscale and a failed funnel plainly', async () => {
    const none = tailscaleFunnel({ platform: 'linux', env: {}, exists: () => false });
    expect(await none.check()).toEqual({ state: 'missing' });
    const failing = tailscaleFunnel({
      platform: 'linux',
      env: {},
      exists: () => true,
      run: async () => ({ code: 1, output: 'error: Funnel not available; "funnel" node attribute not set' }),
    });
    await expect(failing.open('http://127.0.0.1:8790', () => undefined)).rejects.toThrow(
      /node attribute not set/,
    );
  });
});
