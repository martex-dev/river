import { fill, msg, type Vars } from '../../../shared/i18n/index.ts';
/**
 * Connection details for one person in a call (1.0.19): how the audio gets
 * there and how well. Pure, so it can be tested with plain stat objects.
 */
export interface LinkStats {
  path: 'direct' | 'relay-turn' | 'server' | 'connecting';
  /** Round-trip time in ms, if measured. */
  rttMs: number | null;
  /** Share of incoming audio packets lost since the last sample, 0–1. */
  loss: number | null;
}

type Stat = Record<string, unknown> & { type: string; id: string };

/** Reads a getStats() report (as plain objects) into LinkStats. `prev` gives packet counts for the loss rate. */
export function readLinkStats(
  report: Stat[],
  prev: { received: number; lost: number } | null,
): {
  stats: Omit<LinkStats, 'path'> & { candidateType: string | null };
  counts: { received: number; lost: number };
} {
  const byId = new Map(report.map((r) => [r.id, r]));
  const pair = report.find(
    (r) =>
      r.type === 'candidate-pair' &&
      (r.selected === true || (r.nominated === true && r.state === 'succeeded')),
  );
  const local = pair ? byId.get(String(pair.localCandidateId)) : undefined;
  const rtt =
    typeof pair?.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : null;
  const inbound = report.find((r) => r.type === 'inbound-rtp' && r.kind === 'audio');
  const received = typeof inbound?.packetsReceived === 'number' ? inbound.packetsReceived : 0;
  const lost = typeof inbound?.packetsLost === 'number' ? Math.max(0, inbound.packetsLost) : 0;
  let loss: number | null = null;
  if (prev) {
    const dr = received - prev.received;
    const dl = lost - prev.lost;
    if (dr + dl > 0) loss = Math.max(0, Math.min(1, dl / (dr + dl)));
  }
  return {
    stats: {
      rttMs: rtt,
      loss,
      candidateType: typeof local?.candidateType === 'string' ? local.candidateType : null,
    },
    counts: { received, lost },
  };
}

/** "Direct · 38 ms · 0% loss", "Via server", … for a tile's tooltip. */
export function describeLink(s: LinkStats, t: (text: string, vars?: Vars) => string = fill): string {
  if (s.path === 'connecting') return t(msg('Connecting…'));
  const parts = [
    s.path === 'server'
      ? t(msg('Via your server (encrypted)'))
      : s.path === 'relay-turn'
        ? t(msg('Via relay'))
        : t(msg('Direct')),
  ];
  if (s.rttMs !== null) parts.push(`${s.rttMs} ms`);
  if (s.loss !== null) parts.push(t(msg('{percent}% loss'), { percent: Math.round(s.loss * 100) }));
  return parts.join(' · ');
}

/** Good / fair / poor, for the little bars on a tile. */
export function linkQuality(s: LinkStats): 'good' | 'fair' | 'poor' | null {
  if (s.path === 'connecting' || s.path === 'server') return null;
  const rtt = s.rttMs ?? 0;
  const loss = s.loss ?? 0;
  if (rtt > 400 || loss > 0.1) return 'poor';
  if (rtt > 200 || loss > 0.03) return 'fair';
  return 'good';
}
