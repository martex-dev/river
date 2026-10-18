import type { ReactElement } from 'react';
import { openAddFriend } from '../pages/FriendsPage.tsx';
import { useRiver } from '../store.ts';
import { ContactsIcon, GroupsIcon } from './icons.tsx';

function QrGlyph({ size = 26 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />
    </svg>
  );
}

/**
 * Chats before your first conversation (2.14): where to go next, as rows like the rest of the
 * list — add a friend by @username or QR code, show yours, or join a community with an invite.
 */
export function FirstSteps(): ReactElement {
  const setCommunityStart = useRiver((r) => r.setCommunityStart);
  const rows: Array<{ title: string; text: string; icon: ReactElement; open(): void }> = [
    {
      title: 'Add a friend',
      text: 'Find them by @username, or scan their QR code',
      icon: <ContactsIcon size={26} />,
      open: () => openAddFriend(),
    },
    {
      title: 'Show my QR code',
      text: 'Friends scan it, or you send them your link',
      icon: <QrGlyph />,
      open: () => openAddFriend({ qr: true }),
    },
    {
      title: 'Join a community',
      text: 'Paste an invite link, or start your own',
      icon: <GroupsIcon size={26} />,
      open: () => setCommunityStart(true),
    },
  ];
  return (
    <section className="pfirst" aria-labelledby="pfirst-title">
      <h2 className="plist__head" id="pfirst-title">
        Get started
      </h2>
      <ul className="plist">
        {rows.map((r) => (
          <li key={r.title}>
            <button className="prow prow--special" onClick={r.open}>
              <span className="prow__avatar prow__avatar--glyph prow__avatar--accent" aria-hidden="true">
                {r.icon}
              </span>
              <span className="prow__main">
                <span className="prow__top">
                  <strong className="prow__name">{r.title}</strong>
                </span>
                <span className="prow__bottom">
                  <span className="prow__preview">{r.text}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
