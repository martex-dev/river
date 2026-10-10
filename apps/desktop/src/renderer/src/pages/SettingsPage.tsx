import { useState, type ReactElement, type ReactNode } from 'react';
import { BackupPanel } from '../components/BackupPanel.tsx';
import { HostingPanel, useHostStatus } from '../components/HostingPanel.tsx';
import type { ReleaseChannel } from '@river/release/channels';
import type { AccountStatus, ServerCheckResult, UpdateStatus } from '../../../shared/ipc.ts';
import { serverUrlSchema, type Settings } from '../../../shared/settings.ts';
import { ExternalIcon } from '../components/Icons.tsx';
import { useRiver } from '../store.ts';
import { play } from '../community/sound.ts';

const TABS = [
  'updates',
  'server',
  'hosting',
  'backup',
  'appearance',
  'notifications',
  'system',
  'about',
] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  updates: 'Updates',
  hosting: 'Hosting',
  server: 'Account',
  backup: 'Backup',
  appearance: 'Appearance',
  notifications: 'Notifications',
  system: 'System',
  about: 'About',
};

const CHANNELS: Array<{ id: ReleaseChannel; name: string; text: string }> = [
  { id: 'stable', name: 'Stable', text: 'Tested releases. Recommended for everyone.' },
  { id: 'beta', name: 'Beta', text: 'New features a little earlier. Occasional rough edges.' },
  { id: 'nightly', name: 'Nightly', text: 'Development builds. May break. For testers only.' },
];

export function describeUpdate(status: UpdateStatus): string {
  switch (status.state) {
    case 'disabled':
      return status.reason;
    case 'idle':
      return 'Not checked yet.';
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return `River is up to date. Last checked ${new Date(status.checkedAt).toLocaleTimeString()}.`;
    case 'available':
      return `River ${status.version} is available.`;
    case 'downloading':
      return `Downloading River ${status.version}… ${status.percent}%`;
    case 'verifying':
      return `Verifying the signature of River ${status.version}…`;
    case 'ready':
      return `River ${status.version} is downloaded and verified. Restart to finish updating.`;
    case 'manual':
      return `River ${status.version} is available. On macOS, download it from the release page.`;
    case 'error':
      return status.message;
  }
}

export function SettingsPage(): ReactElement {
  const [tab, setTab] = useState<Tab>('updates');
  const settings = useRiver((s) => s.settings);
  const host = useHostStatus();
  const [askedForHosting, setAskedForHosting] = useState(false);
  // Hosting is for whoever runs a server; everyone else never sees it.
  const tabs = TABS.filter(
    (t) => t !== 'hosting' || askedForHosting || host?.enabled || (host?.legacy ?? 'none') !== 'none',
  );

  return (
    <div className="page settings">
      <header className="page__header">
        <div className="eyebrow">Settings</div>
        <h1 className="page__title">Make River yours</h1>
      </header>
      <div className="settings__layout">
        <nav className="settings__tabs glass" aria-label="Settings sections">
          {tabs.map((t) => (
            <button
              key={t}
              className={`settings__tab ${tab === t ? 'is-active' : ''}`}
              aria-current={tab === t ? 'page' : undefined}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </nav>
        <div className="settings__panel glass">
          {settings ? (
            <>
              {tab === 'updates' && <UpdatesPanel settings={settings} />}
              {tab === 'hosting' && <HostingTab />}
              {tab === 'server' && (
                <>
                  <ServerPanel settings={settings} />
                  {!tabs.includes('hosting') && (
                    <button
                      className="btn btn--link"
                      onClick={() => {
                        setAskedForHosting(true);
                        setTab('hosting');
                      }}
                    >
                      Run a River server on this PC…
                    </button>
                  )}
                </>
              )}
              {tab === 'backup' && <BackupPanel />}
              {tab === 'appearance' && <AppearancePanel settings={settings} />}
              {tab === 'notifications' && <NotificationsPanel settings={settings} />}
              {tab === 'system' && <SystemPanel settings={settings} />}
              {tab === 'about' && <AboutPanel />}
            </>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </div>
      </div>
    </div>
  );
}

function UpdatesPanel({ settings }: { settings: Settings }): ReactElement {
  const info = useRiver((s) => s.info);
  const update = useRiver((s) => s.update);
  const updateSettings = useRiver((s) => s.updateSettings);
  const check = useRiver((s) => s.checkForUpdates);
  const busy = ['checking', 'downloading', 'verifying'].includes(update.state);

  return (
    <div className="panel">
      <h2 className="panel__title">Updates</h2>
      <div className="update-status" data-state={update.state} role="status" aria-live="polite">
        <div>
          <div className="update-status__version">
            River <span className="mono">{info?.version ?? '…'}</span>
            <span className="chip">{info?.channel ?? 'stable'}</span>
          </div>
          <p className="muted">{describeUpdate(update)}</p>
          {update.state === 'downloading' && (
            <div className="progress" aria-hidden="true">
              <div className="progress__bar" style={{ width: `${update.percent}%` }} />
            </div>
          )}
        </div>
        <div className="update-status__actions">
          {update.state === 'ready' ? (
            <button className="btn btn--primary" onClick={() => void window.river.updates.install()}>
              Restart and update
            </button>
          ) : update.state === 'manual' ? (
            <button className="btn btn--primary" onClick={() => void window.river.updates.openDownloadPage()}>
              Open download page <ExternalIcon size={14} />
            </button>
          ) : (
            <button
              className="btn btn--ghost"
              disabled={busy || update.state === 'disabled'}
              onClick={() => void check()}
            >
              Check now
            </button>
          )}
        </div>
      </div>

      <fieldset className="field">
        <legend className="field__label">Release channel</legend>
        <div className="choice-grid">
          {CHANNELS.map((c) => (
            <label key={c.id} className={`choice ${settings.updates.channel === c.id ? 'is-selected' : ''}`}>
              <input
                type="radio"
                name="channel"
                value={c.id}
                checked={settings.updates.channel === c.id}
                onChange={() => void updateSettings({ updates: { channel: c.id } })}
              />
              <span className="choice__name">{c.name}</span>
              <span className="choice__text">{c.text}</span>
            </label>
          ))}
        </div>
        {settings.updates.channel !== 'stable' && (
          <p className="warning-note">
            You will receive pre-release builds. They are signed like every release, but may contain bugs.
            Switching back to Stable takes effect at the next stable version newer than the one you have.
          </p>
        )}
      </fieldset>

      <Toggle
        label="Check for updates automatically"
        hint="Checks GitHub Releases about every four hours."
        checked={settings.updates.autoCheck}
        onChange={(v) => void updateSettings({ updates: { autoCheck: v } })}
      />
      <Toggle
        label="Download updates automatically"
        hint="Every download is verified against River’s release signature before it can be installed."
        checked={settings.updates.autoDownload}
        onChange={(v) => void updateSettings({ updates: { autoDownload: v } })}
      />
      <Toggle
        label="Install verified updates when River quits"
        checked={settings.updates.installOnQuit}
        onChange={(v) => void updateSettings({ updates: { installOnQuit: v } })}
      />
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
  const save = async (): Promise<void> => {
    setBusy(true);
    setMsg(null);
    const res = await window.river.account.setUsername(value.trim());
    setBusy(false);
    if (res.ok) {
      setAccount(res.value);
      const name = res.value.state === 'registered' ? (res.value.username ?? value.trim()) : value.trim();
      setMsg({ ok: true, text: `Saved. People can add you as @${name}.` });
    } else {
      play('error');
      setMsg({ ok: false, text: res.message });
    }
  };
  const changed = value.trim().replace(/^@/, '') !== (account.username ?? '');
  return (
    <div className="field">
      <label className="field__label" htmlFor="username">
        Username — how people add you
      </label>
      <div className="username-row">
        <div className="textfield username-field">
          <span className="username-field__at" aria-hidden="true">
            @
          </span>
          <input
            id="username"
            value={value.replace(/^@/, '')}
            onChange={(e) => {
              setValue(e.target.value);
              setMsg(null);
            }}
            placeholder="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={32}
          />
        </div>
        <button
          className="btn btn--primary btn--small"
          disabled={busy || !changed || value.trim().length < 3}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : account.username ? 'Change' : 'Set username'}
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
  connecting: 'Connecting…',
  online: 'Connected',
  offline: 'Offline',
  error: 'Problem',
} as const;

function AccountPanel({
  account,
}: {
  account: Extract<AccountStatus, { state: 'registered' }>;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  return (
    <div className="panel">
      <h2 className="panel__title">Account</h2>
      <UsernameEditor account={account} />
      <div className={`account-card is-${account.connection}`} role="status">
        <div className="account-card__head">
          <strong>Your account</strong>
          <span className={`chip chip--${account.connection}`}>{CONNECTION_LABEL[account.connection]}</span>
        </div>
        <dl className="about-grid">
          <div>
            <dt>River ID</dt>
            <dd className="mono small">{account.riverId}</dd>
          </div>
          <div>
            <dt>This device</dt>
            <dd>
              Device {account.deviceId} of {account.devices}
            </dd>
          </div>
          <div>
            <dt>Device list</dt>
            <dd>Signed by your identity · v{account.listVersion}</dd>
          </div>
          <div>
            <dt>Server address</dt>
            <dd className="mono small">{account.serverUrl}</dd>
          </div>
        </dl>
        {account.message && (
          <p className={account.connection === 'error' ? 'field__error' : 'muted small'}>{account.message}</p>
        )}
      </div>
      <div className="button-row">
        <button
          className="btn btn--ghost"
          disabled={busy || account.connection === 'connecting'}
          onClick={() => {
            setBusy(true);
            void window.river.account.connect().finally(() => setBusy(false));
          }}
        >
          Reconnect
        </button>
      </div>
      <p className="muted small">
        The server knows your River ID, your public keys and which devices you use — never your messages.
        Moving to another server and deleting your account arrive in a later release.
      </p>
    </div>
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
  const options: Array<{ id: Settings['appearance']['motion']; name: string; text: string }> = [
    { id: 'system', name: 'Follow system', text: 'Use your operating system’s reduced-motion setting.' },
    { id: 'reduced', name: 'Reduced', text: 'Minimal animation everywhere.' },
    { id: 'full', name: 'Full', text: 'All animations, including the network field.' },
  ];
  return (
    <div className="panel">
      <h2 className="panel__title">Appearance</h2>
      <fieldset className="field">
        <legend className="field__label">Motion</legend>
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
      <fieldset className="field">
        <legend className="field__label">Message density</legend>
        <div className="choice-grid">
          {(
            [
              ['cozy', 'Cozy', 'Larger avatars and more space between messages.'],
              ['compact', 'Compact', 'More messages on screen: small avatars, tight spacing.'],
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
              <span className="choice__name">{name}</span>
              <span className="choice__text">{text}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function SystemPanel({ settings }: { settings: Settings }): ReactElement {
  const updateSettings = useRiver((s) => s.updateSettings);
  return (
    <div className="panel">
      <h2 className="panel__title">System</h2>
      <Toggle
        label="Start River when I sign in"
        hint="River opens quietly in the tray, so you get messages and calls right away."
        checked={settings.system.startAtLogin}
        onChange={(v) => void updateSettings({ system: { startAtLogin: v } })}
      />
      <Toggle
        label="Keep River running when I close the window"
        hint="River stays in the tray. Quit it from the tray icon's menu."
        checked={settings.system.closeToTray}
        onChange={(v) => void updateSettings({ system: { closeToTray: v } })}
      />
    </div>
  );
}

function HostingTab(): ReactElement {
  return (
    <div className="panel">
      <h2 className="panel__title">Host on this PC</h2>
      <HostingPanel />
    </div>
  );
}

function NotificationsPanel({ settings }: { settings: Settings }): ReactElement {
  const updateSettings = useRiver((s) => s.updateSettings);
  const options: Array<{ id: Settings['notifications']['preview']; name: string; text: string }> = [
    { id: 'none', name: 'Hidden', text: '“New River message” — no name, no content.' },
    { id: 'sender', name: 'Sender only', text: '“New message from Alex”.' },
    { id: 'full', name: 'Sender and message', text: 'Shows a preview of the message.' },
  ];
  return (
    <div className="panel">
      <h2 className="panel__title">Notifications</h2>
      <fieldset className="field">
        <legend className="field__label">Notification preview</legend>
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
      </fieldset>
      <p className="muted small">Takes effect when messaging arrives in River 0.2.</p>
    </div>
  );
}

function AboutPanel(): ReactElement {
  const info = useRiver((s) => s.info);
  const rows: Array<[string, ReactNode]> = [
    ['Version', <span className="mono">{info?.version}</span>],
    ['Channel', info?.channel],
    ['Platform', `${info?.platform ?? ''} ${info?.arch ?? ''}`],
    ['Electron', <span className="mono">{info?.versions.electron}</span>],
    ['Chromium', <span className="mono">{info?.versions.chrome}</span>],
    ['Node.js', <span className="mono">{info?.versions.node}</span>],
    ['License', 'GNU AGPL v3.0'],
  ];
  return (
    <div className="panel">
      <h2 className="panel__title">About River</h2>
      <p className="muted">
        River is free, open-source software. Anyone can read, audit and build the code that runs on your
        device.
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
          Source code <ExternalIcon size={14} />
        </button>
        <button className="btn btn--link" onClick={() => void window.river.links.open('releases')}>
          Releases <ExternalIcon size={14} />
        </button>
        <button className="btn btn--link" onClick={() => void window.river.links.open('issues')}>
          Report a problem <ExternalIcon size={14} />
        </button>
        <button className="btn btn--link" onClick={() => void window.river.links.open('license')}>
          License <ExternalIcon size={14} />
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
