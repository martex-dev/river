import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { msg } from '../../shared/i18n/index.ts';

/**
 * A permanent public address for a server hosted on this PC, free, through
 * Tailscale Funnel (1.0.43): https://<this-pc>.<tailnet>.ts.net never changes
 * and does not drop every few minutes the way a Cloudflare quick tunnel does.
 * Only the hosting PC needs Tailscale; members reach the address like any
 * website. TLS ends on this PC, so Tailscale's relays only see encrypted bytes.
 */
export type FunnelCheck =
  /** Tailscale is not installed (or not found). */
  | { state: 'missing' }
  /** Installed, but not signed in or not running. */
  | { state: 'signed-out' }
  /** Signed in: this is the address Funnel serves. */
  | { state: 'ready'; address: string };

export interface FunnelProvider {
  check(): Promise<FunnelCheck>;
  /**
   * Serves `localUrl` (http://127.0.0.1:port) at the permanent address. The first
   * time, Tailscale asks its owner to allow Funnel: `onApproval` gets that page's
   * link, and this waits until it is allowed (or gives up).
   */
  open(localUrl: string, onApproval: (url: string) => void): Promise<void>;
  close(): Promise<void>;
}

/** Where Tailscale's command-line tool is installed. */
export function tailscaleCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    return [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files']
      .filter((d): d is string => !!d)
      .map((d) => join(d, 'Tailscale', 'tailscale.exe'));
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
      '/opt/homebrew/bin/tailscale',
      '/usr/local/bin/tailscale',
    ];
  }
  return ['/usr/bin/tailscale', '/usr/local/bin/tailscale'];
}

const TS_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/;

/** Reads `tailscale status --json`. */
export function parseTailscaleStatus(json: string): FunnelCheck {
  let s: { BackendState?: unknown; Self?: { DNSName?: unknown } };
  try {
    s = JSON.parse(json) as typeof s;
  } catch {
    return { state: 'signed-out' };
  }
  if (s.BackendState !== 'Running') return { state: 'signed-out' };
  const name = typeof s.Self?.DNSName === 'string' ? s.Self.DNSName.replace(/\.$/, '').toLowerCase() : '';
  if (!TS_NAME.test(name)) return { state: 'signed-out' };
  return { state: 'ready', address: `https://${name}` };
}

/** The "allow Funnel" page Tailscale prints the first time, if this line has it. */
export function approvalLink(line: string): string | null {
  const m = /https:\/\/login\.tailscale\.com\/[^\s"'<>]+/.exec(line);
  return m ? m[0] : null;
}

interface RunResult {
  code: number | null;
  output: string;
}

type Runner = (
  binary: string,
  args: string[],
  opts: { timeoutMs: number; onLine?: (line: string) => void },
) => Promise<RunResult>;

const runProcess: Runner = (binary, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const read = (chunk: Buffer): void => {
      const text = chunk.toString();
      output = (output + text).slice(-64_000);
      for (const line of text.split(/\r?\n/)) if (line.trim()) opts.onLine?.(line);
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    const timer = setTimeout(() => child.kill(), opts.timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, output });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });

/** Allowing Funnel is a person reading a page and clicking: give them time. */
const APPROVAL_WAIT_MS = 15 * 60 * 1000;

export function tailscaleFunnel(opts: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  run?: Runner;
}): FunnelProvider {
  const exists = opts.exists ?? existsSync;
  const run = opts.run ?? runProcess;
  const binary = (): string | undefined =>
    tailscaleCandidates(opts.platform, opts.env).find((p) => exists(p));
  return {
    async check() {
      const bin = binary();
      if (!bin) return { state: 'missing' };
      const res = await run(bin, ['status', '--json'], { timeoutMs: 15_000 });
      return parseTailscaleStatus(res.output.slice(res.output.indexOf('{')));
    },
    async open(localUrl, onApproval) {
      const bin = binary();
      if (!bin) throw new Error(msg('Tailscale is not installed.'));
      // --bg: Tailscale keeps serving by itself (also after River restarts); --yes: no prompts.
      const res = await run(bin, ['funnel', '--bg', '--yes', '--https=443', localUrl], {
        timeoutMs: APPROVAL_WAIT_MS,
        onLine: (line) => {
          const link = approvalLink(line);
          if (link) onApproval(link);
        },
      });
      if (res.code !== 0) {
        const last = res.output.trim().split(/\r?\n/).at(-1) ?? '';
        throw new Error(`Tailscale could not open the address${last ? `: ${last}` : '.'}`);
      }
    },
    async close() {
      const bin = binary();
      if (bin) await run(bin, ['funnel', '--https=443', 'off'], { timeoutMs: 15_000 });
    },
  };
}
