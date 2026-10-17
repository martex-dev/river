// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupPanel } from '../src/renderer/src/components/BackupPanel.tsx';
import { DevicesPanel } from '../src/renderer/src/components/LinkDevice.tsx';
import { LockScreen } from '../src/renderer/src/components/LockScreen.tsx';
import { Onboarding } from '../src/renderer/src/components/Onboarding.tsx';
import { MissingAccount, SettingsOverlay } from '../src/renderer/src/pages/SettingsPage.tsx';
import { useRiver } from '../src/renderer/src/store.ts';
import type { AccountStatus, AppInfo, LinkProgress } from '../src/shared/ipc.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';

const REGISTERED: Extract<AccountStatus, { state: 'registered' }> = {
  state: 'registered',
  server: 'river.example',
  serverUrl: 'https://river.example',
  shareUrl: 'https://river.example',
  riverId: '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e4b71',
  deviceId: 1,
  devices: 1,
  listVersion: 1,
  connection: 'online',
  username: 'alice',
};

const info = (platform: string): AppInfo => ({
  version: '2.10.13',
  channel: 'stable',
  platform,
  arch: 'x64',
  isPackaged: true,
  versions: { electron: '', chrome: '', node: '' },
  startupProblem: null,
});

let river: Record<string, Record<string, unknown>>;
let linkListener: ((p: LinkProgress) => void) | null;

beforeEach(() => {
  linkListener = null;
  river = {
    app: { takeDeepLink: vi.fn(async () => null), onDeepLink: () => () => undefined },
    host: { status: async () => ({ enabled: false, legacy: 'none' }), onStatus: () => () => undefined },
    security: { status: async () => ({ items: [], releaseKeys: [] }) },
    settings: { update: vi.fn(async () => DEFAULT_SETTINGS) },
    account: {
      setUsername: vi.fn(),
      startOver: vi.fn(),
      relink: vi.fn(),
      status: vi.fn(async () => ({ state: 'none' })),
      devices: vi.fn(async () => ({ ok: true, value: [] })),
      exportData: vi.fn(),
      deleteAccount: vi.fn(),
      connect: vi.fn(),
      link: {
        status: vi.fn(async () => ({ state: 'idle' })),
        onStatus: (l: (p: LinkProgress) => void) => {
          linkListener = l;
          return () => undefined;
        },
        start: vi.fn(),
        confirm: vi.fn(),
        cancel: vi.fn(),
      },
    },
    community: {
      profile: vi.fn(async () => ({ name: 'Al', avatar: null, bio: '', pronouns: '', banner: null })),
    },
    identity: { get: vi.fn(async () => null), create: vi.fn() },
    backup: { status: vi.fn(), phrase: vi.fn(), create: vi.fn() },
    storage: { unlock: vi.fn(), setupPassphrase: vi.fn() },
  };
  (window as unknown as { river: unknown }).river = river;
  useRiver.setState({
    settings: structuredClone(DEFAULT_SETTINGS),
    info: info('win32'),
    account: REGISTERED,
    settingsTab: null,
    settingsDirty: false,
    identity: null,
    onboarding: false,
    onboardingStart: 'welcome',
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as { river?: unknown }).river;
});

describe('Settings overlay', () => {
  it('Esc typed into a field stays with the field; Esc elsewhere closes Settings', () => {
    useRiver.setState({ settingsTab: 'notifications' });
    render(
      <>
        <SettingsOverlay />
        <input aria-label="Somewhere" />
      </>,
    );
    const field = screen.getByLabelText('Somewhere');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(useRiver.getState().settingsTab).toBe('notifications');
    // Already handled (e.g. a picker closed itself): not ours.
    const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    handled.preventDefault();
    act(() => void window.dispatchEvent(handled));
    expect(useRiver.getState().settingsTab).toBe('notifications');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useRiver.getState().settingsTab).toBeNull();
  });

  it('asks before closing or switching tabs with unsaved profile changes', async () => {
    useRiver.setState({ settingsTab: 'profile' });
    render(<SettingsOverlay />);
    const name = await screen.findByDisplayValue('Al');
    fireEvent.change(name, { target: { value: 'Alice' } });
    await waitFor(() => expect(useRiver.getState().settingsDirty).toBe(true));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Security' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(useRiver.getState().settingsTab).toBe('profile');
    expect(screen.getByDisplayValue('Alice')).toBeTruthy();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(useRiver.getState().settingsTab).toBeNull();
  });

  it('lets the profile be saved without a display name, once at a time', async () => {
    let finish: (v: unknown) => void = () => undefined;
    const action = vi.fn(() => new Promise((r) => (finish = r)));
    river.community!.action = action;
    useRiver.setState({ settingsTab: 'profile' });
    render(<SettingsOverlay />);
    fireEvent.change(await screen.findByDisplayValue('Al'), { target: { value: '' } });
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith({ a: 'setProfile', name: '' });
    await act(async () => finish({ ok: true, value: null }));
  });

  it('shows the notification preview choice once, as one named radio group', () => {
    useRiver.setState({ settingsTab: 'notifications' });
    render(<SettingsOverlay />);
    const groups = screen.getAllByRole('group', { name: 'Notification preview' });
    expect(groups).toHaveLength(1);
    const radios = screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).name === 'preview');
    expect(radios).toHaveLength(3);
    expect(screen.queryByText('Nothing private')).toBeNull();
  });

  it('offers interface size only on computers, with no keyboard hint on phones', () => {
    useRiver.setState({ settingsTab: 'appearance', info: info('android') });
    const { unmount } = render(<SettingsOverlay />);
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(screen.getByText('Message text size')).toBeTruthy();
    expect(screen.queryByLabelText('Interface size')).toBeNull();
    expect(screen.queryByText(/Ctrl\+=/)).toBeNull();
    unmount();
    useRiver.setState({ info: info('win32') });
    render(<SettingsOverlay />);
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(screen.getByLabelText('Interface size')).toBeTruthy();
    expect(screen.getByText(/Ctrl\+=/)).toBeTruthy();
  });

  it('does not offer starting with the computer on Linux, where River cannot do it', () => {
    useRiver.setState({ settingsTab: 'system', info: info('linux') });
    const { unmount } = render(<SettingsOverlay />);
    expect(screen.queryByText('Start River when I sign in')).toBeNull();
    unmount();
    useRiver.setState({ info: info('win32') });
    render(<SettingsOverlay />);
    expect(screen.getByText('Start River when I sign in')).toBeTruthy();
  });

  it('shows a setting River changed by itself (a phone without a screen lock turns app lock off)', async () => {
    useRiver.setState({ settingsTab: 'system', info: info('android') });
    const on = structuredClone(DEFAULT_SETTINGS);
    on.system.appLock = true;
    useRiver.setState({ settings: on });
    render(<SettingsOverlay />);
    const lock = screen.getByRole('switch', { name: /Lock River/ }) as HTMLInputElement;
    expect(lock.checked).toBe(true);
    const off = structuredClone(on);
    off.system.appLock = false;
    await act(() => useRiver.getState().setSettings(off));
    expect(lock.checked).toBe(false);
  });

  it('sends a pasted @username without the @ and shows what the server saved', async () => {
    const setUsername = river.account!.setUsername as ReturnType<typeof vi.fn>;
    setUsername.mockResolvedValue({ ok: true, value: { ...REGISTERED, username: 'bob' } });
    useRiver.setState({ settingsTab: 'account' });
    render(<SettingsOverlay />);
    const field = screen.getByLabelText('Username — how people add you') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '@Bob' } });
    expect(field.value).toBe('Bob');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await waitFor(() => expect(setUsername).toHaveBeenCalledWith('Bob'));
    await screen.findByText('Saved. People can add you as @bob.');
    expect(field.value).toBe('bob');
    // Saved: nothing left to change.
    expect((screen.getByRole('button', { name: 'Change' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('an account the server no longer lets this device into', () => {
  it('shows why setting up again failed, and keeps the account', async () => {
    const startOver = river.account!.startOver as ReturnType<typeof vi.fn>;
    startOver.mockResolvedValue({ ok: false, message: 'This server is not accepting new accounts.' });
    render(<MissingAccount account={{ ...REGISTERED, missing: true }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set up my account again' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This server is not accepting new accounts.');
    expect(useRiver.getState().account).toEqual(REGISTERED);
  });

  it('a device known to be removed is only offered linking again', async () => {
    const relink = river.account!.relink as ReturnType<typeof vi.fn>;
    relink.mockResolvedValue({ ok: true, value: null });
    render(<MissingAccount account={{ ...REGISTERED, missing: true, removed: true }} />);
    expect(screen.queryByRole('button', { name: 'Set up my account again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Link this device again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(useRiver.getState().onboarding).toBe(true));
    expect(useRiver.getState()).toMatchObject({ onboardingStart: 'link', identity: null, settingsTab: null });
  });
});

describe('Devices', () => {
  it('starts one link at a time, and confirms once', async () => {
    let started: (v: unknown) => void = () => undefined;
    const start = river.account!.link as Record<string, ReturnType<typeof vi.fn>>;
    start.start!.mockImplementation(() => new Promise((r) => (started = r)));
    render(<DevicesPanel />);
    const button = await screen.findByRole('button', { name: 'Link a new device' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(start.start).toHaveBeenCalledTimes(1);
    await act(async () => started({ ok: true, value: { state: 'idle' } }));

    let confirmed: (v: unknown) => void = () => undefined;
    start.confirm!.mockImplementation(() => new Promise((r) => (confirmed = r)));
    act(() => linkListener!({ state: 'request', deviceName: 'Pixel' }));
    const linkIt = screen.getByRole('button', { name: /Link it/ });
    fireEvent.click(linkIt);
    fireEvent.click(linkIt);
    expect(start.confirm).toHaveBeenCalledTimes(1);
    await act(async () => confirmed({ ok: true, value: { deviceId: 2 } }));
  });

  it('says "Linked" only on the device that added the new one', async () => {
    render(<DevicesPanel />);
    await screen.findByRole('button', { name: 'Link a new device' });
    act(() => linkListener!({ state: 'linked' }));
    expect(screen.queryByText(/^Linked/)).toBeNull();
    act(() => linkListener!({ state: 'linked', deviceName: 'Pixel' }));
    expect(screen.getByText('Linked Pixel. It is setting itself up.')).toBeTruthy();
    act(() => linkListener!({ state: 'idle' }));
    expect(screen.queryByText(/^Linked/)).toBeNull();
  });
});

describe('Backup', () => {
  it('needs the recovery phrase shown before the first backup', async () => {
    const backup = river.backup as Record<string, ReturnType<typeof vi.fn>>;
    backup.status!.mockResolvedValue({ hasPhrase: false, phraseShown: false, lastBackupAt: null });
    backup.phrase!.mockResolvedValue(Array.from({ length: 18 }, (_, i) => `word${i}`));
    render(<BackupPanel />);
    const save = await screen.findByRole('button', { name: 'Save encrypted backup…' });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(true));
    backup.status!.mockResolvedValue({ hasPhrase: true, phraseShown: true, lastBackupAt: null });
    fireEvent.click(screen.getByRole('button', { name: 'Create my recovery phrase' }));
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  });
});

describe('Lock screen', () => {
  it('a failed unlock call never leaves the button stuck on "Unlocking…"', async () => {
    const storage = river.storage as Record<string, ReturnType<typeof vi.fn>>;
    storage.unlock!.mockRejectedValue(new Error('IPC failed'));
    render(<LockScreen status={{ state: 'locked' }} />);
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'secret words' } });
    fireEvent.click(screen.getByRole('button', { name: /Unlock/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/try again/);
    expect(screen.getByRole('button', { name: /Unlock/ }).textContent).not.toMatch(/Unlocking/);
  });

  it('refuses a passphrase longer than River accepts, before asking', async () => {
    const storage = river.storage as Record<string, ReturnType<typeof vi.fn>>;
    render(<LockScreen status={{ state: 'setup-required', minLength: 8 }} />);
    const long = 'x'.repeat(1025);
    const [first, second] = screen.getAllByLabelText(/passphrase/i);
    // The fields stop at 1024 characters; a pasted longer one is caught on submit too.
    expect((first as HTMLInputElement).maxLength).toBe(1024);
    fireEvent.change(first!, { target: { value: long } });
    fireEvent.change(second!, { target: { value: long } });
    fireEvent.click(screen.getByRole('button', { name: /Set passphrase/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/at most 1024/);
    expect(storage.setupPassphrase).not.toHaveBeenCalled();
  });
});

describe('First run', () => {
  it('asks for a sign-up link on an invite-only server, and ignores device links once the identity exists', async () => {
    let deepLink: () => void = () => undefined;
    const app = river.app as Record<string, unknown>;
    app.onDeepLink = (l: () => void) => {
      deepLink = l;
      return () => undefined;
    };
    const take = app.takeDeepLink as ReturnType<typeof vi.fn>;
    (river.identity!.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      riverId: REGISTERED.riverId,
      displayName: null,
      fingerprint: 'AAAA BBBB',
      words: [],
      createdAt: '2026-10-17T00:00:00.000Z',
    });
    useRiver.setState({ account: { state: 'none', needsInvite: true } });
    render(<Onboarding reducedMotion onCreated={() => undefined} onFinished={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Create my identity/ }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await screen.findByText('Pick a username');
    // Invite-only: the sign-up link field is there without trying a username first.
    expect(screen.getByLabelText('Paste your sign-up link')).toBeTruthy();
    take.mockClear();
    act(() => deepLink());
    expect(take).not.toHaveBeenCalled();
    expect(screen.getByText('Pick a username')).toBeTruthy();
  });
});
