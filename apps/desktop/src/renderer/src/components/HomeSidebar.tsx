import { useState, type ReactElement } from 'react';
import { VoicePanel, UserPanel } from '../community/ui/Sidebar.tsx';
import { ConversationList, NewMessage } from '../pages/MessagesPage.tsx';
import { useRiver, type Section } from '../store.ts';
import { CallsIcon, ContactsIcon, FilesIcon, SocialIcon } from './Icons.tsx';
import { msg, tr } from '../i18n.ts';

/** The Home sections: friends, direct messages and your own things, as in Discord's Home. */
export const HOME_SECTIONS: readonly Section[] = ['home', 'contacts', 'messages', 'social', 'calls', 'files'];

const NAV = [
  { section: 'contacts', label: msg('Friends'), Icon: ContactsIcon },
  { section: 'social', label: msg('Social'), Icon: SocialIcon },
  { section: 'calls', label: msg('Calls'), Icon: CallsIcon },
  { section: 'files', label: msg('Files'), Icon: FilesIcon },
] as const;

/**
 * Home's sidebar (1.0.42): search, Friends and your other places, your direct
 * messages, and you at the bottom — the same column a community's channels use.
 */
export function HomeSidebar(): ReactElement {
  const section = useRiver((r) => r.section);
  const navigate = useRiver((r) => r.navigate);
  const me = useRiver((r) => r.identity?.riverId ?? '');
  const registered = useRiver((r) => r.account.state === 'registered');
  const [composing, setComposing] = useState(false);
  const nav = (
    <nav className="home-nav" aria-label={tr('Home')}>
      {NAV.map(({ section: id, label, Icon }) => {
        const active = section === id || (id === 'contacts' && section === 'home');
        return (
          <button
            key={id}
            className={`home-nav__item ${active ? 'is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => navigate(id)}
          >
            <Icon size={20} />
            <span>{tr(label)}</span>
          </button>
        );
      })}
    </nav>
  );
  return (
    <aside className="home-sidebar" aria-label={tr('Friends and direct messages')}>
      {registered ? (
        <ConversationList onNew={() => setComposing(true)} nav={nav} />
      ) : (
        <div className="dms__list">
          <div className="home-sidebar__search" />
          <div className="home-sidebar__scroll">
            {nav}
            <p className="muted small dms__hint">
              {tr('Direct messages start once you have an account — join a community with an invite link.')}
            </p>
          </div>
        </div>
      )}
      <VoicePanel me={me} />
      <UserPanel me={me} />
      {composing && <NewMessage onClose={() => setComposing(false)} />}
    </aside>
  );
}
