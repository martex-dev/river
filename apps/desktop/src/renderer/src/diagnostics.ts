import type { DiagnosticCheck } from '../../shared/ipc.ts';
import { tr } from './i18n.ts';

/**
 * Connection check, renderer half: what kind of network this is for calls,
 * and whether a microphone is there. Calls connect computers directly; some
 * networks (strict NAT, blocked UDP) only allow that through a relay.
 */

export interface GatheredCandidate {
  /** The candidate line, e.g. "candidate:1 1 udp 1686052607 203.0.113.5 50000 typ srflx raddr 10.0.0.2 rport 50000". */
  candidate: string;
  /** The STUN server that produced it (srflx only). */
  url?: string;
}

export type NatKind = 'open' | 'strict' | 'blocked' | 'unknown';

/**
 * Classifies the network from gathered ICE candidates:
 * - blocked: no public (srflx/relay) address at all — UDP is filtered;
 * - strict: the same local socket shows different public ports to different
 *   STUN servers (symmetric NAT) — direct calls fail with some people;
 * - open: one consistent public mapping.
 */
export function classifyNat(candidates: GatheredCandidate[]): { kind: NatKind; publicAddresses: number } {
  const srflx = candidates.flatMap((c) => {
    const parsed = parse(c.candidate);
    return parsed?.type === 'srflx' ? [parsed] : [];
  });
  if (candidates.length === 0) return { kind: 'unknown', publicAddresses: 0 };
  if (srflx.length === 0) return { kind: 'blocked', publicAddresses: 0 };
  const byBase = new Map<string, Set<string>>();
  for (const c of srflx) {
    const base = `${c.raddr}:${c.rport}`;
    const set = byBase.get(base) ?? new Set<string>();
    set.add(`${c.address}:${c.port}`);
    byBase.set(base, set);
  }
  const strict = [...byBase.values()].some((s) => s.size > 1);
  return { kind: strict ? 'strict' : 'open', publicAddresses: new Set(srflx.map((c) => c.address)).size };
}

function parse(
  line: string,
): { type: string; address: string; port: string; raddr?: string; rport?: string; protocol: string } | null {
  const parts = line.replace(/^a=/, '').split(' ');
  const typ = parts.indexOf('typ');
  if (typ < 0 || parts.length < 8) return null;
  const at = (key: string): string | undefined => {
    const i = parts.indexOf(key);
    return i >= 0 ? parts[i + 1] : undefined;
  };
  return {
    protocol: (parts[2] ?? '').toLowerCase(),
    address: parts[4] ?? '',
    port: parts[5] ?? '',
    type: parts[typ + 1] ?? '',
    ...(at('raddr') ? { raddr: at('raddr')! } : {}),
    ...(at('rport') ? { rport: at('rport')! } : {}),
  };
}

const STUN_SERVERS = ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'];

/** Gathers candidates against two STUN servers (separately, so mappings can be compared). */
export async function gatherCandidates(timeoutMs = 6000): Promise<GatheredCandidate[]> {
  const out: GatheredCandidate[] = [];
  const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS.map((urls) => ({ urls })) });
  try {
    pc.createDataChannel('probe');
    const done = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          clearTimeout(timer);
          resolve();
          return;
        }
        out.push({
          candidate: e.candidate.candidate,
          ...((e as RTCPeerConnectionIceEvent & { url?: string }).url
            ? { url: (e as RTCPeerConnectionIceEvent & { url?: string }).url! }
            : {}),
        });
      };
    });
    await pc.setLocalDescription(await pc.createOffer());
    await done;
  } finally {
    pc.close();
  }
  return out;
}

export async function runNetworkDiagnostics(turnAvailable: boolean): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];
  try {
    const { kind } = classifyNat(await gatherCandidates());
    const relay = turnAvailable
      ? tr('Your server offers a relay, so calls still connect.')
      : tr('Your server offers no relay, so calls with some people may not connect.');
    const label = tr('Network for calls');
    checks.push(
      kind === 'open'
        ? { id: 'network', label, status: 'ok', detail: tr('direct calls work') }
        : kind === 'strict'
          ? {
              id: 'network',
              label,
              status: turnAvailable ? 'ok' : 'warn',
              detail: tr('strict network (symmetric NAT)'),
              advice: `${tr('Direct calls fail with people on similar networks (mobile data, some routers).')} ${relay}`,
            }
          : kind === 'blocked'
            ? {
                id: 'network',
                label,
                status: turnAvailable ? 'warn' : 'fail',
                detail: tr('call traffic (UDP) is blocked'),
                advice: `${tr('A firewall, VPN or school/work network blocks calls.')} ${relay}`,
              }
            : { id: 'network', label, status: 'warn', detail: tr('could not be tested') },
    );
  } catch (err) {
    checks.push({
      id: 'network',
      label: tr('Network for calls'),
      status: 'warn',
      detail: tr('could not be tested ({reason})', { reason: (err as Error).message }),
    });
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === 'audioinput').length;
    const speakers = devices.filter((d) => d.kind === 'audiooutput').length;
    checks.push(
      mics > 0
        ? { id: 'mic', label: tr('Microphone'), status: 'ok', detail: tr('{count} found', { count: mics }) }
        : {
            id: 'mic',
            label: tr('Microphone'),
            status: 'fail',
            detail: tr('none found'),
            advice: tr('Plug one in, or allow microphone access for apps in your system privacy settings.'),
          },
    );
    checks.push({
      id: 'speakers',
      label: tr('Speakers'),
      status: 'ok',
      detail: speakers > 0 ? tr('{count} found', { count: speakers }) : tr('system default'),
    });
  } catch {
    checks.push({ id: 'mic', label: tr('Microphone'), status: 'warn', detail: tr('could not be checked') });
  }
  return checks;
}
