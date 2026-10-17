/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission } from '@river/protocol/permissions';
import type { ChannelView, ChatMessage, CommunityView } from '../src/shared/ipc.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import { effectiveNotify, shouldAlert } from '../src/shared/notify-rules.ts';
import { roleOrderChanges } from '../src/shared/role-order.ts';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { useRiver } from '../src/renderer/src/store.ts';
import { replaceCustomShortcodes, replaceShortcodes } from '../src/renderer/src/community/emoji-data.ts';
import { canOpenCommunitySettings } from '../src/renderer/src/community/settings-tabs.ts';
import { ForumChannel, forumJumpTarget } from '../src/renderer/src/community/ui/Forum.tsx';
import { ThreadPanel } from '../src/renderer/src/community/ui/Thread.tsx';
import { PermissionEditor, mayAllow } from '../src/renderer/src/community/ui/PermissionEditor.tsx';
import { WebhooksPanel } from '../src/renderer/src/community/ui/Webhooks.tsx';
import { RulesGate } from '../src/renderer/src/community/ui/Onboarding.tsx';
import { showLayout } from '../src/renderer/src/community/ui/ChannelList.tsx';
import { sidebarGroups, moveChannel } from '../src/shared/layout.ts';
import { setFollowing } from '../src/renderer/src/community/thread-follow.ts';

/** Regression tests for the community management audit (2.10.13). */

const ALL = 0xffffff;
const msg = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({
    id,
    communityId: 'c',
    channelId: 'ch',
    sender: 'x',
    senderName: 'X',
    text: id,
    sentAt: '2026-10-16T10:00:00.000Z',
    reactions: [],
    attachments: [],
    mentionsMe: false,
    mine: false,
    pinned: false,
    threadId: null,
    thread: null,
    ...extra,
  }) as unknown as ChatMessage;

const channel = (id: string, extra: Partial<ChannelView> = {}): ChannelView =>
  ({
    id,
    kind: 'text',
    name: id,
    topic: '',
    position: 0,
    parentId: null,
    permissions: ALL,
    overwrites: [],
    synced: false,
    forum: false,
    tags: [],
    ...extra,
  }) as unknown as ChannelView;

const community = (extra: Partial<CommunityView> = {}): CommunityView =>
  ({
    id: 'c',
    name: 'Club',
    ownerId: 'owner',
    permissions: ALL,
    myRank: Infinity,
    roles: [{ id: 'c', name: '@everyone', color: 0, permissions: 0, position: 0, everyone: true }],
    categories: [],
    channels: [channel('ch')],
    members: [{ riverId: 'me', name: 'Me', roles: [] }],
    voice: {},
    rules: [],
    selfRoles: [],
    webhooks: [],
    ...extra,
  }) as unknown as CommunityView;

const action = vi.fn();
beforeEach(() => {
  action.mockReset();
  action.mockResolvedValue({ ok: true, value: null });
  localStorage.clear();
  (window as unknown as { river: unknown }).river = {
    community: { action, messages: vi.fn().mockResolvedValue({ ok: true, value: [] }) },
  };
  useCommunity.setState({
    communities: [],
    messages: {},
    threads: {},
    unread: {},
    mentions: {},
    openThread: null,
    pendingJump: null,
    modal: null,
    selectedCommunity: null,
    selectedChannel: null,
  });
});
afterEach(cleanup);

describe('forum posts and threads', () => {
  it('opening a post loads its replies, and live replies then arrive', async () => {
    const c = community({ channels: [channel('ch', { forum: true })] });
    const post = msg('p1', {
      thread: { name: 'Hello', count: 0, lastAt: null, archived: false, creator: 'x' },
    });
    useCommunity.setState({ communities: [c], messages: { ch: [post] } });
    action.mockResolvedValue({ ok: true, value: [msg('r1', { threadId: 'p1' })] });
    render(<ForumChannel community={c} channel={c.channels[0]!} />);
    await act(async () => fireEvent.click(screen.getByText('Hello')));
    expect(action).toHaveBeenCalledWith({ a: 'threadMessages', channelId: 'ch', messageId: 'p1' });
    expect(useCommunity.getState().openThread).toEqual({ channelId: 'ch', rootId: 'p1' });
    expect(useCommunity.getState().threads.p1!.map((m) => m.id)).toEqual(['r1']);
    useCommunity
      .getState()
      .handle({ t: 'message', isNew: true, message: msg('r2', { threadId: 'p1' }) } as never);
    expect(useCommunity.getState().threads.p1!.map((m) => m.id)).toEqual(['r1', 'r2']);
  });

  it('a message link to a forum post opens the post', async () => {
    const c = community({ channels: [channel('ch', { forum: true })] });
    useCommunity.setState({
      communities: [c],
      messages: { ch: [msg('p1')] },
      pendingJump: { channelId: 'ch', messageId: 'p1' },
    });
    action.mockResolvedValue({ ok: true, value: [] });
    await act(async () => {
      render(<ForumChannel community={c} channel={c.channels[0]!} />);
    });
    expect(useCommunity.getState().openThread).toEqual({ channelId: 'ch', rootId: 'p1' });
    expect(useCommunity.getState().pendingJump).toBeNull();
    expect(forumJumpTarget([msg('p1')], { p1: [msg('r9', { threadId: 'p1' })] }, 'r9')).toBe('p1');
    expect(forumJumpTarget([msg('p1')], {}, 'nope')).toBeNull();
  });

  it('a thread panel opened without its replies fetches them', async () => {
    const c = community();
    useCommunity.setState({ communities: [c], messages: { ch: [msg('root')] } });
    action.mockResolvedValue({ ok: true, value: [msg('r1', { threadId: 'root' })] });
    await act(async () => {
      render(<ThreadPanel community={c} channel={c.channels[0]!} rootId="root" me="me" />);
    });
    expect(action).toHaveBeenCalledWith({ a: 'threadMessages', channelId: 'ch', messageId: 'root' });
    expect(screen.getByText('1 reply')).toBeTruthy();
  });

  it('an archived thread takes Manage messages to reply in, not Manage channels', () => {
    const perms = Permission.VIEW_CHANNELS | Permission.SEND_MESSAGES | Permission.MANAGE_CHANNELS;
    const c = community({ channels: [channel('ch', { permissions: perms })] });
    const root = msg('root', { thread: { name: 'T', count: 0, lastAt: null, archived: true, creator: 'x' } });
    useCommunity.setState({ communities: [c], messages: { ch: [root] }, threads: { root: [] } });
    render(<ThreadPanel community={c} channel={c.channels[0]!} rootId="root" me="me" />);
    expect(screen.queryByLabelText('Reply in thread')).toBeNull();
    expect(screen.getByText('This thread is archived.')).toBeTruthy();
  });

  it('the Follow button follows the thread when it is followed elsewhere (after replying)', () => {
    const c = community();
    useCommunity.setState({ communities: [c], messages: { ch: [msg('root')] }, threads: { root: [] } });
    render(<ThreadPanel community={c} channel={c.channels[0]!} rootId="root" me="me" />);
    expect(screen.getByRole('button', { name: 'Follow' })).toBeTruthy();
    act(() => setFollowing('root', true));
    expect(screen.getByRole('button', { name: 'Following' })).toBeTruthy();
  });
});

describe('switching communities', () => {
  it('marks the channel you leave as read', () => {
    const a = community({ id: 'a', channels: [channel('a1')] });
    const b = community({ id: 'b', channels: [channel('b1')] });
    useCommunity.setState({ communities: [a, b], selectedCommunity: 'a', selectedChannel: 'a1' });
    useCommunity.getState().select('b');
    expect(action).toHaveBeenCalledWith({ a: 'markRead', channelId: 'a1' });
    expect(useCommunity.getState().selectedChannel).toBe('b1');
  });
});

describe('notification levels', () => {
  const prefs = (
    overrides: Record<
      string,
      { level: 'default' | 'all' | 'mentions' | 'nothing'; muteUntil: string | null }
    >,
  ) => ({
    ...DEFAULT_SETTINGS.notifications,
    overrides,
  });

  it('a category level sits between the channel and the community', () => {
    const p = prefs({ cat: { level: 'nothing', muteUntil: null }, co: { level: 'all', muteUntil: null } });
    expect(effectiveNotify(p, 'co', 'ch', Date.now(), 'cat').level).toBe('nothing');
    expect(effectiveNotify(p, 'co', 'ch', Date.now(), null).level).toBe('all');
    const own = prefs({
      cat: { level: 'nothing', muteUntil: null },
      ch: { level: 'mentions', muteUntil: null },
    });
    expect(effectiveNotify(own, 'co', 'ch', Date.now(), 'cat').level).toBe('mentions');
    const muted = prefs({ cat: { level: 'default', muteUntil: '9999-12-31T00:00:00.000Z' } });
    expect(shouldAlert(effectiveNotify(muted, 'co', 'ch', Date.now(), 'cat'), false)).toBe(false);
  });

  it('no mention badge or mention sound where the level is Nothing', () => {
    const c = community({ channels: [channel('ch', { parentId: 'cat' })] });
    useCommunity.setState({ communities: [c] });
    useRiver.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        notifications: {
          ...DEFAULT_SETTINGS.notifications,
          overrides: { cat: { level: 'nothing', muteUntil: null } },
        },
      },
    } as never);
    useCommunity
      .getState()
      .handle({ t: 'message', isNew: true, message: msg('m1', { mentionsMe: true }) } as never);
    expect(useCommunity.getState().unread.ch).toBe(1);
    expect(useCommunity.getState().mentions.ch).toBeUndefined();
    useRiver.setState({ settings: { ...DEFAULT_SETTINGS } } as never);
    useCommunity
      .getState()
      .handle({ t: 'message', isNew: true, message: msg('m2', { mentionsMe: true }) } as never);
    expect(useCommunity.getState().mentions.ch).toBe(1);
    useRiver.setState({ settings: null } as never);
  });
});

describe('role order', () => {
  const roles = [
    { id: 'top', position: 5 },
    { id: 'mine', position: 4 },
    { id: 'a', position: 3 },
    { id: 'b', position: 2 },
    { id: 'c', position: 1 },
  ];
  it('only moves roles below yours, reusing their positions', () => {
    expect(roleOrderChanges(roles, 4, { roleId: 'b', direction: 1 })).toEqual([
      { id: 'b', position: 3 },
      { id: 'a', position: 2 },
    ]);
    // Cannot pass your own role.
    expect(roleOrderChanges(roles, 4, { roleId: 'a', direction: 1 })).toEqual([]);
    expect(roleOrderChanges(roles, 4, { roleId: 'mine', direction: -1 })).toEqual([]);
    // "Above the top role" lands as high as you may put it.
    expect(roleOrderChanges(roles, 4, { roleId: 'c', aboveId: 'top' })).toEqual([
      { id: 'c', position: 3 },
      { id: 'a', position: 2 },
      { id: 'b', position: 1 },
    ]);
    expect(roleOrderChanges(roles, 4, { roleId: 'a', aboveId: null })).toEqual([
      { id: 'b', position: 3 },
      { id: 'c', position: 2 },
      { id: 'a', position: 1 },
    ]);
  });
  it('numbers shared positions 1..n when they fit below you', () => {
    const dup = [
      { id: 'x', position: 2 },
      { id: 'y', position: 2 },
    ];
    const out = roleOrderChanges(dup, Infinity, { roleId: 'y', direction: 1 });
    expect(new Set(out.map((r) => r.position)).size).toBe(out.length);
  });
});

describe('emoji shortcodes', () => {
  it('converts after text that merely starts with < or a stray backtick', () => {
    const parrot = { id: 'P'.repeat(22), name: 'party' };
    expect(replaceCustomShortcodes('<3 :party:', [parrot])).toBe(`<3 <:party:${parrot.id}>`);
    expect(replaceCustomShortcodes('`x :party:', [parrot])).toBe(`\`x <:party:${parrot.id}>`);
    expect(replaceCustomShortcodes('`:party:`', [parrot])).toBe('`:party:`');
    const index = { all: [{ emoji: '😄', shortcodes: ['smile'] }] } as never;
    expect(replaceShortcodes('`oops :smile:', index)).toBe('`oops 😄');
  });
});

describe('community settings', () => {
  it('is offered for every settings tab, Webhooks and Reports included', () => {
    expect(canOpenCommunitySettings(Permission.MANAGE_CHANNELS)).toBe(true);
    expect(canOpenCommunitySettings(Permission.MANAGE_MESSAGES)).toBe(true);
    expect(canOpenCommunitySettings(Permission.VIEW_AUDIT_LOG)).toBe(true);
    expect(canOpenCommunitySettings(Permission.SEND_MESSAGES | Permission.VIEW_CHANNELS)).toBe(false);
  });

  it('the permission editor only offers Allow on what you hold (or what was already allowed)', () => {
    const saved = [{ roleId: 'c', allow: Permission.BAN_MEMBERS, deny: 0 }];
    expect(mayAllow(Permission.SEND_MESSAGES, saved, 'c', Permission.SEND_MESSAGES)).toBe(true);
    expect(mayAllow(Permission.SEND_MESSAGES, saved, 'c', Permission.BAN_MEMBERS)).toBe(true);
    expect(mayAllow(Permission.SEND_MESSAGES, saved, 'c', Permission.KICK_MEMBERS)).toBe(false);
    render(
      <PermissionEditor
        community={community()}
        overwrites={[]}
        bits={[Permission.SEND_MESSAGES, Permission.KICK_MEMBERS]}
        mine={Permission.SEND_MESSAGES}
        saved={[]}
        onChange={() => undefined}
      />,
    );
    const allows = screen.getAllByRole('radio', { name: 'Allow' }) as HTMLButtonElement[];
    expect(allows.map((b) => b.disabled)).toEqual([false, true]);
  });

  it('webhooks: only channels you manage, and deleting asks first', () => {
    const c = community({
      channels: [channel('mine'), channel('theirs', { permissions: Permission.VIEW_CHANNELS })],
      webhooks: [
        {
          id: 'w1',
          name: 'Bot',
          channelId: 'mine',
          createdBy: 'me',
          createdAt: '2026-10-01T00:00:00Z',
          revoked: false,
        },
        {
          id: 'w2',
          name: 'Other',
          channelId: 'theirs',
          createdBy: 'me',
          createdAt: '2026-10-01T00:00:00Z',
          revoked: false,
        },
      ],
    } as never);
    render(<WebhooksPanel community={c} />);
    const options = [...screen.getByRole('combobox', { name: 'Channel' }).querySelectorAll('option')];
    expect(options.map((o) => o.value)).toEqual(['mine']);
    const deletes = screen.getAllByRole('button', { name: 'Delete' });
    expect(deletes).toHaveLength(1);
    fireEvent.click(deletes[0]!);
    expect(action).not.toHaveBeenCalled();
    expect(useCommunity.getState().modal).toMatchObject({ kind: 'confirm', action: 'Delete webhook' });
  });

  it('a pending member without readable rules still gets a way in', async () => {
    const c = community({ rules: [] });
    render(<RulesGate community={c} />);
    expect(screen.getByText(/could not be shown here/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Join the conversation' })));
    expect(action).toHaveBeenCalledWith({ a: 'acceptRules', communityId: 'c' });
    expect(useCommunity.getState().toast?.text).toBe('Welcome to Club!');
  });
});

describe('sidebar moves', () => {
  it('show at once and can be undone', () => {
    const c = community({ channels: [channel('a', { position: 0 }), channel('b', { position: 1 })] });
    useCommunity.setState({ communities: [c] });
    const groups = sidebarGroups(c.channels, c.categories);
    const undo = showLayout('c', moveChannel(groups, 'b', null, 0));
    const now = useCommunity.getState().communities[0]!;
    expect(sidebarGroups(now.channels, now.categories)[0]!.channels.map((x) => x.id)).toEqual(['b', 'a']);
    undo();
    expect(useCommunity.getState().communities[0]).toBe(c);
  });
});
