/**
 * Community insights (1.0.26), computed on the device from what you can
 * already see. Pure functions, shared by main (activity) and the renderer.
 */
export interface ActivitySummary {
  days: Array<{ date: string; count: number }>;
  channels: Array<{ channelId: string; count: number }>;
  people: Array<{ riverId: string; count: number }>;
  total: number;
  /** True when a channel had more history than River looked at. */
  partial: boolean;
}

const dayOf = (iso: string): string => iso.slice(0, 10);

/** Days from `from` (inclusive) to `to` (inclusive), YYYY-MM-DD, oldest first. */
export function dayRange(to: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--)
    out.push(new Date(to.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export function summarizeActivity(
  messages: Array<{ channelId: string; sender: string; sentAt: string }>,
  now: Date,
  days: number,
  partial = false,
): ActivitySummary {
  const range = dayRange(now, days);
  const since = range[0]!;
  const recent = messages.filter((m) => dayOf(m.sentAt) >= since);
  const count = <K extends string>(key: (m: (typeof recent)[number]) => K): Map<K, number> => {
    const map = new Map<K, number>();
    for (const m of recent) map.set(key(m), (map.get(key(m)) ?? 0) + 1);
    return map;
  };
  const byDay = count((m) => dayOf(m.sentAt));
  const byChannel = count((m) => m.channelId);
  const byPerson = count((m) => m.sender);
  const sorted = <K>(map: Map<K, number>) => [...map.entries()].sort((a, b) => b[1] - a[1]);
  return {
    days: range.map((date) => ({ date, count: byDay.get(date) ?? 0 })),
    channels: sorted(byChannel).map(([channelId, n]) => ({ channelId, count: n })),
    people: sorted(byPerson)
      .slice(0, 10)
      .map(([riverId, n]) => ({ riverId, count: n })),
    total: recent.length,
    partial,
  };
}

/** Members who joined in each of the last `weeks` weeks (from their join day), oldest first. */
export function joinsPerWeek(joinedOn: Array<string | undefined>, now: Date, weeks: number): number[] {
  const out = new Array<number>(weeks).fill(0);
  for (const d of joinedOn) {
    if (!d) continue;
    const ago = Math.floor((now.getTime() - Date.parse(`${d}T12:00:00Z`)) / (7 * 86_400_000));
    if (ago >= 0 && ago < weeks) out[weeks - 1 - ago]! += 1;
  }
  return out;
}
