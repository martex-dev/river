import { isPhone } from '../../../shared/platform.ts';
import { LANGUAGES, languageInfo, msg, resolveLanguage, tr, useLanguage, useT } from '../i18n.ts';
import { dateLocale } from '../time.ts';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { BackupPanel } from '../components/BackupPanel.tsx';
import { ErrorBoundary } from '../components/ErrorBoundary.tsx';
import { DevicesPanel } from '../components/LinkDevice.tsx';
import { ConnectionCheck } from '../components/ConnectionCheck.tsx';
import { PrivacySettings } from '../components/PrivacySettings.tsx';
import {
  BATTERY_WHY,
  PhoneCallsSection,
  refreshAfterStayConnected,
  refreshPhoneStatus,
} from '../components/PhoneReachability.tsx';
import { HostingPanel, useHostStatus } from '../components/HostingPanel.tsx';
import type { ReleaseChannel } from '@river/release/channels';
import type { AccountStatus, ServerCheckResult, UpdateStatus } from '../../../shared/ipc.ts';
import { serverUrlSchema, type Settings } from '../../../shared/settings.ts';
import { inQuietHours } from '../../../shared/notify-rules.ts';
import { ExternalIcon } from '../components/Icons.tsx';
import { Modal, XIcon } from '../community/ui/common.tsx';
import { BackIcon } from '../phone/icons.tsx';
import { NotificationSettings, Profile, VoiceSettings } from '../community/ui/UserSettings.tsx';
import { SecurityPage } from './SecurityPage.tsx';
import { AppearanceCenter } from '../appearance/AppearanceCenter.tsx';
import { TryBar } from '../appearance/TryBar.tsx';
import { useCommunity } from '../community/store.ts';
import { phoneShellActive } from '../phone/mode.ts';
import { useRiver, type SettingsTab } from '../store.ts';
import { play, playNotifySound } from '../community/sound.ts';
import { NOTIFY_SOUND_LABELS, NOTIFY_TONES } from '../../../shared/notify-sounds.ts';

const TAB_LABEL: Record<SettingsTab, string> = {
  account: msg('Account'),
  profile: msg('Profile'),
  security: msg('Security'),
  backup: msg('Backup'),
  appearance: msg('Appearance'),
  voice: msg('Voice & video'),
  notifications: msg('Notifications'),
  system: msg('System'),
  updates: msg('Updates'),
  hosting: msg('Hosting'),
  about: msg('About'),
};

const GROUPS: Array<{ title: string; tabs: SettingsTab[] }> = [
  { title: msg('User settings'), tabs: ['account', 'profile', 'security', 'backup'] },
  {
    title: msg('App settings'),
    tabs: ['appearance', 'voice', 'notifications', 'system', 'updates', 'hosting', 'about'],
  },
];

const CHANNELS: Array<{ id: ReleaseChannel; name: string; text: string }> = [
  { id: 'stable', name: msg('Stable'), text: msg('Tested releases. Recommended for everyone.') },
  { id: 'beta', name: msg('Beta'), text: msg('New features a little earlier. Occasional rough edges.') },
  { id: 'nightly', name: msg('Nightly'), text: msg('Development builds. May break. For testers only.') },
];

/** `phone`: River for Android, where Android's own installer replaces the app. */
export function describeUpdate(status: UpdateStatus, phone = false): string {
  switch (status.state) {
    case 'disabled':
      return status.reason;
    case 'idle':
      return tr('Not checked yet.');
    case 'checking':
      return tr('Checking for updates…');
    case 'up-to-date':
      return tr('River is up to date. Last checked {time}.', {
        time: new Date(status.checkedAt).toLocaleTimeString(dateLocale()),
      });
    case 'available':
      return tr('River {version} is available.', { version: status.version });
    case 'downloading':
      return tr('Downloading River {version}… {percent}%', {
        version: status.version,
        percent: status.percent,
      });
    case 'verifying':
      return tr('Verifying the signature of River {version}…', { version: status.version });
    case 'ready':
      if (status.needsPermission) {
        return tr(
          'River {version} is downloaded and verified. Android needs your permission first: turn on “Allow from this source” for River in the settings screen that opened, then come back and tap Install update.',
          { version: status.version },
        );
      }
      return phone
        ? tr('River {version} is downloaded and verified. Tap Install update; Android asks you to confirm.', {
            version: status.version,
          })
        : tr('River {version} is downloaded and verified. Restart to finish updating.', {
            version: status.version,
          });
    case 'installing':
      return tr(
        'Installing River {version}… Confirm in Android’s installer. River closes while it updates; open it again afterwards.',
        { version: status.version },
      );
    case 'reinstall-needed':
      return status.message;
    case 'manual':
      return tr('River {version} is available. On macOS, download it from the release page.', {
        version: status.version,
      });
    case 'error':
      return status.message;
  }
}

/** Switches, sliders and buttons are not typed into: Esc there still closes Settings. */
const NOT_TYPED = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file']);

function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target instanceof HTMLInputElement && !NOT_TYPED.has(target.type);
}

/**
 * Settings (1.0.42): a full-window overlay over whatever is open, like
 * Discord's — your account and profile, security, and the app's own settings,
 * all in one list. Esc or the close button returns to where you were.
 */
export function SettingsOverlay(): ReactElement | null {
  const tr = useT();
  const tab = useRiver((s) => s.settingsTab);
  const openSettings = useRiver((s) => s.openSettings);
  const close = useRiver((s) => s.closeSettings);
  const settings = useRiver((s) => s.settings);
  const host = useHostStatus();
  const [askedForHosting, setAskedForHosting] = useState(false);
  // Hosting is for whoever runs a server; everyone else never sees it.
  // Phones never host: hosting runs on a computer.
  const phone = useRiver((r) => isPhone(r.info?.platform));
  const showHosting =
    !phone && (askedForHosting || tab === 'hosting' || host?.enabled || (host?.legacy ?? 'none') !== 'none');

  // Unsaved edits (the profile's "Careful — you have unsaved changes!") are not thrown away by
  // closing Settings or switching tabs without asking.
  const leave = (then: () => void): void => {
    if (
      useRiver.getState().settingsDirty &&
      !window.confirm(tr('You have unsaved changes. Leave without saving them?'))
    )
      return;
    useRiver.getState().setSettingsDirty(false);
    then();
  };

  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A dialog opened from Settings (a crop, a confirmation) closes first.
      if (document.querySelector('.modal')) return;
      // Esc while typing belongs to the field (clearing it, closing a picker, cancelling a rename).
      if (typingIn(e.target)) return;
      leave(close);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, close]);

  if (!tab) return null;
  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label={tr('Settings')}>
      {/* On a phone (2.12) each section opens full screen from the Settings tab, with Back. */}
      {phone && (
        <header className="settings-overlay__phone-head pchat-head">
          <button className="pchat-head__back" aria-label={tr('Back')} onClick={() => leave(close)}>
            <BackIcon size={26} />
          </button>
          <h1 className="settings-overlay__phone-title">{tr(TAB_LABEL[tab])}</h1>
        </header>
      )}
      {!phone && (
        <nav className="settings-overlay__nav" aria-label={tr('Settings sections')}>
          <div className="settings-overlay__nav-inner">
            {GROUPS.map((g) => (
              <div key={g.title} className="settings-overlay__group">
                <div className="settings-overlay__heading">{tr(g.title)}</div>
                {g.tabs
                  .filter((id) => id !== 'hosting' || showHosting)
                  .map((id) => (
                    <button
                      key={id}
                      className={`settings-overlay__tab ${tab === id ? 'is-active' : ''}`}
                      aria-current={tab === id ? 'page' : undefined}
                      onClick={() => {
                        if (id !== tab) leave(() => openSettings(id));
                      }}
                    >
                      {tr(TAB_LABEL[id])}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </nav>
      )}
      <section className="settings-overlay__body">
        <div
          className={`settings-overlay__content ${tab === 'appearance' ? 'settings-overlay__content--wide' : ''}`}
          key={tab}
        >
          <TryBar inSettings />
          {/* One panel crashing replaces only that panel (2.11.2): the tabs and Close keep working. */}
          <ErrorBoundary area={tr(TAB_LABEL[tab])} resetKey={tab}>
            {!settings ? (
              <p className="muted">{tr('Loading…')}</p>
            ) : (
              <>
                {tab === 'account' && (
                  <>
                    <ServerPanel settings={settings} />
                    <DevicesPanel />
                    {!showHosting && !phone && (
                      <button
                        className="btn btn--link"
                        onClick={() => {
                          setAskedForHosting(true);
                          leave(() => openSettings('hosting'));
                        }}
                      >
                        {tr('Run a River server on this PC…')}
                      </button>
                    )}
                  </>
                )}
                {tab === 'profile' && <Profile />}
                {tab === 'security' && <SecurityPage />}
                {tab === 'backup' && <BackupPanel />}
                {tab === 'appearance' && (
                  <AppearanceCenter general={<AppearancePanel settings={settings} />} />
                )}
                {tab === 'voice' && <VoiceSettings />}
                {tab === 'notifications' && (
                  <>
                    <NotificationSettings />
                    <NotificationsPanel settings={settings} />
                  </>
                )}
                {tab === 'system' && <SystemPanel settings={settings} />}
                {tab === 'updates' && <UpdatesPanel settings={settings} />}
                {tab === 'hosting' && <HostingTab />}
                {tab === 'about' && <AboutPanel />}
              </>
            )}
          </ErrorBoundary>
        </div>
        {!phone && (
          <div className="settings-overlay__close">
            <button
              className="settings-overlay__x"
              aria-label={tr('Close settings')}
              onClick={() => leave(close)}
            >
              <XIcon />
            </button>
            <span aria-hidden="true">ESC</span>
          </div>
        )}
      </section>
    </div>
  );
}

function UpdatesPanel({ settings }: { settings: Settings }): ReactElement {
  const info = useRiver((s) => s.info);
  const update = useRiver((s) => s.update);
  const updateSettings = useRiver((s) => s.updateSettings);
  const check = useRiver((s) => s.checkForUpdates);
  const openSettings = useRiver((s) => s.openSettings);
  // Android updates itself (with Android's installer); an iPhone cannot, so it has no update settings.
  const phone = info?.platform === 'android';
  const ios = info?.platform === 'ios';
  const busy = ['checking', 'downloading', 'verifying'].includes(update.state);

  return (
    <div className="panel">
      <h2 className="panel__title">{tr('Updates')}</h2>
      <div className="update-status" data-state={update.state} role="status" aria-live="polite">
        <div>
          <div className="update-status__version">
            River <span className="mono">{info?.version ?? '…'}</span>
            <span className="chip">{info?.channel ?? 'stable'}</span>
          </div>
          <p className="muted">{describeUpdate(update, phone)}</p>
          {update.state === 'downloading' && (
            <div className="progress" aria-hidden="true">
              <div className="progress__bar" style={{ width: `${update.percent}%` }} />
            </div>
          )}
        </div>
        <div className="update-status__actions">
          {phone && (update.state === 'ready' || update.state === 'installing') ? (
            // Android: opens Android's installer (again, if it was closed without an answer).
            <button className="btn btn--primary" onClick={() => void window.river.updates.install()}>
              {tr('Install update')}
            </button>
          ) : phone && update.state === 'available' ? (
            <button className="btn btn--primary" onClick={() => void window.river.updates.install()}>
              {tr('Download update')}
            </button>
          ) : update.state === 'reinstall-needed' ? (
            <>
              <button className="btn btn--ghost" onClick={() => openSettings('backup')}>
                {tr('Back up first')}
              </button>
              <button
                className="btn btn--primary"
                onClick={() => void window.river.updates.openDownloadPage()}
              >
                {tr('Open download page')} <ExternalIcon size={14} />
              </button>
            </>
          ) : update.state === 'ready' ? (
            <button className="btn btn--primary" onClick={() => void window.river.updates.install()}>
              {tr('Restart and update')}
            </button>
          ) : update.state === 'available' ? (
            <button className="btn btn--primary" onClick={() => void window.river.updates.download()}>
              {tr('Download {version}', { version: update.version })}
            </button>
          ) : update.state === 'manual' ? (
            <button className="btn btn--primary" onClick={() => void window.river.updates.openDownloadPage()}>
              {tr('Open download page')} <ExternalIcon size={14} />
            </button>
          ) : (
            <button
              className="btn btn--ghost"
              disabled={busy || update.state === 'disabled'}
              onClick={() => void check()}
            >
              {tr('Check now')}
            </button>
          )}
        </div>
      </div>

      {!ios && (
        <>
          <fieldset className="field">
            <legend className="field__label">{tr('Release channel')}</legend>
            <div className="choice-grid">
              {CHANNELS.map((c) => (
                <label
                  key={c.id}
                  className={`choice ${settings.updates.channel === c.id ? 'is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="channel"
                    value={c.id}
                    checked={settings.updates.channel === c.id}
                    onChange={() => void updateSettings({ updates: { channel: c.id } })}
                  />
                  <span className="choice__name">{tr(c.name)}</span>
                  <span className="choice__text">{tr(c.text)}</span>
                </label>
              ))}
            </div>
            {settings.updates.channel !== 'stable' && (
              <p className="warning-note">
                {tr(
                  'You will receive pre-release builds. They are signed like every release, but may contain bugs. Switching back to Stable takes effect at the next stable version newer than the one you have.',
                )}
              </p>
            )}
          </fieldset>

          <Toggle
            label={tr('Check for updates automatically')}
            hint={
              phone
                ? tr('Checks GitHub Releases about every six hours.')
                : tr('Checks GitHub Releases about every four hours.')
            }
            checked={settings.updates.autoCheck}
            onChange={(v) => void updateSettings({ updates: { autoCheck: v } })}
          />
          <Toggle
            label={tr('Download updates automatically')}
            hint={
              phone
                ? tr(
                    'Every download is verified against River’s release signature. Android asks you before it installs anything.',
                  )
                : tr(
                    'Every download is verified against River’s release signature before it can be installed.',
                  )
            }
            checked={settings.updates.autoDownload}
            onChange={(v) => void updateSettings({ updates: { autoDownload: v } })}
          />
          {/* Android always asks before installing, and River never quits on its own there. */}
          {!phone && (
            <Toggle
              label={tr('Install verified updates by themselves')}
              hint={tr(
                'When River is in the tray or you have not used it for 10 minutes, and never during a call. A PC that hosts River does it at night.',
              )}
              checked={settings.updates.installOnQuit}
              onChange={(v) => void updateSettings({ updates: { installOnQuit: v } })}
            />
          )}
        </>
      )}
    </div>
  );
}

function UsernameEditor({
  account,
}: {
  account: Extract<AccountStatus, { state: 'registered' }>;
}): ReactElement {
  const [value, setValue] = useState(account.username ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const setAccount = useRiver((r) => r.setAccount);
  // The username as typed, without the @ people often paste with it.
  const typed = value.trim().replace(/^@+/, '');
  // The account's username changed (saved here, or elsewhere — the server keeps it in lower
  // case): show what it is now.
  const [shown, setShown] = useState(account.username);
  if (shown !== account.username) {
    setShown(account.username);
    setValue(account.username ?? '');
  }
  const save = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await window.river.account.setUsername(typed);
      if (res.ok) {
        void setAccount(res.value);
        // What the server saved (it keeps usernames in lower case).
        const name = res.value.state === 'registered' ? (res.value.username ?? typed) : typed;
        setValue(name);
        setMsg({ ok: true, text: tr('Saved. People can add you as @{name}.', { name }) });
      } else {
        play('error');
        setMsg({ ok: false, text: res.message });
      }
    } finally {
      setBusy(false);
    }
  };
  const changed = typed.toLowerCase() !== (account.username ?? '').toLowerCase();
  return (
    <div className="field">
      <label className="field__label" htmlFor="username">
        {tr('Username — how people add you')}
      </label>
      <div className="username-row">
        <div className="textfield username-field">
          <span className="username-field__at" aria-hidden="true">
            @
          </span>
          <input
            id="username"
            value={value}
            onChange={(e) => {
              setValue(e.target.value.replace(/^\s*@+/, ''));
              setMsg(null);
            }}
            placeholder={tr('username')}
            autoCapitalize="none"
            spellCheck={false}
            maxLength={32}
          />
        </div>
        <button
          className="btn btn--primary btn--small"
          disabled={busy || !changed || typed.length < 3}
          onClick={() => void save()}
        >
          {busy ? tr('Saving…') : account.username ? tr('Change') : tr('Set username')}
        </button>
      </div>
      {msg && (
        <p className={msg.ok ? 'muted small' : 'field__error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

function ServerPanel({ settings }: { settings: Settings }): ReactElement {
  const account = useRiver((s) => s.account);
  if (account.state === 'registered') return <AccountPanel account={account} />;
  return <ServerSetup settings={settings} />;
}

const CONNECTION_LABEL = {
  connecting: msg('Connecting…'),
  online: msg('Connected'),
  offline: msg('Offline'),
  error: msg('Problem'),
} as const;

function AccountPanel({
  account,
}: {
  account: Extract<AccountStatus, { state: 'registered' }>;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const connected = account.connection === 'online';
  const status =
    account.connection === 'online'
      ? tr('Connected')
      : account.connection === 'connecting'
        ? tr('Connecting…')
        : tr("Offline — you'll reconnect automatically");
  return (
    <div className="panel">
      <h2 className="panel__title">{tr('Account')}</h2>
      <UsernameEditor account={account} />
      <div className={`account-card is-${account.connection}`} role="status">
        <div className="account-card__head">
          <strong>{account.username ? `@${account.username}` : tr('Your account')}</strong>
          <span className={`chip chip--${account.connection}`}>
            {connected ? tr('Connected') : tr(CONNECTION_LABEL[account.connection])}
          </span>
        </div>
        <p className="muted small">{status}</p>
        {account.message && account.connection === 'error' && (
          <p className="field__error">{account.message}</p>
        )}
        {account.missing ? (
          <MissingAccount account={account} />
        ) : (
          !connected && (
            <div className="button-row">
              <button
                className="btn btn--ghost btn--small"
                disabled={busy || account.connection === 'connecting'}
                onClick={() => {
                  setBusy(true);
                  void window.river.account.connect().finally(() => setBusy(false));
                }}
              >
                {tr('Try now')}
              </button>
            </div>
          )
        )}
      </div>
      <details className="account-tech">
        <summary>{tr('Technical details')}</summary>
        <dl className="about-grid">
          <div>
            <dt>{tr('Account ID')}</dt>
            <dd className="mono small">{account.riverId}</dd>
          </div>
          <div>
            <dt>{tr('This device')}</dt>
            <dd>
              {tr('Device {device} of {devices} · list v{version}', {
                device: account.deviceId,
                devices: account.devices,
                version: account.listVersion,
              })}
            </dd>
          </div>
          <div>
            <dt>{tr('Connection')}</dt>
            <dd className="mono small">{account.serverUrl}</dd>
          </div>
        </dl>
        <p className="muted small">
          {tr(
            'River stores your account ID, your public keys and which devices you use — never your messages or your name.',
          )}
        </p>
      </details>
      <ExportData />
      <DeleteAccount />
    </div>
  );
}

/**
 * The server no longer lets this device sign in. Either the account was removed (set it up
 * again: a new account for the same identity) or this device was removed from it (link it
 * again from a device that still has the account). The server does not say which on purpose;
 * setting up again finds out, and keeps everything as it was if the account is still there.
 */
export function MissingAccount({
  account,
}: {
  account: Extract<AccountStatus, { state: 'registered' }>;
}): ReactElement {
  const [busy, setBusy] = useState<'setup' | 'relink' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const startOver = async (): Promise<void> => {
    setBusy('setup');
    setError(null);
    try {
      const res = await window.river.account.startOver();
      if (res.ok) void useRiver.getState().setAccount(res.value);
      else {
        play('error');
        setError(res.message);
      }
    } finally {
      setBusy(null);
    }
  };
  const relink = async (): Promise<void> => {
    setBusy('relink');
    setError(null);
    try {
      const res = await window.river.account.relink();
      if (res.ok) useRiver.getState().startRelink();
      else {
        play('error');
        setError(res.message);
      }
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };
  const linkFirst = account.removed || account.wasLinked;
  const linkButton = (
    <button
      className={`btn ${linkFirst ? 'btn--primary' : 'btn--ghost'} btn--small`}
      disabled={busy !== null}
      onClick={() => setConfirming(true)}
    >
      {busy === 'relink' ? 'Preparing…' : 'Link this device again'}
    </button>
  );
  return (
    <>
      <div className="button-row">
        {linkFirst && linkButton}
        {!account.removed && (
          <button
            className={`btn ${linkFirst ? 'btn--ghost' : 'btn--primary'} btn--small`}
            disabled={busy !== null}
            onClick={() => void startOver()}
          >
            {busy === 'setup' ? 'Setting up…' : 'Set up my account again'}
          </button>
        )}
        {!linkFirst && linkButton}
      </div>
      <p className="muted small">
        {account.removed
          ? 'On a device that still has your account, open Settings → Account → Devices → Link a new device, then use its code here.'
          : 'Set up again: a new account for your identity — same name and messages here; rejoin communities with an invite. Link again: if this device was removed, join your account from a device that still has it.'}
      </p>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {confirming && (
        <Modal title="Link this device again?" onClose={() => setConfirming(false)}>
          <p>
            River forgets the account and identity on this device, then you link it again with a code from a
            device that still has your account. Your messages and contacts on this device stay, and only work
            again with the same account.
          </p>
          <div className="modal__foot">
            <button className="btn btn--link" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button className="btn btn--primary" disabled={busy !== null} onClick={() => void relink()}>
              {busy === 'relink' ? 'Preparing…' : 'Continue'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Settings → Account → Export my data (1.0.23). */
function ExportData(): ReactElement {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | string>('idle');
  const run = async (): Promise<void> => {
    setState('busy');
    const res = await window.river.account.exportData();
    if (!res.ok) setState(res.message);
    else setState(res.value ? 'done' : 'idle');
  };
  return (
    <div className="field export-data">
      <div className="field__label">Your data</div>
      <p className="muted small">
        Save a readable copy (JSON) of what this device keeps: your profile, settings, contacts, direct
        messages, groups, calls, your posts and saved messages. It never contains your keys. Keep it somewhere
        safe — it is not encrypted.
      </p>
      <button className="btn btn--ghost btn--small" disabled={state === 'busy'} onClick={() => void run()}>
        {state === 'busy' ? 'Preparing…' : 'Export my data'}
      </button>
      {state === 'done' && <span className="muted small"> Saved.</span>}
      {state !== 'idle' && state !== 'busy' && state !== 'done' && (
        <span className="field__error">{state}</span>
      )}
    </div>
  );
}

/** Settings → Account → Delete account (1.0.18). */
function DeleteAccount(): ReactElement {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await window.river.account.deleteAccount();
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setOpen(false);
    useCommunity.getState().notify('Your account was deleted.');
    void useCommunity.getState().load();
  };
  return (
    <section className="danger-zone">
      <h3>Delete account</h3>
      <p className="muted small">
        Removes your account from your server for good: you leave every community (communities you own are
        deleted), and your keys and devices are removed there. Messages you already sent stay where they are,
        encrypted. Your identity and the messages on this device stay on this device.
      </p>
      <button className="btn btn--danger btn--small" onClick={() => setOpen(true)}>
        Delete account…
      </button>
      {open && (
        <Modal title="Delete your account?" onClose={() => setOpen(false)}>
          <p>This cannot be undone. Type DELETE to confirm.</p>
          <label className="textfield">
            <span className="field__label">Confirmation</span>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" />
          </label>
          {error && <p className="field__error">{error}</p>}
          <div className="modal__foot">
            <button className="btn btn--link" onClick={() => setOpen(false)}>
              Keep my account
            </button>
            <button
              className="btn btn--danger"
              disabled={typed !== 'DELETE' || busy}
              onClick={() => void run()}
            >
              {busy ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function ServerSetup({ settings }: { settings: Settings }): ReactElement {
  const updateSettings = useRiver((s) => s.updateSettings);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [draft, setDraft] = useState(settings.server.url ?? '');
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<ServerCheckResult | null>(null);
  const [busy, setBusy] = useState(false);

  const validate = (): string | null => {
    const parsed = serverUrlSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid address');
      return null;
    }
    setError(null);
    return parsed.data;
  };

  const test = async (): Promise<void> => {
    const url = validate();
    if (!url) return;
    setBusy(true);
    setCheck(null);
    try {
      setCheck(await window.river.server.check(url));
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    const url = validate();
    if (!url) return;
    await updateSettings({ server: { url } });
    setDraft(url);
  };

  const remove = async (): Promise<void> => {
    await updateSettings({ server: { url: null } });
    setDraft('');
    setCheck(null);
    setError(null);
  };

  return (
    <div className="panel">
      <h2 className="panel__title">Server</h2>
      <p className="muted">
        River uses a server to deliver encrypted messages between devices. Anyone can run one. The server
        never receives your keys or readable messages.
      </p>
      <label className="textfield">
        <span className="field__label">Server address</span>
        <input
          type="url"
          inputMode="url"
          spellCheck={false}
          placeholder="https://river.example.org"
          value={draft}
          aria-invalid={error ? true : undefined}
          aria-describedby="server-hint"
          onChange={(e) => {
            setDraft(e.target.value);
            setCheck(null);
          }}
        />
      </label>
      <p id="server-hint" className={error ? 'field__error' : 'muted small'}>
        {error ?? 'Must start with https:// (http:// is allowed only for a server on this computer).'}
      </p>
      <div className="button-row">
        <button className="btn btn--ghost" disabled={busy || draft.trim() === ''} onClick={() => void test()}>
          {busy ? 'Testing…' : 'Test connection'}
        </button>
        <button
          className="btn btn--primary"
          disabled={draft.trim() === '' || draft.trim() === settings.server.url}
          onClick={() => void save()}
        >
          Save
        </button>
        {settings.server.url && (
          <button className="btn btn--link" onClick={() => void remove()}>
            Remove server
          </button>
        )}
      </div>
      {check && (
        <div className={`server-check ${check.ok ? 'is-ok' : 'is-bad'}`} role="status">
          {check.ok ? (
            <>
              <strong>River server reachable</strong>
              <span className="muted small">
                Server <span className="mono">{check.version}</span> · protocol{' '}
                <span className="mono">v{check.protocol}</span> · compatible
              </span>
            </>
          ) : (
            <>
              <strong>Connection failed</strong>
              <span className="muted small">{check.message}</span>
            </>
          )}
        </div>
      )}
      <p className="muted small">
        Testing sends one anonymous request for the server’s version — nothing about you.
      </p>

      {settings.server.url && (
        <div className="create-account">
          <h3 className="card__title">Create your account on {new URL(settings.server.url).host}</h3>
          <p className="muted small">
            River registers your River ID, your public identity key and a new key for this device. No phone
            number, e-mail or name is sent. Your display name stays on this computer.
          </p>
          {createError && (
            <p className="field__error" role="alert">
              {createError}
            </p>
          )}
          <div className="button-row">
            <button
              className="btn btn--primary"
              disabled={creating}
              onClick={() => {
                setCreating(true);
                setCreateError(null);
                void window.river.account
                  .register()
                  .then((r) => {
                    if (!r.ok) setCreateError(r.message);
                  })
                  .finally(() => setCreating(false));
              }}
            >
              {creating ? 'Creating account…' : 'Create account'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AppearancePanel({ settings }: { settings: Settings }): ReactElement {
  const updateSettings = useRiver((s) => s.updateSettings);
  const platform = useRiver((r) => r.info?.platform);
  const phone = isPhone(platform);
  const mac = platform === 'darwin';
  const tr = useT();
  const current = languageInfo(useLanguage());
  // "Follow my system (Deutsch)": what following the system gives right now.
  const systemName = languageInfo(resolveLanguage('system')).name;
  const options: Array<{ id: Settings['appearance']['motion']; name: string; text: string }> = [
    {
      id: 'system',
      name: tr('Follow system'),
      text: tr('Use your operating system’s reduced-motion setting.'),
    },
    { id: 'reduced', name: tr('Reduced'), text: tr('Minimal animation everywhere.') },
    { id: 'full', name: tr('Full'), text: tr('All animations, including the network field.') },
  ];
  return (
    <div className="panel">
      <h2 className="panel__title">{tr('General')}</h2>
      <label className="textfield language-field">
        <span className="field__label">{tr('Language')}</span>
        <select
          value={settings.appearance.language}
          onChange={(e) =>
            void updateSettings({
              appearance: { language: e.target.value as Settings['appearance']['language'] },
            })
          }
        >
          <option value="system">
            {tr('Follow my system')}
            {systemName ? ` (${systemName})` : ''}
          </option>
          {LANGUAGES.map((l) => (
            // Each language in its own name, so whoever reads it can find theirs.
            <option key={l.id} value={l.id} lang={l.id} title={l.english}>
              {l.name}
            </option>
          ))}
        </select>
        {current.beta && (
          <span className="muted small">{tr('Partly translated: some screens are still in English.')}</span>
        )}
      </label>
      <fieldset className="field">
        <legend className="field__label">{tr('Motion')}</legend>
        <div className="choice-grid">
          {options.map((o) => (
            <label
              key={o.id}
              className={`choice ${settings.appearance.motion === o.id ? 'is-selected' : ''}`}
            >
              <input
                type="radio"
                name="motion"
                value={o.id}
                checked={settings.appearance.motion === o.id}
                onChange={() => void updateSettings({ appearance: { motion: o.id } })}
              />
              <span className="choice__name">{o.name}</span>
              <span className="choice__text">{o.text}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {/* Phones size River with the phone's own display and text size settings; this zooms the window. */}
      {!phone && (
        <label className="field slider-field">
          <span className="field__label">
            {tr('Interface size')}{' '}
            <span className="muted small">{Math.round(settings.appearance.zoom * 100)}%</span>
          </span>
          <input
            type="range"
            min={0.7}
            max={1.6}
            step={0.05}
            value={settings.appearance.zoom}
            aria-label={tr('Interface size')}
            onChange={(e) => void updateSettings({ appearance: { zoom: Number(e.target.value) } })}
          />
          <span className="muted small">
            {tr('Shortcut: {key}= bigger, {key}− smaller, {key}0 normal.', { key: mac ? '⌘' : 'Ctrl+' })}
          </span>
        </label>
      )}
      <label className="field slider-field">
        <span className="field__label">
          {tr('Message text size')} <span className="muted small">{settings.appearance.fontSize}px</span>
        </span>
        <input
          type="range"
          min={12}
          max={22}
          step={1}
          value={settings.appearance.fontSize}
          aria-label={tr('Message text size')}
          onChange={(e) => void updateSettings({ appearance: { fontSize: Number(e.target.value) } })}
        />
        <span className="msg__text slider-field__preview" style={{ fontSize: settings.appearance.fontSize }}>
          {tr('The quick brown fox says hi 👋')}
        </span>
      </label>
      <fieldset className="field">
        <legend className="field__label">{tr('Clock')}</legend>
        <div className="choice-grid">
          {(
            [
              ['system', msg('Automatic'), msg('Follow your language settings.')],
              ['12h', msg('12-hour'), '2:05 PM'],
              ['24h', msg('24-hour'), '14:05'],
            ] as const
          ).map(([id, name, text]) => (
            <label key={id} className={`choice ${settings.appearance.clock === id ? 'is-selected' : ''}`}>
              <input
                type="radio"
                name="clock"
                value={id}
                checked={settings.appearance.clock === id}
                onChange={() => void updateSettings({ appearance: { clock: id } })}
              />
              <span className="choice__name">{tr(name)}</span>
              <span className="choice__text">{tr(text)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend className="field__label">{tr('Contrast')}</legend>
        <div className="choice-grid">
          {(
            [
              [
                'system',
                msg('Follow system'),
                msg('Use high contrast when your system asks for more contrast.'),
              ],
              ['normal', msg('Standard'), msg('River’s usual colours.')],
              [
                'high',
                msg('High contrast'),
                msg('Brighter text, clearer borders and strong focus outlines.'),
              ],
            ] as const
          ).map(([id, name, text]) => (
            <label key={id} className={`choice ${settings.appearance.contrast === id ? 'is-selected' : ''}`}>
              <input
                type="radio"
                name="contrast"
                value={id}
                checked={settings.appearance.contrast === id}
                onChange={() => void updateSettings({ appearance: { contrast: id } })}
              />
              <span className="choice__name">{tr(name)}</span>
              <span className="choice__text">{tr(text)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Toggle
        label={tr('Add previews to links I send')}
        hint={tr(
          'River fetches the page from your computer (the site sees your address) and adds its title and description to your encrypted message. People reading it never contact the site.',
        )}
        checked={settings.appearance.linkPreviews}
        onChange={(linkPreviews) => void updateSettings({ appearance: { linkPreviews } })}
      />
      <fieldset className="field">
        <legend className="field__label">{tr('Message density')}</legend>
        <div className="choice-grid">
          {(
            [
              ['cozy', msg('Cozy'), msg('Larger avatars and more space between messages.')],
              ['compact', msg('Compact'), msg('More messages on screen: small avatars, tight spacing.')],
            ] as const
          ).map(([id, name, text]) => (
            <label key={id} className={`choice ${settings.appearance.density === id ? 'is-selected' : ''}`}>
              <input
                type="radio"
                name="density"
                value={id}
                checked={settings.appearance.density === id}
                onChange={() => void updateSettings({ appearance: { density: id } })}
              />
              <span className="choice__name">{tr(name)}</span>
              <span className="choice__text">{tr(text)}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function SystemPanel({ settings }: { settings: Settings }): ReactElement {
  const updateSettings = useRiver((s) => s.updateSettings);
  const platform = useRiver((r) => r.info?.platform);
  const phone = isPhone(platform);
  const linux = platform === 'linux';
  return (
    <div className="panel">
      <h2 className="panel__title">{tr('Privacy')}</h2>
      <Toggle
        label={tr('Read receipts')}
        hint={tr(
          'Let people see when you have read their direct messages. If you turn this off, you will not see when they read yours either.',
        )}
        checked={settings.presence.readReceipts}
        onChange={(v) => void updateSettings({ presence: { readReceipts: v } })}
      />
      <Toggle
        label={tr('Typing indicators')}
        hint={tr(
          'Show “typing…” while you write. If you turn this off, you will not see others typing either.',
        )}
        checked={settings.presence.typingIndicators}
        onChange={(v) => void updateSettings({ presence: { typingIndicators: v } })}
      />
      {!linux && platform !== 'ios' && (
        <Toggle
          label={tr('Screen security')}
          hint={
            phone
              ? tr('Block screenshots and screen recording of River, and show it blank in the app switcher.')
              : tr(
                  'Keep River out of screenshots and screen recordings (including screen sharing of this window).',
                )
          }
          checked={settings.system.screenSecurity}
          onChange={(v) => void updateSettings({ system: { screenSecurity: v } })}
        />
      )}
      <PrivacySettings settings={settings} phone={phone} />
      <h2 className="panel__title" id="settings-system">
        {tr('System')}
      </h2>
      {phone && platform === 'android' && (
        <>
          <Toggle
            label={tr('Stay connected')}
            hint={`${tr(
              'New messages and calls notify you even when River is closed. Android shows a quiet “River is connected” notification while it runs, and it uses some battery. River does not use Google’s push service.',
            )} ${BATTERY_WHY}`}
            checked={settings.system.background}
            onChange={(v) =>
              void updateSettings({ system: { background: v, backgroundAsked: true } }).then(async () => {
                // The section below shows the same status, read again now (2.11.2).
                if (!v) {
                  void refreshPhoneStatus();
                  return;
                }
                // Turned on: Android asks to let River run in the background (explained above).
                const status = await refreshAfterStayConnected();
                if (status && !status.batteryExempt) {
                  await window.river.app.phoneFix('battery').catch(() => null);
                  void refreshPhoneStatus();
                }
              })
            }
          />
          <Toggle
            label={tr('Light up the screen for new messages')}
            hint={tr(
              'When the screen is off, a new message turns it on for a few seconds. Not during Do Not Disturb, and not for messages sent without sound.',
            )}
            checked={settings.system.wakeScreen}
            onChange={(v) => void updateSettings({ system: { wakeScreen: v } })}
          />
          <PhoneCallsSection />
        </>
      )}
      {platform === 'ios' && (
        <p className="muted small">
          {tr(
            'On iPhone, River gets messages and calls only while it is open or was just in use. River does not use Apple’s push service yet (it needs a paid Apple developer account), so once iOS pauses River, new messages and calls wait until you open it again. Calls do not ring while River is closed.',
          )}
        </p>
      )}
      {phone ? (
        <Toggle
          label={tr('Lock River')}
          hint={tr(
            'Ask for your fingerprint, face or screen lock whenever River opens. Needs a screen lock on this phone. Your messages are encrypted on the phone either way; this keeps out someone holding your unlocked phone.',
          )}
          checked={settings.system.appLock}
          onChange={(v) => void updateSettings({ system: { appLock: v } })}
        />
      ) : (
        <>
          {/* River cannot add itself to Linux desktops' autostart, so it does not offer to. */}
          {!linux && (
            <Toggle
              label={tr('Start River when I sign in')}
              hint={tr('River opens quietly in the tray, so you get messages and calls right away.')}
              checked={settings.system.startAtLogin}
              onChange={(v) => void updateSettings({ system: { startAtLogin: v } })}
            />
          )}
          <Toggle
            label={tr('Keep River running when I close the window')}
            hint={tr("River stays in the tray. Quit it from the tray icon's menu.")}
            checked={settings.system.closeToTray}
            onChange={(v) => void updateSettings({ system: { closeToTray: v } })}
          />
        </>
      )}
      <ConnectionCheck />
    </div>
  );
}

function HostingTab(): ReactElement {
  return (
    <div className="panel">
      <h2 className="panel__title">{tr('Host on this PC')}</h2>
      <HostingPanel />
    </div>
  );
}

function NotificationsPanel({ settings }: { settings: Settings }): ReactElement {
  const updateSettings = useRiver((s) => s.updateSettings);
  const options: Array<{ id: Settings['notifications']['preview']; name: string; text: string }> = [
    { id: 'none', name: tr('Hidden'), text: tr('“New River message” — no name, no content.') },
    { id: 'sender', name: tr('Sender only'), text: tr('“New message from Alex”.') },
    { id: 'full', name: tr('Sender and message'), text: tr('Shows a preview of the message.') },
  ];
  return (
    <div className="panel">
      <fieldset className="field">
        <legend className="field__label">{tr('Notification preview')}</legend>
        <div className="choice-grid">
          {options.map((o) => (
            <label
              key={o.id}
              className={`choice ${settings.notifications.preview === o.id ? 'is-selected' : ''}`}
            >
              <input
                type="radio"
                name="preview"
                value={o.id}
                checked={settings.notifications.preview === o.id}
                onChange={() => void updateSettings({ notifications: { preview: o.id } })}
              />
              <span className="choice__name">{o.name}</span>
              <span className="choice__text">{o.text}</span>
            </label>
          ))}
        </div>
        <p className="muted small">
          {tr('Notification text is shown by your operating system and may be visible on your lock screen.')}
        </p>
      </fieldset>
      <QuietHours settings={settings} />
      <p className="muted small">
        {phoneShellActive()
          ? tr(
              'Long-press a chat, or open a community’s menu, to mute it for an hour, 8 hours, a day or until you turn it back on, to choose All messages, Only @mentions or Nothing just for it, and to give it a sound of its own. A community can also ignore @everyone and @here. Mentions of you and replies to you still come through a muted chat or channel unless it is set to Nothing. Do Not Disturb (your status in Settings) silences everything except your own sounds.',
            )
          : tr(
              'Right-click a chat, community, category or channel to mute it for an hour, 8 hours, a day or until you turn it back on, to choose All messages, Only @mentions or Nothing just for it, and to give it a sound of its own. A community can also ignore @everyone and @here. Mentions of you and replies to you still come through a muted chat or channel unless it is set to Nothing. Do Not Disturb (click your name) silences everything except your own sounds.',
            )}
      </p>
      <div className="sound-group__previews" aria-label={tr('Chat sounds')}>
        {NOTIFY_TONES.map((tone) => (
          <button
            key={tone}
            className="chip chip--button"
            aria-label={`Play the ${NOTIFY_SOUND_LABELS[tone]} sound`}
            onClick={() => playNotifySound(tone, 'message', true)}
          >
            ▶ {NOTIFY_SOUND_LABELS[tone]}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuietHours({ settings }: { settings: Settings }): ReactElement {
  const updateSettings = useRiver((s) => s.updateSettings);
  const q = settings.notifications.quietHours;
  const save = (patch: Partial<typeof q>): void =>
    void updateSettings({ notifications: { quietHours: { ...q, ...patch } } });
  const valid = (v: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  return (
    <div className="field quiet-hours">
      <Toggle
        label={tr('Quiet hours')}
        hint={
          inQuietHours(q)
            ? tr('On now: no pop-ups or notification sounds until it ends.')
            : tr('Every day, no pop-ups or notification sounds between these times.')
        }
        checked={q.enabled}
        onChange={(enabled) => save({ enabled })}
      />
      {q.enabled && (
        <div className="quiet-hours__times">
          <label>
            {tr('From')}{' '}
            <input
              type="time"
              value={q.start}
              onChange={(e) => valid(e.target.value) && save({ start: e.target.value })}
            />
          </label>
          <label>
            {tr('to')}{' '}
            <input
              type="time"
              value={q.end}
              onChange={(e) => valid(e.target.value) && save({ end: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function AboutPanel(): ReactElement {
  const info = useRiver((s) => s.info);
  const rows: Array<[string, ReactNode]> = [
    [tr('Version'), <span className="mono">{info?.version}</span>],
    [tr('Channel'), info?.channel],
    [tr('Platform'), `${info?.platform ?? ''} ${info?.arch ?? ''}`],
    ['Electron', <span className="mono">{info?.versions.electron}</span>],
    ['Chromium', <span className="mono">{info?.versions.chrome}</span>],
    ['Node.js', <span className="mono">{info?.versions.node}</span>],
    [tr('License'), 'GNU AGPL v3.0'],
  ];
  return (
    <div className="panel">
      <h2 className="panel__title">{tr('About River')}</h2>
      <p className="muted">
        {tr(
          'River is free, open-source software. Anyone can read, audit and build the code that runs on your device.',
        )}
      </p>
      <dl className="about-grid">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="linkrow">
        <button className="btn btn--link" onClick={() => void window.river.links.open('source')}>
          {tr('Source code')} <ExternalIcon size={14} />
        </button>
        <button className="btn btn--link" onClick={() => void window.river.links.open('releases')}>
          {tr('Releases')} <ExternalIcon size={14} />
        </button>
        <button className="btn btn--link" onClick={() => void window.river.links.open('issues')}>
          {tr('Report a problem')} <ExternalIcon size={14} />
        </button>
        <button className="btn btn--link" onClick={() => void window.river.links.open('license')}>
          {tr('License')} <ExternalIcon size={14} />
        </button>
      </div>
    </div>
  );
}

function Toggle(props: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(v: boolean): void;
}): ReactElement {
  return (
    <label className="toggle">
      <span>
        <span className="toggle__label">{props.label}</span>
        {props.hint && <span className="toggle__hint">{props.hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
    </label>
  );
}
