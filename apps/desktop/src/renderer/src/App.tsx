import { useEffect, useState, type ReactElement } from 'react';
import { QuickSwitcher } from './components/QuickSwitcher.tsx';
import { RiverMark } from './components/RiverMark.tsx';
import { SECTION_ICONS, LockIcon } from './components/Icons.tsx';
import { LockScreen } from './components/LockScreen.tsx';
import { Onboarding } from './components/Onboarding.tsx';
import { UpdateToast } from './components/UpdateToast.tsx';
import { PLANNED } from './features.ts';
import { HomePage } from './pages/HomePage.tsx';
import { CallAudio } from './community/ui/Voice.tsx';
import { CommunitiesPage, Overlays, VoiceHotkeys } from './pages/CommunitiesPage.tsx';
import { MessagesPage } from './pages/MessagesPage.tsx';
import { SocialPage } from './pages/SocialPage.tsx';
import { CallsPage } from './pages/CallsPage.tsx';
import { FriendsPage } from './pages/FriendsPage.tsx';
import { FilesPage } from './pages/FilesPage.tsx';
import { onSocialChanged } from './social/store.ts';
import { totalUnread, useDm } from './dm/store.ts';
import { handleCallEvent } from './dm/call.ts';
import { useCommunity } from './community/store.ts';
import { PlannedPage } from './pages/PlannedPage.tsx';
import { SecurityPage } from './pages/SecurityPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { useHostStatus } from './components/HostingPanel.tsx';
import { SECTIONS, useRiver, type Section } from './store.ts';

const LABELS: Record<Section, string> = {
  home: 'Home',
  messages: 'Messages',
  communities: 'Communities',
  social: 'Social',
  calls: 'Calls',
  files: 'Files',
  contacts: 'Friends',
  admin: 'Admin',
  security: 'Security',
  settings: 'Settings',
};

const PRIMARY = SECTIONS.filter((s) => s !== 'admin' && s !== 'security' && s !== 'settings');

function useSystemReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function App(): ReactElement {
  const {
    section,
    navigate,
    load,
    setUpdate,
    setStorage,
    setAccount,
    account,
    settings,
    info,
    loadError,
    storage,
    onboarding,
    identityCreated,
    finishOnboarding,
  } = useRiver();
  const systemReduced = useSystemReducedMotion();
  // The PC that hosts River's server gets the operator's Admin section.
  const operator = useHostStatus()?.enabled ?? false;
  const motion = settings?.appearance.motion ?? 'system';
  const reducedMotion = motion === 'reduced' || (motion === 'system' && systemReduced);

  useEffect(() => {
    void load();
    const offUpdates = window.river.updates.onStatus(setUpdate);
    const offStorage = window.river.storage.onStatus((s) => void setStorage(s));
    const offAccount = window.river.account.onStatus((s) => void setAccount(s));
    const offCommunity = window.river.community.onEvent((e) => useCommunity.getState().handle(e));
    const offDm = window.river.dm.onEvent((e) =>
      e.t === 'call' ? handleCallEvent(e) : useDm.getState().handle(e),
    );
    void useDm.getState().load();
    const offSocial = window.river.social.onEvent(() => onSocialChanged());
    return () => {
      offUpdates();
      offStorage();
      offAccount();
      offCommunity();
      offDm();
      offSocial();
    };
  }, [load, setUpdate, setStorage, setAccount]);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'full';
  }, [reducedMotion]);

  const density = useRiver((r) => r.settings?.appearance.density ?? 'cozy');
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  useEffect(() => {
    if (info) document.documentElement.dataset.platform = info.platform;
  }, [info]);

  const planned = PLANNED[section];

  if (storage.state === 'setup-required' || storage.state === 'locked' || storage.state === 'error') {
    return (
      <>
        <div className="backdrop" aria-hidden="true" />
        <LockScreen status={storage} />
      </>
    );
  }

  if (onboarding) {
    return (
      <>
        <div className="backdrop" aria-hidden="true" />
        <Onboarding
          reducedMotion={reducedMotion}
          onCreated={(id) => void identityCreated(id)}
          onFinished={finishOnboarding}
        />
      </>
    );
  }

  return (
    <div className="shell">
      <div className="backdrop" aria-hidden="true" />
      <nav className="rail" aria-label="River">
        <div className="rail__brand">
          <RiverMark size={38} />
        </div>
        <ul className="rail__list">
          {PRIMARY.map((s) => (
            <RailItem key={s} section={s} active={section === s} onSelect={navigate} />
          ))}
        </ul>
        <ul className="rail__list rail__list--bottom">
          {(operator
            ? (['admin', 'security', 'settings'] as const)
            : (['security', 'settings'] as const)
          ).map((s) => (
            <RailItem key={s} section={s} active={section === s} onSelect={navigate} />
          ))}
        </ul>
      </nav>

      <div className="main">
        <header className="topbar">
          <span className="topbar__title">{LABELS[section]}</span>
          {account.state === 'registered' ? (
            <span className={`topbar__pill is-${account.connection}`} title="Your River connection">
              <span
                className={`status-dot status-dot--${account.connection === 'online' ? 'active' : account.connection === 'error' ? 'warning' : 'inactive'}`}
              />
              {account.connection === 'online'
                ? 'Online'
                : account.connection === 'connecting'
                  ? 'Connecting…'
                  : 'Offline — messages wait and send by themselves'}
            </span>
          ) : account.waiting ? (
            <span
              className="topbar__pill"
              title="River creates your account as soon as its server is reachable"
            >
              <span className="status-dot status-dot--warning" /> Setting up your account…
            </span>
          ) : (
            <span className="topbar__pill" title="No River account yet">
              <LockIcon size={13} /> Local only · no account yet
            </span>
          )}
        </header>
        <main
          className={`content ${section === 'communities' || section === 'messages' ? 'content--full' : ''}`}
          key={section}
        >
          <UsernamePrompt />
          {loadError && (
            <div className="glass card card--error" role="alert">
              River could not load its settings: {loadError}
            </div>
          )}
          {section === 'home' && <HomePage reducedMotion={reducedMotion} />}
          {section === 'security' && <SecurityPage />}
          {section === 'communities' && <CommunitiesPage />}
          {section === 'messages' && <MessagesPage />}
          {section === 'social' && <SocialPage />}
          {section === 'calls' && <CallsPage />}
          {section === 'files' && <FilesPage />}
          {section === 'contacts' && <FriendsPage />}
          {section === 'settings' && <SettingsPage />}
          {section === 'admin' && <AdminPage />}
          {planned && <PlannedPage section={section} feature={planned} />}
        </main>
      </div>
      <UpdateToast />
      <CallAudio />
      <VoiceHotkeys />
      <Overlays />
      <QuickSwitcher />
    </div>
  );
}

function RailItem(props: { section: Section; active: boolean; onSelect(s: Section): void }): ReactElement {
  const Icon = SECTION_ICONS[props.section];
  const dmUnread = useDm((d) => totalUnread(d.conversations));
  const communityMentions = useCommunity((c) => Object.values(c.mentions).reduce((n, v) => n + v, 0));
  const badge =
    props.section === 'messages' ? dmUnread : props.section === 'communities' ? communityMentions : 0;
  return (
    <li>
      <button
        className={`rail__item ${props.active ? 'is-active' : ''}`}
        aria-current={props.active ? 'page' : undefined}
        onClick={() => props.onSelect(props.section)}
      >
        <Icon size={22} />
        <span className="rail__label">{LABELS[props.section]}</span>
        {badge > 0 && (
          <span key={badge} className="badge badge--mention rail__badge">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
    </li>
  );
}

/** Nudges people who have an account but no @username yet to choose one. */
function UsernamePrompt(): ReactElement | null {
  const account = useRiver((r) => r.account);
  const setAccount = useRiver((r) => r.setAccount);
  const navigate = useRiver((r) => r.navigate);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || account.state !== 'registered' || account.connection !== 'online' || account.username) {
    return null;
  }
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await window.river.account.setUsername(value.trim());
    setBusy(false);
    if (res.ok) {
      setAccount(res.value);
      setDismissed(true);
    } else setError(res.message);
  };
  return (
    <div className="username-prompt glass" role="region" aria-label="Choose a username">
      <div>
        <strong>Pick a username</strong>
        <p className="muted small">It's how friends add you — like @alex. You can change it later.</p>
      </div>
      <div className="username-row">
        <div className="textfield username-field">
          <span className="username-field__at" aria-hidden="true">
            @
          </span>
          <input
            value={value.replace(/^@/, '')}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={32}
            aria-label="Username"
          />
        </div>
        <button
          className="btn btn--primary btn--small"
          disabled={busy || value.trim().length < 3}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          className="btn btn--link btn--small"
          onClick={() => {
            setDismissed(true);
            navigate('settings');
          }}
        >
          Later
        </button>
      </div>
      {error && <p className="field__error">{error}</p>}
    </div>
  );
}
