import { API_PREFIX } from '@river/protocol';
import type { DiagnosticCheck } from '../shared/ipc.ts';
import { HOME_SERVER } from '../shared/home-server.ts';
import type { FetchBytes } from './http.ts';

/**
 * Settings → System → Connection check (1.0.16), main-process half: can this
 * PC reach the internet, River's address relay, and the user's server, and is
 * the live connection up. The renderer adds the network-type and microphone
 * checks (WebRTC lives there). Reports contain no content, keys or tokens.
 */
export interface DiagnosticsDeps {
  fetchBytes: FetchBytes;
  account: () => { state: string; serverUrl?: string; username?: string | null };
  connection: () => 'online' | 'offline' | 'connecting';
  hosting: () => { state: string; address: string | null };
  homeServerEnabled: boolean;
  version: string;
  platform: string;
  /** How long this start took, step by step (startup-timings.ts). */
  startup?: () => string | null;
  now?: () => number;
}

async function timed<T>(fn: () => Promise<T>, now: () => number): Promise<{ value: T; ms: number }> {
  const t = now();
  const value = await fn();
  return { value, ms: Math.round(now() - t) };
}

export async function runMainDiagnostics(deps: DiagnosticsDeps): Promise<DiagnosticCheck[]> {
  const now = deps.now ?? (() => performance.now());
  const checks: DiagnosticCheck[] = [
    { id: 'app', label: 'River', status: 'ok', detail: `${deps.version} on ${deps.platform}` },
  ];
  const startup = deps.startup?.();
  if (startup) checks.push({ id: 'startup', label: 'Start-up', status: 'ok', detail: startup });

  if (deps.homeServerEnabled) {
    try {
      const { ms } = await timed(
        () => deps.fetchBytes(`${HOME_SERVER.relay}/${HOME_SERVER.topic}/json?poll=1&since=1m`, 64 * 1024),
        now,
      );
      checks.push({ id: 'relay', label: 'Address relay', status: 'ok', detail: `reachable (${ms} ms)` });
    } catch {
      checks.push({
        id: 'relay',
        label: 'Address relay',
        status: 'warn',
        detail: `${new URL(HOME_SERVER.relay).host} is not reachable`,
        advice:
          'River uses it to find its server when the server moves. A firewall, VPN or network filter may block it; River keeps working at the last known address.',
      });
    }
  }

  const account = deps.account();
  if (account.state !== 'registered' || !account.serverUrl) {
    checks.push({
      id: 'account',
      label: 'Account',
      status: 'warn',
      detail: 'not set up yet',
      advice:
        'Pick a username to create your account. If it stays stuck, the server may be offline right now.',
    });
  } else {
    checks.push({
      id: 'account',
      label: 'Account',
      status: 'ok',
      detail: account.username ? `@${account.username}` : 'created',
    });
    try {
      const { ms } = await timed(
        () => deps.fetchBytes(`${account.serverUrl}${API_PREFIX}/health`, 4096),
        now,
      );
      checks.push({
        id: 'server',
        label: 'Server',
        status: ms > 1500 ? 'warn' : 'ok',
        detail: `answers in ${ms} ms`,
        ...(ms > 1500 ? { advice: 'The server is slow to answer; calls may take longer to connect.' } : {}),
      });
    } catch {
      checks.push({
        id: 'server',
        label: 'Server',
        status: 'fail',
        detail: 'not reachable',
        advice:
          'The PC that hosts the server may be off or changing address. River reconnects by itself when it is back.',
      });
    }
  }

  const live = deps.connection();
  checks.push({
    id: 'live',
    label: 'Live connection',
    status: live === 'online' ? 'ok' : live === 'connecting' ? 'warn' : 'fail',
    detail: live === 'online' ? 'connected' : live,
    ...(live === 'online' ? {} : { advice: 'Messages and voice need it. River retries by itself.' }),
  });

  const host = deps.hosting();
  if (host.state !== 'off') {
    checks.push({
      id: 'hosting',
      label: 'Hosting on this PC',
      status: host.state === 'online' ? 'ok' : 'warn',
      detail: host.state === 'online' ? 'public address reachable' : host.state,
    });
  }
  return checks;
}

/** A plain-text report people can paste into a message. */
export function formatReport(checks: DiagnosticCheck[]): string {
  const mark = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL' } as const;
  return [
    'River connection check',
    ...checks.map((c) => `${mark[c.status]} ${c.label}: ${c.detail}${c.advice ? `\n     ${c.advice}` : ''}`),
  ].join('\n');
}
