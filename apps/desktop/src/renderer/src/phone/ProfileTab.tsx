import { useState, type ReactElement, type ReactNode } from 'react';
import { CHOSEN_LABEL, StatusMenu, myPresence } from '../components/StatusMenu.tsx';
import { useCommunity } from '../community/store.ts';
import { Avatar, memberOf } from '../community/ui/common.tsx';
import { useDm } from '../dm/store.ts';
import { copyText } from '../pages/MessagesPage.tsx';
import { useRiver, type SettingsTab } from '../store.ts';
import { ChevronRightIcon, CopyIcon, Glyph } from './icons.tsx';
import { openPhoneChat, phonePush } from './nav.ts';
import { TabPage } from './ui.tsx';

type Tone = 'red' | 'orange' | 'green' | 'blue' | 'indigo' | 'purple' | 'teal' | 'gray' | 'pink';

interface Row {
  label: string;
  icon: (p: { size?: number }) => ReactElement;
  tone: Tone;
  /** A Settings section, or something else to do. */
  open: SettingsTab | (() => void);
  /** Scrolls to this part of the section once it is open. */
  focus?: string;
  hint?: ReactNode;
}

/** Opens a Settings section full screen (Back returns here), optionally at one part of it. */
function openSection(tab: SettingsTab, focus?: string): void {
  useRiver.getState().openSettings(tab);
  if (!focus) return;
  window.setTimeout(() => document.querySelector(focus)?.scrollIntoView({ block: 'start' }), 120);
}

/**
 * Settings (2.12), as in Telegram: you at the top, then the sections in grouped rows with
 * coloured icons. Each opens River's own Settings page for it, full screen.
 */
export function ProfileTab(): ReactElement {
  const identity = useRiver((r) => r.identity);
  const account = useRiver((r) => r.account);
  const settings = useRiver((r) => r.settings);
  const platform = useRiver((r) => r.info?.platform);
  const version = useRiver((r) => r.info?.version ?? '');
  const communities = useCommunity((s) => s.communities);
  const online = useCommunity((s) => s.connection === 'online');
  const conversations = useDm((d) => d.conversations);
  const [statusMenu, setStatusMenu] = useState<{ x: number; y: number } | null>(null);
  const me = identity?.riverId ?? '';
  const member = communities.map((c) => memberOf(c, me)).find((m) => m !== undefined && m !== null);
  const name = member?.name ?? identity?.displayName ?? 'You';
  const registered = account.state === 'registered';
  const username = registered ? account.username : null;
  const presence = myPresence(settings, online);
  const custom = settings?.presence.customText || settings?.presence.customEmoji;

  const groups: Row[][] = [
    [
      {
        label: 'Note to self',
        icon: Glyph.bookmark,
        tone: 'blue',
        open: () => {
          const mine = conversations.find((c) => c.self);
          if (mine) openPhoneChat(mine.riverId);
          else
            void useDm
              .getState()
              .run({ a: 'noteToSelf' })
              .then((c) => {
                if (c) openPhoneChat(c.riverId);
              });
        },
      },
      { label: 'Friends', icon: Glyph.people, tone: 'orange', open: () => phonePush({ kind: 'friends' }) },
      { label: 'Files', icon: Glyph.folder, tone: 'teal', open: () => phonePush({ kind: 'files' }) },
    ],
    [
      { label: 'My profile', icon: Glyph.account, tone: 'red', open: 'profile' },
      {
        label: 'Account',
        icon: Glyph.account,
        tone: 'blue',
        open: 'account',
        hint: registered ? account.server : 'Not set up',
      },
      { label: 'Devices', icon: Glyph.devices, tone: 'orange', open: 'account', focus: '.devices' },
      { label: 'Privacy and security', icon: Glyph.lock, tone: 'gray', open: 'security' },
      { label: 'Data and backup', icon: Glyph.data, tone: 'green', open: 'backup' },
    ],
    [
      { label: 'Notifications and sounds', icon: Glyph.bell, tone: 'red', open: 'notifications' },
      { label: 'Appearance', icon: Glyph.brush, tone: 'teal', open: 'appearance' },
      { label: 'Calls, voice and video', icon: Glyph.phone, tone: 'green', open: 'voice' },
      { label: 'Language', icon: Glyph.globe, tone: 'purple', open: 'appearance', focus: '.language-field' },
      {
        label: 'Phone and battery',
        icon: Glyph.gear,
        tone: 'gray',
        open: 'system',
        // The System part of the page (it starts with read receipts and other privacy toggles).
        focus: '#settings-system',
      },
    ],
    [
      ...(platform === 'ios'
        ? []
        : [{ label: 'Updates', icon: Glyph.update, tone: 'indigo' as const, open: 'updates' as const }]),
      { label: 'Help and about River', icon: Glyph.help, tone: 'orange', open: 'about' },
    ],
  ];

  return (
    <TabPage title="Settings" className="ptab--settings">
      <section className="pme" aria-label="You">
        <button className="pme__avatar" aria-label="Edit your profile" onClick={() => openSection('profile')}>
          <Avatar id={me || 'me'} name={name} avatar={member?.avatar} size={96} />
        </button>
        <h2 className="pme__name">{name}</h2>
        <div className="pme__line">
          {username ? `@${username}` : registered ? 'No username yet' : 'Local only · no account yet'}
        </div>
        {me && (
          <button className="pme__id" aria-label="Copy your River ID" onClick={() => copyText(me)}>
            <span className="pme__id-text">River ID {me.slice(0, 8)}…</span>
            <CopyIcon size={15} />
          </button>
        )}
        <button
          className="pme__status"
          aria-haspopup="menu"
          aria-label="Set your status"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setStatusMenu({ x: r.left, y: r.bottom + 6 });
          }}
        >
          <span className={`pme__dot pme__dot--${presence}`} aria-hidden="true" />
          {!online
            ? 'Offline'
            : custom
              ? `${settings!.presence.customEmoji} ${settings!.presence.customText}`.trim()
              : CHOSEN_LABEL[settings?.presence.status ?? 'online']}
        </button>
        {statusMenu && (
          <StatusMenu
            x={statusMenu.x}
            y={statusMenu.y}
            onClose={() => setStatusMenu(null)}
            onEditProfile={() => openSection('profile')}
          />
        )}
      </section>
      {groups.map((rows, i) => (
        <ul key={i} className="pgroup">
          {rows.map((row) => (
            <li key={row.label}>
              <button
                className="pgroup__row"
                onClick={() =>
                  typeof row.open === 'function' ? row.open() : openSection(row.open, row.focus)
                }
              >
                <span className={`pgroup__icon pgroup__icon--${row.tone}`} aria-hidden="true">
                  <row.icon size={19} />
                </span>
                <span className="pgroup__label">{row.label}</span>
                {row.hint && <span className="pgroup__hint">{row.hint}</span>}
                <ChevronRightIcon size={18} className="pgroup__chevron" />
              </button>
            </li>
          ))}
        </ul>
      ))}
      <p className="pfoot">River {version}</p>
    </TabPage>
  );
}
