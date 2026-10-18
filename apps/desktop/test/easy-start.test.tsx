// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const joinWithLink = vi.fn(async (_link: string): Promise<string | null> => null);
vi.mock(import('../src/renderer/src/community/ui/StartScreen.tsx'), async (importOriginal) => ({
  ...(await importOriginal()),
  joinWithLink: (link: string) => joinWithLink(link),
}));

import { firstRunDesign, PHONE_FIRST_THEME } from '../src/renderer/src/appearance/first-look.ts';
import { Onboarding } from '../src/renderer/src/components/Onboarding.tsx';
import { resetSetupCards, SetupCards } from '../src/renderer/src/components/SetupCards.tsx';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { useDm } from '../src/renderer/src/dm/store.ts';
import { usePhoneNav } from '../src/renderer/src/phone/nav.ts';
import { FirstSteps } from '../src/renderer/src/phone/FirstSteps.tsx';
import { useRiver } from '../src/renderer/src/store.ts';
import { DEFAULT_DESIGN } from '../src/shared/design.ts';
import type { AccountStatus, AppInfo, DeepLink, IdentityInfo } from '../src/shared/ipc.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import { suggestUsername } from '../src/shared/username-suggest.ts';

const ME = '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e4b71';
const INVITE = `https://river.example/join#c=${'C'.repeat(22)}&k=${'K'.repeat(43)}`;
const IDENTITY: IdentityInfo = {
  riverId: ME,
  displayName: 'Ana Petrova',
  fingerprint: 'AAAA BBBB',
  words: [],
  createdAt: '2026-10-18T00:00:00.000Z',
};
const REGISTERED: Extract<AccountStatus, { state: 'registered' }> = {
  state: 'registered',
  server: 'river.example',
  serverUrl: 'https://river.example',
  shareUrl: 'https://river.example',
  riverId: ME,
  deviceId: 1,
  devices: 1,
  listVersion: 1,
  connection: 'online',
  username: null,
};
const info = (platform: string): AppInfo => ({
  version: '2.14.0',
  channel: 'stable',
  platform,
  arch: 'x64',
  isPackaged: true,
  versions: { electron: '', chrome: '', node: '' },
  startupProblem: null,
});

let pending: DeepLink[];
let deepLinkListener: () => void;
let river: Record<string, Record<string, unknown>>;

beforeEach(() => {
  pending = [];
  deepLinkListener = () => undefined;
  joinWithLink.mockReset();
  joinWithLink.mockResolvedValue(null);
  river = {
    app: {
      takeDeepLink: vi.fn(async (kind?: DeepLink['kind']) => {
        const at = pending.findIndex((l) => !kind || l.kind === kind);
        return at === -1 ? null : pending.splice(at, 1)[0]!;
      }),
      onDeepLink: (l: () => void) => {
        deepLinkListener = l;
        return () => undefined;
      },
    },
    identity: { create: vi.fn(async () => IDENTITY), get: vi.fn(async () => IDENTITY) },
    community: { action: vi.fn(async () => ({ ok: true, value: null })) },
    settings: { update: vi.fn(async (patch: object) => ({ ...DEFAULT_SETTINGS, ...patch })) },
    security: { status: vi.fn(async () => ({ items: [], releaseKeys: [] })) },
    account: { setUsername: vi.fn(), redeemSignup: vi.fn() },
    backup: { status: vi.fn(async () => ({ hasPhrase: false, phraseShown: false, lastBackupAt: null })) },
  };
  (window as unknown as { river: unknown }).river = river;
  useRiver.setState({
    settings: structuredClone(DEFAULT_SETTINGS),
    info: info('win32'),
    account: { state: 'none' },
    identity: null,
    onboarding: true,
    onboardingStart: 'welcome',
    settingsTab: null,
  });
  useCommunity.setState({ communities: [], selectedCommunity: null });
  useDm.setState({ conversations: [], loaded: true });
  resetSetupCards();
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment
  }
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { river?: unknown }).river;
});

describe('first run in one screen', () => {
  it('a name and Get started: identity made, River opens — no username, fingerprint or skin step', async () => {
    const onCreated = vi.fn();
    const onFinished = vi.fn();
    render(<Onboarding onCreated={onCreated} onFinished={onFinished} />);
    expect(screen.getByRole('heading', { name: 'Welcome to River' })).toBeTruthy();
    // No server address or keys on the first screen.
    expect(document.body.textContent).not.toMatch(/https?:\/\/|key pair|fingerprint/i);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ana Petrova' } });
    fireEvent.click(screen.getByRole('button', { name: /Get started/ }));
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(river.identity!.create).toHaveBeenCalledWith('Ana Petrova');
    expect(onCreated).toHaveBeenCalledWith(IDENTITY);
    expect(onFinished).toHaveBeenCalledWith();
    // No photo picked: the profile is left alone.
    expect(river.community!.action).not.toHaveBeenCalled();
    // A computer keeps River's usual look (nothing to save).
    expect(river.settings!.update).not.toHaveBeenCalled();
  });

  it('a phone gets the Telegram-like look right away', async () => {
    useRiver.setState({ info: info('android') });
    const onFinished = vi.fn();
    render(<Onboarding onCreated={() => undefined} onFinished={onFinished} />);
    fireEvent.click(screen.getByRole('button', { name: /Get started/ }));
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
    const patch = (river.settings!.update as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      design: { theme: string; chosen: boolean; prefs: { mode: string } };
    };
    expect(patch.design.theme).toBe(PHONE_FIRST_THEME);
    expect(patch.design.prefs.mode).toBe('system');
    // Still an offer: "Pick your look" shows later.
    expect(patch.design.chosen).toBe(false);
  });

  it('opened from an invite: the same screen joins the community and opens it', async () => {
    pending.push({ kind: 'invite', link: INVITE });
    joinWithLink.mockImplementation(async () => {
      useCommunity.setState({ selectedCommunity: 'c1' });
      return null;
    });
    const onFinished = vi.fn();
    render(<Onboarding onCreated={() => undefined} onFinished={onFinished} />);
    await screen.findByText(/You're invited to a community/);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: /Join the community/ }));
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith('communities'));
    expect(joinWithLink).toHaveBeenCalledWith(INVITE);
  });

  it('on a phone, the joined community is open when River appears', async () => {
    useRiver.setState({ info: info('ios') });
    pending.push({ kind: 'invite', link: INVITE });
    joinWithLink.mockImplementation(async () => {
      useCommunity.setState({ selectedCommunity: 'c1' });
      return null;
    });
    const onFinished = vi.fn();
    render(<Onboarding onCreated={() => undefined} onFinished={onFinished} />);
    await screen.findByText(/You're invited to a community/);
    fireEvent.click(screen.getByRole('button', { name: /Join the community/ }));
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith('communities'));
    expect(usePhoneNav.getState().tab).toBe('communities');
    expect(usePhoneNav.getState().stack).toEqual([{ kind: 'community', id: 'c1' }]);
  });

  it('a failed join still lets you in, and says why', async () => {
    pending.push({ kind: 'invite', link: INVITE });
    joinWithLink.mockResolvedValue('That invite has expired.');
    const onFinished = vi.fn();
    render(<Onboarding onCreated={() => undefined} onFinished={onFinished} />);
    await screen.findByText(/You're invited to a community/);
    fireEvent.click(screen.getByRole('button', { name: /Join the community/ }));
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith());
    expect(useCommunity.getState().toast?.text).toMatch(/That invite has expired/);
  });

  it('a device link code opens linking; links arriving once the identity is being made wait', async () => {
    let finish: (v: IdentityInfo) => void = () => undefined;
    (river.identity!.create as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<IdentityInfo>((r) => (finish = r)),
    );
    const take = river.app!.takeDeepLink as ReturnType<typeof vi.fn>;
    render(<Onboarding onCreated={() => undefined} onFinished={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Get started/ }));
    await screen.findByText('Setting up River…');
    take.mockClear();
    act(() => deepLinkListener());
    expect(take).not.toHaveBeenCalled();
    await act(async () => finish(IDENTITY));
  });
});

describe('what the first run leaves for later', () => {
  it('asks for a sign-up link when River’s server only takes invited people', () => {
    useRiver.setState({ account: { state: 'none', needsInvite: true } });
    render(<SetupCards />);
    expect(screen.getByRole('form', { name: 'Finish setting up your account' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Paste your sign-up link')).toBeTruthy();
  });

  it('suggests a username from your name, one tap to save', async () => {
    useRiver.setState({ account: REGISTERED, identity: IDENTITY });
    (river.account!.setUsername as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { ...REGISTERED, username: 'ana.petrova' },
    });
    render(<SetupCards />);
    const field = screen.getByLabelText('Username') as HTMLInputElement;
    expect(field.value).toBe('ana.petrova');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(river.account!.setUsername).toHaveBeenCalledWith('ana.petrova'));
  });

  it('offers a look instead of blocking on it, and remembers the answer', async () => {
    useRiver.setState({ account: { ...REGISTERED, username: 'ana' } });
    render(<SetupCards />);
    expect(screen.getByRole('region', { name: 'Pick your look' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a look' }));
    expect(useRiver.getState().settingsTab).toBe('appearance');
    await waitFor(() => expect(river.settings!.update).toHaveBeenCalled());
    const patch = (river.settings!.update as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      design: { chosen: boolean };
    };
    expect(patch.design.chosen).toBe(true);
  });

  it('offers a backup once there is something to keep, and only while there is none', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.design.chosen = true;
    useRiver.setState({ account: { ...REGISTERED, username: 'ana' }, settings });
    // Nothing to keep yet: no card.
    const { unmount } = render(<SetupCards />);
    expect(screen.queryByRole('region', { name: 'Back up River' })).toBeNull();
    unmount();
    useDm.setState({
      conversations: [{ kind: 'direct', riverId: 'x', name: 'Sam', state: 'accepted' }] as never,
    });
    render(<SetupCards />);
    expect(await screen.findByRole('region', { name: 'Back up River' })).toBeTruthy();
    expect(screen.getByText('You have no backup yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region', { name: 'Back up River' })).toBeNull();
    cleanup();
    // A backup exists: never nagged (and never told it is backed up when it is not).
    resetSetupCards();
    localStorage.clear();
    (river.backup!.status as ReturnType<typeof vi.fn>).mockResolvedValue({
      hasPhrase: true,
      phraseShown: true,
      lastBackupAt: '2026-10-01T00:00:00.000Z',
    });
    render(<SetupCards />);
    await waitFor(() => expect(river.backup!.status).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region', { name: 'Back up River' })).toBeNull();
  });
});

describe('phone Chats before the first conversation', () => {
  it('leads to adding a friend, your QR code, or a community', () => {
    useRiver.setState({ info: info('android') });
    render(<FirstSteps />);
    fireEvent.click(screen.getByRole('button', { name: /Show my QR code/ }));
    expect(usePhoneNav.getState().stack.at(-1)).toEqual({ kind: 'friends' });
    fireEvent.click(screen.getByRole('button', { name: /Join a community/ }));
    expect(useRiver.getState().communityStart).toBe(true);
  });
});

describe('suggested usernames', () => {
  it('follows the server’s rule', () => {
    expect(suggestUsername('Ana Petrova')).toBe('ana.petrova');
    expect(suggestUsername('  José-María  ')).toBe('jose.maria');
    expect(suggestUsername('Мартин Николов')).toBe('martin.nikolov');
    expect(suggestUsername('Щастлив Жоро')).toBe('shtastliv.zhoro');
    expect(suggestUsername('x')).toBe('');
    expect(suggestUsername('...')).toBe('');
    expect(suggestUsername('🙂')).toBe('');
    const long = suggestUsername('a'.repeat(31) + ' b');
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long).toMatch(/^[a-z0-9_][a-z0-9_.]{1,30}[a-z0-9_]$/);
  });
});

describe('the first look', () => {
  it('phones start Telegram-like, computers keep Specter, a chosen look is never replaced', () => {
    expect(firstRunDesign('android', DEFAULT_DESIGN).theme).toBe(PHONE_FIRST_THEME);
    expect(firstRunDesign('ios', DEFAULT_DESIGN).skin).toBe('corporate');
    expect(firstRunDesign('win32', DEFAULT_DESIGN)).toBe(DEFAULT_DESIGN);
    const mine = { ...DEFAULT_DESIGN, theme: 'neon-havoc', skin: 'neon', chosen: true };
    expect(firstRunDesign('android', mine)).toBe(mine);
  });
});
