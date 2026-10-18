// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityView, MemberView } from '../src/shared/ipc.ts';
import type { ConversationView } from '../src/shared/dm.ts';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { useDm } from '../src/renderer/src/dm/store.ts';
import { shareByKey, shareEqual } from '../src/renderer/src/structural.ts';

/**
 * Smooth lists with big accounts: main sends every community and every chat whole on each
 * change; unchanged parts keep their objects so memoised rows (members, chats) skip drawing.
 */

describe('structural sharing', () => {
  it('keeps every equal part and replaces only what changed', () => {
    const prev = { a: { x: 1, list: [{ id: 1 }, { id: 2 }] }, b: { y: 'same' } };
    const next = structuredClone(prev);
    expect(shareEqual(prev, next)).toBe(prev);
    next.a.list[1]!.id = 3;
    const out = shareEqual(prev, next);
    expect(out).toEqual(next);
    expect(out).not.toBe(prev);
    expect(out.b).toBe(prev.b);
    expect(out.a.list[0]).toBe(prev.a.list[0]);
    expect(out.a.list[1]).not.toBe(prev.a.list[1]);
  });

  it('notices added, removed and undefined keys, and longer or shorter arrays', () => {
    expect(shareEqual({ a: 1 }, { a: 1, b: undefined })).toEqual({ a: 1, b: undefined });
    expect(shareEqual({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
    expect(shareEqual([1, 2], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(shareEqual([1, 2, 3], [1, 2])).toEqual([1, 2]);
    expect(shareEqual(null, { a: 1 })).toEqual({ a: 1 });
  });

  it('shares items by key when a list is reordered', () => {
    const prev = [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ];
    const next = [
      { id: 'b', n: 2 },
      { id: 'a', n: 1 },
      { id: 'c', n: 3 },
    ];
    const out = shareByKey(prev, next, (x) => x.id);
    expect(out).toEqual(next);
    expect(out[0]).toBe(prev[1]);
    expect(out[1]).toBe(prev[0]);
    expect(shareByKey(prev, structuredClone(prev), (x) => x.id)).toBe(prev);
  });
});

const member = (i: number, online = false): MemberView =>
  ({ riverId: `m${i}`, name: `Member ${i}`, avatar: null, online, roles: [] }) as unknown as MemberView;

describe('stores keep unchanged rows', () => {
  beforeEach(() => {
    (window as unknown as { river: unknown }).river = {
      community: { action: vi.fn(), messages: vi.fn() },
      dm: { action: vi.fn() },
    };
  });

  it('a presence change in a community of 1000 gives one new member object', () => {
    const members = Array.from({ length: 1000 }, (_, i) => member(i));
    const view = { id: 'c', name: 'C', channels: [], roles: [], members } as unknown as CommunityView;
    const other = {
      id: 'd',
      name: 'D',
      channels: [],
      roles: [],
      members: [member(0)],
    } as unknown as CommunityView;
    useCommunity.setState({ communities: [], selectedCommunity: 'c', selectedChannel: null });
    useCommunity.getState().handle({ t: 'communities', communities: [view, other] });
    const before = useCommunity.getState().communities;

    const changed = structuredClone([view, other]);
    changed[0]!.members[500] = member(500, true);
    // Someone joined at the front: everyone else moves one place but keeps their object.
    changed[0]!.members.unshift(member(1000));
    useCommunity.getState().handle({ t: 'communities', communities: changed });
    const after = useCommunity.getState().communities;

    expect(after[1]).toBe(before[1]);
    expect(after[0]!.members[1]).toBe(before[0]!.members[0]);
    expect(after[0]!.members[501]).not.toBe(before[0]!.members[500]);
    expect(after[0]!.members[501]!.online).toBe(true);
    expect(after[0]!.members.filter((m, i) => m !== before[0]!.members[i - 1]).length).toBe(2);
    // The same list again changes nothing at all.
    useCommunity.getState().handle({ t: 'communities', communities: structuredClone(changed) });
    expect(useCommunity.getState().communities).toBe(after);
  });

  it('a new message in one chat keeps every other chat object', () => {
    const chat = (id: string, text: string): ConversationView =>
      ({
        riverId: id,
        kind: 'direct',
        name: id,
        last: { text, sentAt: '2026-01-01', mine: false },
        unread: 0,
      }) as unknown as ConversationView;
    const list = Array.from({ length: 300 }, (_, i) => chat(`p${i}`, 'hi'));
    useDm.setState({ conversations: [], loadedOnce: false });
    useDm.getState().handle({ t: 'conversations', conversations: list });
    const before = useDm.getState().conversations;
    const next = [chat('p7', 'new'), ...structuredClone(list).filter((c) => c.riverId !== 'p7')];
    useDm.getState().handle({ t: 'conversations', conversations: next });
    const after = useDm.getState().conversations;
    expect(after[0]!.last?.text).toBe('new');
    expect(after.filter((c) => !before.includes(c))).toEqual([after[0]]);
  });
});
