import { useEffect, useState, type ReactElement } from 'react';
import { RiverMark } from './components/RiverMark.tsx';
import { SECTION_ICONS, LockIcon } from './components/Icons.tsx';
import { LockScreen } from './components/LockScreen.tsx';
import { UpdateToast } from './components/UpdateToast.tsx';
import { PLANNED } from './features.ts';
import { HomePage } from './pages/HomePage.tsx';
import { PlannedPage } from './pages/PlannedPage.tsx';
import { SecurityPage } from './pages/SecurityPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { SECTIONS, useRiver, type Section } from './store.ts';

const LABELS: Record<Section, string> = {
  home: 'Home',
  messages: 'Messages',
  communities: 'Communities',
  social: 'Social',
  calls: 'Calls',
  files: 'Files',
  contacts: 'Contacts',
  security: 'Security',
  settings: 'Settings',
};

const PRIMARY = SECTIONS.filter((s) => s !== 'security' && s !== 'settings');
const SECONDARY: Section[] = ['security', 'settings'];

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
  const { section, navigate, load, setUpdate, setStorage, settings, info, loadError, storage } = useRiver();
  const systemReduced = useSystemReducedMotion();
  const motion = settings?.appearance.motion ?? 'system';
  const reducedMotion = motion === 'reduced' || (motion === 'system' && systemReduced);

  useEffect(() => {
    void load();
    const offUpdates = window.river.updates.onStatus(setUpdate);
    const offStorage = window.river.storage.onStatus((s) => void setStorage(s));
    return () => {
      offUpdates();
      offStorage();
    };
  }, [load, setUpdate, setStorage]);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'full';
  }, [reducedMotion]);

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
          {SECONDARY.map((s) => (
            <RailItem key={s} section={s} active={section === s} onSelect={navigate} />
          ))}
        </ul>
      </nav>

      <div className="main">
        <header className="topbar">
          <span className="topbar__title">{LABELS[section]}</span>
          <span className="topbar__pill" title="This version does not connect to any River server">
            <LockIcon size={13} /> Local only · no account yet
          </span>
        </header>
        <main className="content" key={section}>
          {loadError && (
            <div className="glass card card--error" role="alert">
              River could not load its settings: {loadError}
            </div>
          )}
          {section === 'home' && <HomePage reducedMotion={reducedMotion} />}
          {section === 'security' && <SecurityPage />}
          {section === 'settings' && <SettingsPage />}
          {planned && <PlannedPage section={section} feature={planned} />}
        </main>
      </div>
      <UpdateToast />
    </div>
  );
}

function RailItem(props: { section: Section; active: boolean; onSelect(s: Section): void }): ReactElement {
  const Icon = SECTION_ICONS[props.section];
  return (
    <li>
      <button
        className={`rail__item ${props.active ? 'is-active' : ''}`}
        aria-current={props.active ? 'page' : undefined}
        onClick={() => props.onSelect(props.section)}
      >
        <Icon size={22} />
        <span className="rail__label">{LABELS[props.section]}</span>
      </button>
    </li>
  );
}
