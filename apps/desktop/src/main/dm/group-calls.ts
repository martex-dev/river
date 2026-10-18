import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { callLink } from '../../shared/invite-link.ts';
import { MAX_GROUP_CALL, type CallLinkView, type DmEvent, type RingingGroup } from '../../shared/dm.ts';

/**
 * Group calls and call links (2.18), the part that lives in the main process: what travels
 * inside libsignal messages, who may take part in which call, rings, and the "Ask to join"
 * flow of call links.
 *
 * - A group call is announced to the group's other members with a `gcall` ring. Its call ID is a
 *   random secret: the call's relay room on the server is a hash of it, so only people who got
 *   the ring (inside end-to-end encrypted messages) can find the room.
 * - Connection setup between two people in a call (`gcall` signal) is accepted only from people
 *   who may take part: current members of the group, or — for a call link — its host and the
 *   people the host let in. Nobody else can make this device send them anything.
 * - A call link carries the host's River ID and a separate random link ID, never the call ID.
 *   Someone with the link asks to join (`clink` knock); only when the host lets them in does
 *   the host send them the call ID (`clink` admit), and tell the people already in the call
 *   (`gcall` allow) that they may connect with them.
 */

const msgId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

/** A ring rings this long (the same as a 1:1 invite). */
export const GROUP_RING_MS = 45_000;
/** A call link works this long after it was made. */
export const CALL_LINK_TTL_MS = 7 * 86_400_000;
/** Call links one account keeps at most. */
export const MAX_CALL_LINKS = 20;
/** People asking to join one person's call links at once (more are not shown). */
export const MAX_KNOCKS = 20;
/** Waiting to be let in ends after this long without an answer. */
export const KNOCK_WAIT_MS = 2 * 60_000;
/** A call heard of (a ring) is remembered this long, for its signals and its "Join" bar. */
const CALL_MEMORY_MS = 12 * 3_600_000;

/** `gcall`: a group call or a call-link call. Unknown to River before 2.18 (it drops it). */
export const gcallContent = z.object({
  v: z.literal(1),
  t: z.literal('gcall'),
  callId: msgId,
  /** A call in this group; absent: a call-link call. */
  groupId: msgId.optional(),
  kind: z.enum(['ring', 'decline', 'signal', 'allow']),
  video: z.boolean().optional(),
  /** WebRTC connection setup (signal). */
  data: z.unknown().optional(),
  /** allow: everyone the host let into a call-link call, the host included. */
  allowed: z.array(z.uuid()).max(MAX_GROUP_CALL).optional(),
});

/** `clink`: asking to join through a call link, and the host's answer. */
export const clinkContent = z.object({
  v: z.literal(1),
  t: z.literal('clink'),
  link: msgId,
  kind: z.enum(['knock', 'admit', 'deny', 'gone']),
  /** knock: the name the person asking gives (shown as theirs, not checked). */
  name: z.string().max(64).optional(),
  /** admit: the call's secret ID, whether it is a video call, its name, and who is let in. */
  callId: msgId.optional(),
  video: z.boolean().optional(),
  title: z.string().max(64).nullable().optional(),
  allowed: z.array(z.uuid()).max(MAX_GROUP_CALL).optional(),
});

type GcallContent = z.infer<typeof gcallContent>;
type ClinkContent = z.infer<typeof clinkContent>;

interface StoredLink {
  id: string;
  callId: string;
  video: boolean;
  title: string | null;
  createdAt: string;
  expiresAt: string;
  admitted: string[];
}

const storedLinks = z.array(
  z.object({
    id: msgId,
    callId: msgId,
    video: z.boolean(),
    title: z.string().max(64).nullable(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    admitted: z.array(z.uuid()).max(MAX_GROUP_CALL),
  }),
);

export interface GroupCallDeps {
  me(): string;
  /** A group this device is in (accepted, not left), with its current members; else undefined. */
  group(id: string): { name: string; members: string[] } | undefined;
  send(peer: string, content: GcallContent | ClinkContent): Promise<void>;
  /** Tells this account's other devices that a ring was answered or declined here. */
  handled(conv: string, callId: string): void;
  emit(e: DmEvent): void;
  /** Rings for an incoming call (unless something rings already or this device is in a call). */
  /**
   * Rings for an incoming call: `rang`, `already` (this call rings already), or `busy` (another
   * call rings here).
   */
  ring(event: Extract<DmEvent, { t: 'call' }>): 'rang' | 'already' | 'busy';
  /** Stops it ringing here; false if it was not ringing. */
  endRinging(callId: string, how: 'answered' | 'declined' | 'ended'): boolean;
  /** In a 1:1 call right now. */
  inDirectCall(): boolean;
  meta(key: string): string | null;
  setMeta(key: string, value: string): void;
  /** The address for links other people open. */
  shareUrl(): string;
  isFriend(riverId: string): boolean;
  myName(): string | null;
  warn(message: string): void;
}

export class GroupCalls {
  private readonly deps: GroupCallDeps;
  /** Group calls this device heard of (rang, or started), by call ID. */
  private readonly groupOf = new Map<string, { groupId: string; at: number }>();
  /** Call-link calls of other people this device was let into, by call ID. */
  private readonly linkCalls = new Map<
    string,
    { host: string; link: string; allowed: Set<string>; video: boolean; title: string | null; at: number }
  >();
  /** Links we asked to join and wait on: link ID → host. */
  private readonly knocking = new Map<string, { host: string; at: number }>();
  /** People asking to join our call links, by `${link}:${person}`. */
  private readonly knocks = new Map<string, { link: string; from: string; at: number }>();
  /** The group or call-link call this device is in. */
  private own: { callId: string } | null = null;

  constructor(deps: GroupCallDeps) {
    this.deps = deps;
  }

  /** The group or call-link call this device is in (for quitting: nothing to tell, the room is left). */
  current(): string | null {
    return this.own?.callId ?? null;
  }

  // ---- who may take part -------------------------------------------------------------------------

  private forgetOld(): void {
    const now = Date.now();
    for (const [id, c] of this.groupOf) if (now - c.at > CALL_MEMORY_MS) this.groupOf.delete(id);
    for (const [id, c] of this.linkCalls) if (now - c.at > CALL_MEMORY_MS) this.linkCalls.delete(id);
    for (const [id, k] of this.knocking) if (now - k.at > KNOCK_WAIT_MS) this.knocking.delete(id);
    for (const [id, k] of this.knocks) if (now - k.at > KNOCK_WAIT_MS) this.knocks.delete(id);
  }

  /** Everyone who may be in the call (you included), or null for a call this device does not know. */
  allowed(callId: string): string[] | null {
    const me = this.deps.me();
    const g = this.groupOf.get(callId);
    if (g) {
      const group = this.deps.group(g.groupId);
      return group ? [...new Set([...group.members, me])] : null;
    }
    const mine = this.links().find((l) => l.callId === callId);
    if (mine) return [me, ...mine.admitted.filter((id) => id !== me)];
    const theirs = this.linkCalls.get(callId);
    if (theirs) return [...new Set([theirs.host, ...theirs.allowed, me])];
    return null;
  }

  /** A call-link call (ours, or one we were let into): never also a group's call. */
  private isLinkCall(callId: string): boolean {
    return this.linkCalls.has(callId) || this.links().some((l) => l.callId === callId);
  }

  private mayTakePart(callId: string, riverId: string): boolean {
    if (riverId === this.deps.me()) return false;
    return this.allowed(callId)?.includes(riverId) ?? false;
  }

  // ---- call links --------------------------------------------------------------------------------

  private links(): StoredLink[] {
    try {
      const raw = this.deps.meta('callLinks');
      const now = Date.now();
      return raw ? storedLinks.parse(JSON.parse(raw)).filter((l) => Date.parse(l.expiresAt) > now) : [];
    } catch {
      return [];
    }
  }

  private saveLinks(links: StoredLink[]): void {
    this.deps.setMeta('callLinks', JSON.stringify(links));
  }

  private view(l: StoredLink): CallLinkView {
    return { ...l, url: callLink(this.deps.shareUrl(), this.deps.me(), l.id) };
  }

  createLink(video: boolean, title: string | null): CallLinkView {
    const now = Date.now();
    const link: StoredLink = {
      id: randomBytes(16).toString('base64url'),
      callId: randomBytes(16).toString('base64url'),
      video,
      title,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CALL_LINK_TTL_MS).toISOString(),
      admitted: [],
    };
    // The oldest links go first when there are too many.
    this.saveLinks([...this.links(), link].slice(-MAX_CALL_LINKS));
    return this.view(link);
  }

  listLinks(): CallLinkView[] {
    return this.links()
      .reverse()
      .map((l) => this.view(l));
  }

  revokeLink(id: string): void {
    this.saveLinks(this.links().filter((l) => l.id !== id));
    for (const [key, k] of this.knocks) if (k.link === id) this.knocks.delete(key);
  }

  async knock(host: string, link: string): Promise<void> {
    if (host === this.deps.me()) throw new Error('That is your own call link.');
    this.forgetOld();
    this.knocking.set(link, { host, at: Date.now() });
    const name = this.deps.myName();
    await this.deps.send(host, { v: 1, t: 'clink', link, kind: 'knock', ...(name ? { name } : {}) });
  }

  cancelKnock(link: string): void {
    this.knocking.delete(link);
  }

  /** Host: lets someone who asked into the link's call, or says no. */
  async answerKnock(linkId: string, who: string, admit: boolean): Promise<void> {
    const key = `${linkId}:${who}`;
    if (!this.knocks.has(key)) throw new Error('They are no longer asking to join.');
    this.knocks.delete(key);
    const links = this.links();
    const link = links.find((l) => l.id === linkId);
    if (!link) {
      await this.deps.send(who, { v: 1, t: 'clink', link: linkId, kind: 'gone' });
      return;
    }
    if (!admit) {
      await this.deps.send(who, { v: 1, t: 'clink', link: linkId, kind: 'deny' });
      return;
    }
    if (!link.admitted.includes(who)) {
      if (link.admitted.length >= MAX_GROUP_CALL - 1) throw new Error('The call is full.');
      link.admitted.push(who);
      this.saveLinks(links);
    }
    const me = this.deps.me();
    const allowed = [me, ...link.admitted];
    this.deps.emit({ t: 'gcall', kind: 'allow', callId: link.callId, from: me, allowed });
    await this.deps.send(who, {
      v: 1,
      t: 'clink',
      link: linkId,
      kind: 'admit',
      callId: link.callId,
      video: link.video,
      title: link.title,
      allowed,
    });
    // Everyone let in before may now connect with the newcomer (and the newcomer with them).
    for (const other of link.admitted) {
      if (other === who) continue;
      await this.deps
        .send(other, { v: 1, t: 'gcall', callId: link.callId, kind: 'allow', allowed })
        .catch((err: unknown) => this.deps.warn(`Call update not sent: ${(err as Error).message}`));
    }
  }

  // ---- actions from the window -------------------------------------------------------------------

  async act(act: {
    kind: 'ring' | 'join' | 'leave' | 'decline' | 'signal';
    callId: string;
    groupId?: string | undefined;
    to?: string[] | undefined;
    video?: boolean | undefined;
    data?: unknown;
  }): Promise<{ allowed: string[] } | null> {
    this.forgetOld();
    const me = this.deps.me();
    if (act.groupId) {
      const group = this.deps.group(act.groupId);
      if (!group || !group.members.includes(me)) throw new Error('You are not in this group.');
      const known = this.groupOf.get(act.callId);
      if (known && known.groupId !== act.groupId) throw new Error('That call is in another group.');
      // A call-link call stays with the people its host let in.
      if (!known && this.isLinkCall(act.callId)) throw new Error('That call is not in this group.');
      // Starting a call (ring) makes it known; joining one needs its ring first.
      if (!known && act.kind !== 'ring') throw new Error('That call is over.');
      this.groupOf.set(act.callId, { groupId: act.groupId, at: known?.at ?? Date.now() });
    }
    const allowed = this.allowed(act.callId);
    if (!allowed) throw new Error('That call is over.');
    switch (act.kind) {
      case 'ring': {
        if (!act.groupId) throw new Error('Only a group call rings its members.');
        this.own = { callId: act.callId };
        const to = (act.to ?? allowed).filter((id) => id !== me && allowed.includes(id));
        for (const peer of to) {
          // Live only, like a 1:1 invite: a ring must never ring hours later.
          await this.deps
            .send(peer, {
              v: 1,
              t: 'gcall',
              callId: act.callId,
              groupId: act.groupId,
              kind: 'ring',
              video: act.video ?? false,
            })
            .catch((err: unknown) => this.deps.warn(`Group call ring not sent: ${(err as Error).message}`));
        }
        return { allowed };
      }
      case 'join':
        this.own = { callId: act.callId };
        // Answered here: it stops ringing here and on this account's other devices.
        if (this.deps.endRinging(act.callId, 'answered')) this.deps.handled(act.groupId ?? me, act.callId);
        return { allowed };
      case 'leave':
        if (this.own?.callId === act.callId) this.own = null;
        return null;
      case 'decline': {
        this.deps.endRinging(act.callId, 'declined');
        // Declined here: this account's other devices stop ringing for it too.
        this.deps.handled(act.groupId ?? me, act.callId);
        const to = (act.to ?? []).filter((id) => this.mayTakePart(act.callId, id));
        for (const peer of to)
          await this.deps
            .send(peer, {
              v: 1,
              t: 'gcall',
              callId: act.callId,
              ...(act.groupId ? { groupId: act.groupId } : {}),
              kind: 'decline',
            })
            .catch(() => undefined);
        return null;
      }
      case 'signal': {
        if (this.own?.callId !== act.callId) throw new Error('You are not in that call.');
        const to = act.to ?? [];
        if (to.length !== 1 || !this.mayTakePart(act.callId, to[0]!))
          throw new Error('They are not in that call.');
        if (act.data === undefined || JSON.stringify(act.data).length > 30_000)
          throw new Error('Signal too large');
        await this.deps.send(to[0]!, {
          v: 1,
          t: 'gcall',
          callId: act.callId,
          ...(act.groupId ? { groupId: act.groupId } : {}),
          kind: 'signal',
          data: act.data,
        });
        return null;
      }
    }
  }

  // ---- received ---------------------------------------------------------------------------------

  /**
   * A `gcall` or `clink` from `peer` (already decrypted; blocked people never get here).
   * `age`: how long ago this device decrypted it (a ring kept while River was locked is over).
   */
  receive(peer: string, content: GcallContent | ClinkContent, age: number): void {
    this.forgetOld();
    if (content.t === 'clink') {
      this.receiveLink(peer, content);
      return;
    }
    const me = this.deps.me();
    if (content.groupId) {
      const group = this.deps.group(content.groupId);
      // Only current members of a group we are in.
      if (!group || !group.members.includes(peer) || !group.members.includes(me)) return;
      const known = this.groupOf.get(content.callId);
      if (known && known.groupId !== content.groupId) return;
      // A ring naming a call-link call's ID would otherwise let the whole group into that call.
      if (!known && this.isLinkCall(content.callId)) return;
      if (content.kind === 'ring') {
        if (age > GROUP_RING_MS) return;
        this.groupOf.set(content.callId, { groupId: content.groupId, at: known?.at ?? Date.now() });
        const video = content.video ?? false;
        // Already in this call here: nothing rings.
        if (this.own?.callId === content.callId) return;
        if (this.own || this.deps.inDirectCall()) {
          // In another call: no ringing over it; the group shows "Join" instead.
          this.deps.emit({
            t: 'gcall',
            kind: 'ongoing',
            callId: content.callId,
            from: peer,
            groupId: content.groupId,
            video,
          });
          return;
        }
        const ringing: RingingGroup = { id: content.groupId, name: group.name, people: group.members.length };
        const rang = this.deps.ring({
          t: 'call',
          peer,
          callId: content.callId,
          kind: 'invite',
          video,
          group: ringing,
        });
        // Another call rings here: this one shows in its group ("Join") instead.
        if (rang === 'busy')
          this.deps.emit({
            t: 'gcall',
            kind: 'ongoing',
            callId: content.callId,
            from: peer,
            groupId: content.groupId,
            video,
          });
        return;
      }
      if (!known) return;
    } else if (!this.linkCalls.has(content.callId) && !this.links().some((l) => l.callId === content.callId))
      return;
    if (!this.mayTakePart(content.callId, peer)) return;
    switch (content.kind) {
      case 'ring':
        return;
      case 'decline':
        this.deps.emit({
          t: 'gcall',
          kind: 'decline',
          callId: content.callId,
          from: peer,
          ...(content.groupId ? { groupId: content.groupId } : {}),
        });
        return;
      case 'signal':
        // Connection setup only for the call this device is in.
        if (this.own?.callId !== content.callId || content.data === undefined) return;
        if (JSON.stringify(content.data).length > 30_000) return;
        this.deps.emit({
          t: 'gcall',
          kind: 'signal',
          callId: content.callId,
          from: peer,
          ...(content.groupId ? { groupId: content.groupId } : {}),
          data: content.data,
        });
        return;
      case 'allow': {
        // Only the host of a call-link call says who may be in it.
        const call = this.linkCalls.get(content.callId);
        if (!call || call.host !== peer || !content.allowed) return;
        call.allowed = new Set(content.allowed);
        this.deps.emit({
          t: 'gcall',
          kind: 'allow',
          callId: content.callId,
          from: peer,
          host: peer,
          allowed: this.allowed(content.callId) ?? [],
        });
        return;
      }
    }
  }

  private receiveLink(peer: string, content: ClinkContent): void {
    if (content.kind === 'knock') {
      const link = this.links().find((l) => l.id === content.link);
      if (!link) {
        void this.deps
          .send(peer, { v: 1, t: 'clink', link: content.link, kind: 'gone' })
          .catch(() => undefined);
        return;
      }
      const key = `${content.link}:${peer}`;
      // Asking again while asking, or too many people asking at once: shown once / not shown.
      if (this.knocks.has(key) || this.knocks.size >= MAX_KNOCKS) return;
      this.knocks.set(key, { link: content.link, from: peer, at: Date.now() });
      const name = (content.name ?? '').trim().slice(0, 64) || `River ${peer.slice(0, 8)}`;
      this.deps.emit({ t: 'knock', link: content.link, from: peer, name, contact: this.deps.isFriend(peer) });
      return;
    }
    // Answers count only from the host we asked, for the link we asked about.
    const asked = this.knocking.get(content.link);
    if (!asked || asked.host !== peer) return;
    this.knocking.delete(content.link);
    if (content.kind === 'admit') {
      if (!content.callId) return;
      const allowed = new Set((content.allowed ?? []).filter((id) => id !== this.deps.me()));
      allowed.add(peer);
      this.linkCalls.set(content.callId, {
        host: peer,
        link: content.link,
        allowed,
        video: content.video ?? false,
        title: content.title ?? null,
        at: Date.now(),
      });
      this.deps.emit({
        t: 'gcall',
        kind: 'admitted',
        callId: content.callId,
        from: peer,
        host: peer,
        video: content.video ?? false,
        title: content.title ?? null,
        allowed: this.allowed(content.callId) ?? [],
      });
      return;
    }
    this.deps.emit({ t: 'knockAnswer', link: content.link, host: peer, answer: content.kind });
  }
}
