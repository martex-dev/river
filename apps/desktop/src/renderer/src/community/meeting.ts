import { fill, msg, type Vars } from '../../../shared/i18n/index.ts';
/**
 * Meetings in voice channels (2.13): speaker view, raised hands in order,
 * who is talking, and what the call can honestly say about itself. Pure, so it
 * can be tested; the UI is ui/Meeting.tsx.
 */

export type MeetingView = 'grid' | 'speaker';

const VIEW_KEY = 'river.meetingView';

export function savedView(): MeetingView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'speaker' ? 'speaker' : 'grid';
  } catch {
    return 'grid';
  }
}

export function saveView(view: MeetingView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // not remembered
  }
}

/** A new speaker takes the big tile after talking this long (no flicker on a cough). */
export const SWITCH_AFTER_MS = 800;

/**
 * Who speaker view shows large. A shared screen wins; otherwise the person who
 * talked last, switching only once someone else has talked for a moment. Your
 * own tile is never chosen while others are there.
 */
export class ActiveSpeaker {
  private current: string | null = null;
  private readonly since = new Map<string, number>();

  update(input: {
    me: string;
    people: readonly string[];
    speaking: ReadonlySet<string>;
    sharing: readonly string[];
    /** Defaults to the clock (tests pass their own). */
    now?: number;
  }): string | null {
    const { me, people, speaking, sharing } = input;
    const now = input.now ?? Date.now();
    const others = people.filter((id) => id !== me);
    for (const id of [...this.since.keys()]) if (!speaking.has(id)) this.since.delete(id);
    for (const id of speaking) if (!this.since.has(id)) this.since.set(id, now);
    const screen = sharing.find((id) => people.includes(id));
    if (screen) return (this.current = screen);
    if (this.current && !people.includes(this.current)) this.current = null;
    if (this.current === me && others.length > 0) this.current = null;
    // Whoever has talked longest without a break, once past the switch delay.
    let best: string | null = null;
    let bestSince = Infinity;
    for (const [id, at] of this.since) {
      if (id === me || !others.includes(id) || now - at < SWITCH_AFTER_MS) continue;
      if (at < bestSince) {
        best = id;
        bestSince = at;
      }
    }
    if (best && !(this.current && speaking.has(this.current))) this.current = best;
    return (this.current ??= others[0] ?? (people.includes(me) ? me : null));
  }
}

/** Raised hands, first raised first. */
export function handQueue(
  hands: ReadonlyArray<{ id: string; hand?: number | null | undefined }>,
): Array<{ id: string; at: number }> {
  return hands
    .filter((h): h is { id: string; hand: number } => typeof h.hand === 'number' && h.hand > 0)
    .map((h) => ({ id: h.id, at: h.hand }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/** "Ana is talking", "Ana and Ben are talking", "Ana, Ben and 3 others are talking". */
export function talkingLine(
  names: readonly string[],
  t: Translate = fill,
  tn: (key: string, count: number, vars?: Vars) => string = (key, count, vars) =>
    fill(key, { count, ...vars }),
): string | null {
  if (names.length === 0) return null;
  const [a, b, c] = names as [string, string, string];
  if (names.length === 1) return t(msg('{name} is talking'), { name: a });
  if (names.length === 2) return t(msg('{a} and {b} are talking'), { a, b });
  if (names.length === 3) return t(msg('{a}, {b} and {c} are talking'), { a, b, c });
  return tn('{a}, {b} and {count} others are talking', names.length - 2, { a, b });
}

/**
 * How the call's media travels, for the channel header. Every path is end-to-end encrypted;
 * what differs is whether it goes directly between devices or through the server.
 */
export function encryptionNote(
  input: {
    inCall: boolean;
    others: number;
    relayed: number;
    large: boolean;
  },
  t: Translate = fill,
): string {
  const { inCall, others, relayed, large } = input;
  if (!inCall || others === 0) return t(msg('end-to-end encrypted'));
  if (large) return t(msg('large room: voice through your server, end-to-end encrypted'));
  if (relayed === 0) return t(msg('encrypted directly between devices (DTLS-SRTP)'));
  if (relayed === others) return t(msg('voice through your server, end-to-end encrypted'));
  return t(msg('end-to-end encrypted · {count} through your server'), { count: relayed });
}

type Translate = (text: string, vars?: Vars) => string;

/**
 * What "Voice connected" may honestly say. Direct voice keeps flowing while
 * our server connection is down, so the call is only "reconnecting" when the
 * server is unreachable and nobody's voice reaches us any more.
 */
export function callStatus(input: {
  server: 'online' | string;
  others: ReadonlyArray<{ state: string; relayed: boolean; relayFlowing: boolean; reconnecting: boolean }>;
}): 'connected' | 'reconnecting' {
  if (input.server === 'online') return 'connected';
  const heard = input.others.some((p) => p.state === 'connected' || (p.relayed && p.relayFlowing));
  return heard ? 'connected' : 'reconnecting';
}
