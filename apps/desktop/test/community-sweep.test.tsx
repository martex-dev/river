/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_PERMISSIONS, Permission } from '@river/protocol/permissions';
import type { ChannelView, CommunityView, MemberView, RoleView } from '../src/shared/ipc.ts';
import { roleOrderChanges, roleReach } from '../src/shared/role-order.ts';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { CommunitySettings } from '../src/renderer/src/community/ui/CommunitySettings.tsx';
import { ProfileCard } from '../src/renderer/src/community/ui/Members.tsx';
import { OnboardingSettings } from '../src/renderer/src/community/ui/Onboarding.tsx';
import { Modals } from '../src/renderer/src/pages/CommunitiesPage.tsx';
import { TextChannel } from '../src/renderer/src/community/ui/Chat.tsx';
import { RichText } from '../src/renderer/src/community/ui/common.tsx';
import { ChannelSettings, channelName } from '../src/renderer/src/community/ui/Dialogs.tsx';

/** Regression tests for the communities sweep (desktop, after 2.21.2). */

const role = (id: string, position: number, permissions = 0, extra: Partial<RoleView> = {}): RoleView => ({
  id,
  name: id,
  color: 0,
  permissions,
  position,
  everyone: false,
  mentionable: false,
  hoist: false,
  icon: null,
  ...extra,
});

const member = (riverId: string, extra: Partial<MemberView> = {}): MemberView => ({
  riverId,
  name: riverId,
  avatar: null,
  roles: [],
  color: null,
  online: true,
  owner: false,
  rank: 0,
  timeoutUntil: null,
  ...extra,
});

const channel = (id: string, extra: Partial<ChannelView> = {}): ChannelView =>
  ({
    id,
    kind: 'text',
    name: id,
    topic: '',
    position: 0,
    parentId: null,
    permissions: ALL_PERMISSIONS,
    overwrites: [],
    synced: false,
    forum: false,
    tags: [],
    ...extra,
  }) as unknown as ChannelView;

const MANAGER = Permission.MANAGE_ROLES | Permission.MANAGE_COMMUNITY | Permission.SEND_MESSAGES;

/** A community seen by "me", a manager (Manage roles and community) whose top role is at 4. */
const community = (extra: Partial<CommunityView> = {}): CommunityView =>
  ({
    id: 'c',
    name: 'Club',
    ownerId: 'owner',
    permissions: MANAGER,
    myRank: 4,
    roles: [
      role('top', 5, Permission.ADMINISTRATOR),
      role('managers', 4, MANAGER),
      role('banners', 3, Permission.BAN_MEMBERS),
      role('helpers', 2, Permission.SEND_MESSAGES),
      role('fans', 1),
      role('c', 0, Permission.SEND_MESSAGES, { name: '@everyone', everyone: true }),
    ],
    categories: [],
    channels: [channel('ch')],
    members: [
      member('me', { roles: ['managers'], rank: 4 }),
      member('owner', { owner: true, rank: Infinity }),
      member('sam', { rank: 0 }),
    ],
    voice: {},
    voiceStates: {},
    rules: [],
    selfRoles: [],
    welcomeNote: '',
    screening: false,
    webhooks: [],
    ...extra,
  }) as unknown as CommunityView;

const action = vi.fn();
beforeEach(() => {
  action.mockReset();
  action.mockResolvedValue({ ok: true, value: null });
  (window as unknown as { river: unknown }).river = {
    community: { action, messages: vi.fn().mockResolvedValue({ ok: true, value: [] }) },
  };
  useCommunity.setState({ communities: [], modal: null, toast: null });
});
afterEach(cleanup);

describe('roles in reach (2.20.2): the editor offers only what the server allows', () => {
  it('says why a role is out of reach', () => {
    const me = { myRank: 4, permissions: MANAGER };
    expect(roleReach(role('fans', 1), me)).toEqual({ ok: true });
    expect(roleReach(role('top', 5), me)).toEqual({ ok: false, reason: 'rank' });
    expect(roleReach(role('banners', 3, Permission.BAN_MEMBERS), me)).toEqual({
      ok: false,
      reason: 'permissions',
      missing: Permission.BAN_MEMBERS,
    });
    // Owners and administrators hold every permission.
    expect(
      roleReach(role('banners', 3, Permission.BAN_MEMBERS), { myRank: 4, permissions: ALL_PERMISSIONS }),
    ).toEqual({
      ok: true,
    });
  });

  it('moves roles past one that stays put, never moving it', () => {
    const roles = community().roles.filter((r) => !r.everyone);
    // "helpers" up: "banners" carries Ban members, so it keeps its place; helpers has nowhere to go.
    expect(roleOrderChanges(roles, 4, { roleId: 'helpers', direction: 1 }, MANAGER)).toEqual([]);
    // "fans" up swaps with "helpers" only.
    expect(roleOrderChanges(roles, 4, { roleId: 'fans', direction: 1 }, MANAGER)).toEqual([
      { id: 'fans', position: 2 },
      { id: 'helpers', position: 1 },
    ]);
    // Dropped above "banners": just above the movable roles below it.
    expect(roleOrderChanges(roles, 4, { roleId: 'fans', aboveId: 'banners' }, MANAGER)).toEqual([
      { id: 'fans', position: 2 },
      { id: 'helpers', position: 1 },
    ]);
    expect(
      roleOrderChanges(roles, 4, { roleId: 'banners', direction: -1 }, MANAGER).some(
        (r) => r.id === 'banners',
      ),
    ).toBe(false);
    // Without your permissions (an older caller), the rank rule alone applies, as before.
    expect(roleOrderChanges(roles, 4, { roleId: 'helpers', direction: 1 })).toHaveLength(2);
  });

  it('shows a role with permissions you lack as locked, saying which, with no way to change it', async () => {
    const c = community();
    useCommunity.setState({ communities: [c] });
    render(<CommunitySettings community={c} me="me" tab="roles" />);
    const row = screen.getByText('banners').closest('.role-row') as HTMLElement;
    expect(within(row).getByRole('img', { name: 'Out of your reach' })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Move banners up' })).toBeNull();
    expect(row.getAttribute('draggable')).toBe('false');
    await act(async () => fireEvent.click(within(row).getByText('banners')));
    expect(screen.getByRole('note').textContent).toContain('Ban members');
    expect((screen.getByLabelText('Role name') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Delete role' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duplicate role' })).toBeNull();

    // A role in reach: editable, and Move up is off where the only role above stays put.
    const helpers = screen.getByText('helpers').closest('.role-row') as HTMLElement;
    expect(
      (within(helpers).getByRole('button', { name: 'Move helpers up' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(helpers).getByRole('button', { name: 'Move helpers down' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('says why some roles are not offered when giving roles', () => {
    const c = community();
    render(<ProfileCard community={c} member={c.members[2]!} me="me" onDone={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add role' }));
    const picker = document.querySelector('.role-picker') as HTMLElement;
    expect(within(picker).getByRole('note').textContent).toContain('cannot be given or taken by you');
    expect(within(picker).queryByText('banners')).toBeNull();
    expect(within(picker).getByText('helpers')).toBeTruthy();
  });
});

describe('self-assignable roles', () => {
  it('keep roles offered by someone above you, and offer new ones only within your reach', async () => {
    const c = community({
      roles: [...community().roles, role('gamers', 6)],
      selfRoles: ['gamers'],
    });
    render(<OnboardingSettings community={c} />);
    const gamers = screen.getByText('gamers').closest('label') as HTMLElement;
    const box = within(gamers).getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
    const banners = screen.getByText('banners').closest('label') as HTMLElement;
    // Ban members also moderates: that reason comes first.
    expect((within(banners).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    const helpers = screen.getByText('helpers').closest('label') as HTMLElement;
    expect((within(helpers).getByRole('checkbox') as HTMLInputElement).disabled).toBe(false);
  });

  it('do not offer a harmless role carrying a permission you lack', () => {
    const c = community({
      roles: [...community().roles, role('files', 1.5, Permission.ATTACH_FILES)],
    });
    render(<OnboardingSettings community={c} />);
    const files = screen.getByText('files').closest('label') as HTMLElement;
    expect((within(files).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect(files.textContent).toContain('has permissions you do not have');
  });
});

describe('removing things for everyone', () => {
  const settings = (tab: 'invites' | 'emoji') =>
    ({ kind: 'community-settings', communityId: 'c', tab }) as const;
  const owned = (extra: Partial<CommunityView> = {}): CommunityView =>
    community({ permissions: ALL_PERMISSIONS, myRank: Infinity, ownerId: 'me', ...extra });

  it('asks before revoking an invite, and Cancel goes back to the Invites tab', async () => {
    action.mockImplementation(async (a: { a: string }) =>
      a.a === 'invites'
        ? {
            ok: true,
            value: [
              {
                id: 'inv',
                createdBy: 'me',
                createdByName: 'me',
                createdAt: null,
                expiresAt: '2030-01-01T00:00:00.000Z',
                uses: 1,
                maxUses: 100,
                joined: [],
              },
            ],
          }
        : { ok: true, value: null },
    );
    useCommunity.setState({ communities: [owned()], modal: settings('invites') });
    render(<Modals me="me" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(action).not.toHaveBeenCalledWith(expect.objectContaining({ a: 'revokeInvite' }));
    expect(useCommunity.getState().modal).toMatchObject({ kind: 'confirm', back: settings('invites') });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useCommunity.getState().modal).toEqual(settings('invites'));
    // Confirmed: revoked, and back on the tab with the list.
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Revoke invite' })));
    expect(action).toHaveBeenCalledWith({ a: 'revokeInvite', communityId: 'c', inviteId: 'inv' });
    expect(useCommunity.getState().modal).toEqual(settings('invites'));
  });

  it('asks before removing a custom emoji', async () => {
    useCommunity.setState({
      communities: [owned()],
      emojis: { c: [{ id: 'e1', name: 'party', image: 'data:image/png;base64,AA==' }] },
      modal: settings('emoji'),
    });
    render(<Modals me="me" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove :party:' }));
    expect(action).not.toHaveBeenCalledWith(expect.objectContaining({ a: 'deleteEmoji' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove emoji' })));
    expect(action).toHaveBeenCalledWith({ a: 'deleteEmoji', emojiId: 'e1' });
    expect(useCommunity.getState().modal).toEqual(settings('emoji'));
  });

  it('a deleted category closes its settings; Cancel keeps them open', async () => {
    const c = owned({ categories: [{ id: 'k', name: 'Games', position: 0, overwrites: [] }] } as never);
    const category = { kind: 'category', communityId: 'c', categoryId: 'k' } as const;
    useCommunity.setState({ communities: [c], modal: category });
    render(<Modals me="me" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete category' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useCommunity.getState().modal).toEqual(category);
    fireEvent.click(screen.getByRole('button', { name: 'Delete category' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete category' })));
    expect(action).toHaveBeenCalledWith({ a: 'deleteCategory', communityId: 'c', categoryId: 'k' });
    expect(useCommunity.getState().modal).toBeNull();
  });
});

describe('#channel mentions', () => {
  it('link channels named in any of River’s languages', () => {
    const onChannel = vi.fn();
    const refs = {
      roles: [],
      channels: [
        { id: 'ru', name: 'общий' },
        { id: 'de', name: 'spiele-für-alle' },
        { id: 'en', name: 'general' },
      ],
      onChannel,
    };
    render(<RichText text="see #общий, #spiele-für-alle and #general!" names={[]} me={null} refs={refs} />);
    fireEvent.click(screen.getByRole('button', { name: '#общий' }));
    expect(onChannel).toHaveBeenCalledWith('ru');
    fireEvent.click(screen.getByRole('button', { name: '#spiele-für-alle' }));
    expect(onChannel).toHaveBeenCalledWith('de');
    // Punctuation after a name is not part of it.
    expect(screen.getByRole('button', { name: '#general' })).toBeTruthy();
  });

  it('a renamed text channel is saved as a channel name, so it can still be mentioned', async () => {
    expect(channelName('  Game Night ', true)).toBe('game-night');
    expect(channelName(' Lounge 2 ', false)).toBe('Lounge 2');
    const c = community({ permissions: ALL_PERMISSIONS, myRank: Infinity, ownerId: 'me' });
    render(<ChannelSettings community={c} channel={c.channels[0]!} />);
    fireEvent.change(screen.getByLabelText('Channel name'), { target: { value: 'Game Night' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' })));
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ a: 'updateChannel', channelId: 'ch', name: 'game-night' }),
    );
    expect((screen.getByLabelText('Channel name') as HTMLInputElement).value).toBe('game-night');
  });
});

describe('panels over a channel', () => {
  const open = async (): Promise<void> => {
    const c = community({ permissions: ALL_PERMISSIONS, myRank: Infinity, ownerId: 'me' });
    action.mockImplementation(async (a: { a: string }) =>
      a.a === 'historyPage'
        ? { ok: true, value: { messages: [], before: null } }
        : { ok: true, value: a.a === 'pins' ? [] : null },
    );
    (window as unknown as { river: { links: unknown } }).river.links = { preview: vi.fn() };
    useCommunity.setState({
      communities: [c],
      messages: { ch: [] },
      emojis: {},
      typing: {},
      showPins: false,
      showSearch: false,
      showSaved: false,
      saved: [],
    } as never);
    await act(async () => {
      render(<TextChannel community={c} channel={c.channels[0]!} me="me" />);
    });
  };
  const shown = () => {
    const s = useCommunity.getState();
    return { pins: s.showPins, search: s.showSearch, saved: s.showSaved };
  };

  it('show one at a time: they sit in the same place', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(shown()).toEqual({ pins: false, search: true, saved: false });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pinned messages' })));
    expect(shown()).toEqual({ pins: true, search: false, saved: false });
    expect(document.querySelectorAll('.pins')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Saved messages' }));
    expect(shown()).toEqual({ pins: false, search: false, saved: true });
    fireEvent.click(screen.getByRole('button', { name: 'Saved messages' }));
    expect(shown()).toEqual({ pins: false, search: false, saved: false });
  });

  it('close with Escape, and focus goes back to the button that opened them', async () => {
    await open();
    const button = screen.getByRole('button', { name: 'Search' });
    button.focus();
    fireEvent.click(button);
    const input = screen.getByRole('textbox', { name: 'Search messages and files' });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(shown().search).toBe(false);
    expect(document.activeElement).toBe(button);
  });
});

describe('timeouts', () => {
  it('are not offered for administrators, whom they would not restrict', () => {
    const c = community({
      permissions: ALL_PERMISSIONS,
      myRank: Infinity,
      ownerId: 'me',
      members: [
        member('me', { owner: true, rank: Infinity }),
        member('ada', { roles: ['top'], rank: 5 }),
        member('sam', { rank: 0 }),
      ],
    });
    const { unmount } = render(
      <ProfileCard community={c} member={c.members[1]!} me="me" onDone={() => undefined} />,
    );
    expect(screen.queryByRole('button', { name: 'Time out' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Kick' })).toBeTruthy();
    unmount();
    render(<ProfileCard community={c} member={c.members[2]!} me="me" onDone={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Time out' })).toBeTruthy();
  });
});
