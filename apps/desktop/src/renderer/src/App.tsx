import { WhatsNew } from './components/WhatsNew.tsx';
import { StayConnectedPrompt } from './components/PhoneReachability.tsx';
import { ShareSheet } from './components/ShareSheet.tsx';
import { useEffect, useState, type ReactElement } from 'react';
import { QuickSwitcher } from './components/QuickSwitcher.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { startNavHistory } from './nav-history.ts';
import { useDesignEngine } from './appearance/use-design.ts';
import { TryBar } from './appearance/TryBar.tsx';
import { SetupCards } from './components/SetupCards.tsx';
import { resolveLanguage, useT } from './i18n.ts';
import { RiverMark } from './components/RiverMark.tsx';
import { AdminIcon, LockIcon } from './components/Icons.tsx';
import { HOME_SECTIONS, HomeSidebar } from './components/HomeSidebar.tsx';
import { LockScreen } from './components/LockScreen.tsx';
import { Onboarding } from './components/Onboarding.tsx';
import { UpdateToast } from './components/UpdateToast.tsx';
import { InAppBanner } from './notify/InAppBanner.tsx';
import { PLANNED } from './features.ts';
import { CallAudio } from './community/ui/Voice.tsx';
import { CommunitiesPage, Overlays, ServerRail, VoiceHotkeys } from './pages/CommunitiesPage.tsx';
import { MessagesPage } from './pages/MessagesPage.tsx';
import { SocialPage } from './pages/SocialPage.tsx';
import { CallsPage } from './pages/CallsPage.tsx';
import { FriendsPage } from './pages/FriendsPage.tsx';
import { FilesPage } from './pages/FilesPage.tsx';
import { onSocialChanged } from './social/store.ts';
import { totalUnread, useDm, windowTitle } from './dm/store.ts';
import { handleCallEvent, handlePhoneCall } from './dm/call.ts';
import { handleGroupCallEvent, handleRoomFull, handleRoster } from './dm/group-call.ts';
import { useCommunity } from './community/store.ts';
import { PlannedPage } from './pages/PlannedPage.tsx';
import { SettingsOverlay } from './pages/SettingsPage.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { useHostStatus } from './components/HostingPanel.tsx';
import { useRiver, type Section } from './store.ts';
import { isPhone } from '../../shared/platform.ts';
import { PhoneShell } from './phone/PhoneShell.tsx';

const LABELS: Record<Section, string> = {
  home: 'Friends',
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
  const t = useT();
  const {
    section,
    load,
    setUpdate,
    setStorage,
    setAccount,
    settings,
    info,
    loadError,
    storage,
    onboarding,
    identityCreated,
    finishOnboarding,
  } = useRiver();
  // Skins, themes and personalisation (1.0.45): applied to <html> on every change.
  useDesignEngine();
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
    // Settings River changed by itself (e.g. app lock turned off on a phone without a screen lock).
    const offSettings = window.river.settings.onChange((s) => void useRiver.getState().setSettings(s));
    const offCommunity = window.river.community.onEvent((e) => {
      // Group calls (2.18): who is in a call's room, and a full room.
      if (e.t === 'callRoster') handleRoster(e);
      else if (e.t === 'callRoomFull') handleRoomFull();
      else useCommunity.getState().handle(e);
    });
    const offRelay = window.river.voice.onRelay((from, payload) =>
      useCommunity.getState().call?.receiveRelay(from, payload),
    );
    const offDm = window.river.dm.onEvent((e) => {
      if (e.t === 'call') handleCallEvent(e);
      else if (e.t === 'gcall' || e.t === 'knock' || e.t === 'knockAnswer') handleGroupCallEvent(e);
      else useDm.getState().handle(e);
    });
    const offSocial = window.river.social.onEvent(() => onSocialChanged());
    // Android (2.11): a call answered or declined on the phone's own call screen.
    const offPhoneCall = window.river.app.onPhoneCall?.((call) => handlePhoneCall(call));
    return () => {
      offUpdates();
      offStorage();
      offAccount();
      offSettings();
      offCommunity();
      offRelay();
      offDm();
      offSocial();
      offPhoneCall?.();
    };
  }, [load, setUpdate, setStorage, setAccount]);

  // Conversations and communities load once the encrypted storage is open and you have an
  // identity: on first run and after unlocking, not only at start (when neither exists yet).
  const identityId = useRiver((r) => r.identity?.riverId ?? null);
  const storageOpen = storage.state === 'open';
  useEffect(() => {
    if (!storageOpen || !identityId) return;
    // Opened by an "Incoming call" notification: the call that is ringing shows at once.
    void useDm
      .getState()
      .load()
      .then(() => window.river.dm.action({ a: 'pendingCall' }))
      .then((ringing) => {
        if (!ringing.ok || !ringing.value) return;
        // Answered on Android's call screen (2.11): River opened for it and answers it now.
        const { answer, ...call } = ringing.value;
        if (answer) handlePhoneCall({ callId: call.callId, action: 'answer' });
        handleCallEvent(call);
      })
      .catch(() => undefined);
    // The rail shows your communities on every page, not only after opening Communities.
    void useCommunity.getState().load();
  }, [storageOpen, identityId]);

  useEffect(() => startNavHistory(), []);

  const languageSetting = useRiver((r) => r.settings?.appearance.language);
  useEffect(() => {
    document.documentElement.lang = resolveLanguage(languageSetting);
  }, [languageSetting]);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'full';
  }, [reducedMotion]);

  const density = useRiver((r) => r.settings?.appearance.density ?? 'cozy');
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  const fontSize = useRiver((r) => r.settings?.appearance.fontSize ?? 14);
  useEffect(() => {
    document.documentElement.style.setProperty('--chat-font-size', `${fontSize}px`);
  }, [fontSize]);

  // High contrast: chosen, or following the system's "increase contrast" preference.
  const contrast = useRiver((r) => r.settings?.appearance.contrast ?? 'system');
  useEffect(() => {
    const media = window.matchMedia('(prefers-contrast: more)');
    const apply = (): void => {
      const high = contrast === 'high' || (contrast === 'system' && media.matches);
      document.documentElement.dataset.contrast = high ? 'high' : 'normal';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [contrast]);

  useEffect(() => {
    if (info) document.documentElement.dataset.platform = info.platform;
  }, [info]);

  const planned = PLANNED[section];
  const settingsOpen = useRiver((r) => r.settingsTab !== null);
  const inHome = HOME_SECTIONS.includes(section);
  const community = useCommunity((c) => c.communities.find((x) => x.id === c.selectedCommunity));
  const communityStart = useRiver((r) => r.communityStart);
  const noCommunities = useCommunity((c) => c.loaded && c.communities.length === 0);
  // A crashed page is drawn again when you pick another community, channel or conversation.
  const viewKey = useCommunity((c) => `${c.selectedCommunity ?? ''}/${c.selectedChannel ?? ''}`);
  const dmPeer = useDm((d) => d.selected);
  const pageKey =
    section === 'communities'
      ? `communities:${viewKey}`
      : section === 'messages'
        ? `messages:${dmPeer ?? ''}`
        : section;
  // "Create or join a community" keeps the Home column, so you (and Settings) stay at the bottom left.
  const homeColumn = inHome || (section === 'communities' && (communityStart || noCommunities));

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
        <Onboarding onCreated={(id) => void identityCreated(id)} onFinished={finishOnboarding} />
      </>
    );
  }

  // 2.14: no skin chooser in the way any more. River starts with a good look for the platform
  // and offers "Pick your look" as one of the cards below (SetupCards).
  const notices = (
    <div className="notices">
      {info?.startupProblem && (
        <div className="glass card card--error" role="alert">
          {info.startupProblem}
        </div>
      )}
      <SetupCards />
      <WhatsNew />
      <StayConnectedPrompt />
      {loadError && (
        <div className="glass card card--error" role="alert">
          River could not load its settings: {loadError}
        </div>
      )}
    </div>
  );

  // Phones (2.12): Telegram and Instagram's layout over the same pages. Until River reports its
  // platform, the page's own (set by the phone app) decides, so a phone never shows the desktop.
  if (isPhone(info?.platform ?? document.documentElement.dataset.platform)) {
    return (
      <div className="shell shell--phone">
        <div className="backdrop" aria-hidden="true" />
        <PhoneShell notices={notices} />
        <SettingsOverlay />
        <TryBar />
        <UpdateToast />
        <InAppBanner />
        <CallAudio />
        <VoiceHotkeys />
        <Overlays />
        <QuickSwitcher />
        <ShareSheet />
      </div>
    );
  }

  const title = settingsOpen
    ? t('Settings')
    : section === 'communities'
      ? communityStart || !community
        ? t('Communities')
        : community.name
      : t(LABELS[section]);

  return (
    <div className="shell">
      <div className="backdrop" aria-hidden="true" />
      <header className="titlebar">
        <span className="titlebar__brand">
          <RiverMark size={16} />
          River
        </span>
        <span className="titlebar__title">{title}</span>
        <ConnectionPill />
      </header>
      <div className="workspace">
        <ServerRail home={<HomeButton />} {...(operator ? { bottom: <AdminButton /> } : {})} />
        {homeColumn && <HomeSidebar />}
        <main
          className={`content ${section === 'communities' || section === 'messages' ? 'content--full' : ''}`}
          key={section}
        >
          {notices}
          {/* One page crashing replaces only that page; the rail, calls and dialogs keep working. */}
          <ErrorBoundary area={t(LABELS[section])} resetKey={pageKey}>
            {(section === 'home' || section === 'contacts') && <FriendsPage />}
            {section === 'communities' && <CommunitiesPage />}
            {section === 'messages' && <MessagesPage />}
            {section === 'social' && <SocialPage />}
            {section === 'calls' && <CallsPage />}
            {section === 'files' && <FilesPage />}
            {section === 'admin' && <AdminPage />}
            {planned && <PlannedPage section={section} feature={planned} />}
          </ErrorBoundary>
        </main>
      </div>
      <SettingsOverlay />
      <TryBar />
      <UpdateToast />
      <InAppBanner />
      <CallAudio />
      <VoiceHotkeys />
      <Overlays />
      <QuickSwitcher />
      <ShareSheet />
    </div>
  );
}

/** Your connection to River, always in the title bar. */
function ConnectionPill(): ReactElement {
  const account = useRiver((r) => r.account);
  if (account.state === 'registered') {
    return (
      <span className={`topbar__pill is-${account.connection}`} title="Your River connection">
        <span
          className={`status-dot status-dot--${account.connection === 'online' ? 'active' : account.connection === 'error' ? 'warning' : 'inactive'}`}
        />
        {account.missing
          ? 'Your account needs to be set up again — Settings → Account'
          : account.connection === 'online'
            ? 'Online'
            : account.connection === 'connecting'
              ? 'Connecting…'
              : 'Offline — messages wait and send by themselves'}
      </span>
    );
  }
  if (account.waiting) {
    return (
      <span className="topbar__pill" title="River creates your account as soon as its server is reachable">
        <span className="status-dot status-dot--warning" /> Setting up your account…
      </span>
    );
  }
  return (
    <span className="topbar__pill" title="No River account yet">
      <LockIcon size={13} /> Local only · no account yet
    </span>
  );
}

/** Home at the top of the rail: friends and direct messages, like Discord's. */
function HomeButton(): ReactElement {
  const section = useRiver((r) => r.section);
  const navigate = useRiver((r) => r.navigate);
  const notifications = useRiver((r) => r.settings?.notifications);
  // Muted conversations stay out of the count, as on the phone (2.13.1).
  const unread = useDm((d) => totalUnread(d.conversations, notifications));
  // The window title (taskbar, Alt+Tab) shows what waits: "(3) River".
  const mentions = useCommunity((c) => Object.values(c.mentions).reduce((n, x) => n + x, 0));
  useEffect(() => {
    document.title = windowTitle(unread, mentions);
  }, [unread, mentions]);
  const active = HOME_SECTIONS.includes(section);
  return (
    <div className={`community__server-wrap ${active ? 'is-active' : ''}`}>
      <span className="community__pill" aria-hidden="true" />
      <button
        className={`community__server rail-home ${active ? 'is-active' : ''}`}
        aria-label="Home"
        title="Home — friends and direct messages"
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          if (!active) navigate(useDm.getState().selected ? 'messages' : 'contacts');
        }}
      >
        <RiverMark size={28} />
      </button>
      {unread > 0 && (
        <span key={unread} className="badge badge--mention community__server-badge">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </div>
  );
}

/** Admin, at the bottom of the rail on the PC that hosts River. */
function AdminButton(): ReactElement {
  const section = useRiver((r) => r.section);
  const navigate = useRiver((r) => r.navigate);
  const active = section === 'admin';
  return (
    <div className={`community__server-wrap ${active ? 'is-active' : ''}`}>
      <span className="community__pill" aria-hidden="true" />
      <button
        className={`community__server rail-admin ${active ? 'is-active' : ''}`}
        aria-label="Admin"
        title="Admin — everyone on your River"
        aria-current={active ? 'page' : undefined}
        onClick={() => navigate('admin')}
      >
        <AdminIcon size={22} />
      </button>
    </div>
  );
}
