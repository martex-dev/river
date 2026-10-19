import { useMemo, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import { isPhone } from '../../../../shared/platform.ts';
import { useDm } from '../../dm/store.ts';
import { useRiver } from '../../store.ts';
import { useOutbox } from '../outbox.ts';
import { play } from '../sound.ts';
import { useCommunity } from '../store.ts';
import { Modal, Toggle, can } from './common.tsx';
import { tr } from '../../i18n.ts';

interface Destination {
  key: string;
  label: string;
  where: string;
  send(text: string): Promise<boolean>;
}

/** The forwarded text: a small "forwarded" line, then the original (1.0.17). */
export function forwardedText(text: string, from: { name: string; channel: string }): string {
  // From a direct message there is no channel to name.
  const where = from.channel ? ` in #${from.channel}` : '';
  return `-# ↪ Forwarded from ${from.name}${where}\n${text}`;
}

/**
 * What a forward sends (2.19): with "Show sender's name" on, the "Forwarded from" line and the
 * text; off, only the text, as if you wrote it (Telegram's "Hide sender name").
 */
export function forwardBody(
  text: string,
  from: { name: string; channel: string },
  showSender: boolean,
): string {
  return showSender ? forwardedText(text, from) : text;
}

/**
 * Forward a message to another channel or a conversation. The text is sent
 * again, encrypted for its new place; attachments are not carried over.
 */
export function ForwardDialog(props: {
  text: string;
  from: { name: string; channel: string };
  onClose(): void;
}): ReactElement {
  const communities = useCommunity((s) => s.communities);
  const conversations = useDm((s) => s.conversations);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSender, setShowSender] = useState(true);
  // A phone's keyboard would cover half the list before you even chose to search.
  const phone = useRiver((r) => isPhone(r.info?.platform));
  const destinations = useMemo<Destination[]>(() => {
    const channels = communities.flatMap((c) =>
      c.channels
        .filter((ch) => ch.kind === 'text' && can(ch.permissions, Permission.SEND_MESSAGES))
        .map((ch) => ({
          key: `c:${ch.id}`,
          label: `#${ch.name}`,
          where: c.name,
          send: async (text: string) => {
            useOutbox.getState().send({ channelId: ch.id, text });
            return true;
          },
        })),
    );
    const people = conversations
      .filter((c) => c.state === 'accepted')
      .map((c) => ({
        key: `d:${c.riverId}`,
        label: c.name,
        where: c.kind === 'group' ? tr('Group') : tr('Direct message'),
        send: async (text: string) => !!(await useDm.getState().run({ a: 'send', peer: c.riverId, text })),
      }));
    return [...people, ...channels];
  }, [communities, conversations]);
  const q = query.trim().toLowerCase();
  const shown = destinations
    .filter((d) => !q || `${d.label} ${d.where}`.toLowerCase().includes(q))
    .slice(0, 40);

  const send = async (d: Destination): Promise<void> => {
    setBusy(true);
    const ok = await d.send(forwardBody(props.text, props.from, showSender));
    setBusy(false);
    if (ok) {
      play('send');
      useCommunity.getState().notify(tr('Forwarded to {name}.', { name: d.label }));
      props.onClose();
    }
  };

  return (
    <Modal title={tr('Forward message')} onClose={props.onClose}>
      <blockquote className="forward__preview">{props.text.slice(0, 300)}</blockquote>
      <Toggle
        label={tr('Show sender’s name')}
        help={
          showSender
            ? tr('Starts with “Forwarded from {name}”.', { name: props.from.name })
            : tr('Sent as if you wrote it, without saying who it came from.')
        }
        checked={showSender}
        onChange={setShowSender}
      />
      <label className="textfield">
        <span className="field__label">{tr('Send to')}</span>
        <input
          autoFocus={!phone}
          placeholder={tr('Search channels and people')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <ul className="forward__list" aria-label={tr('Destinations')}>
        {shown.map((d) => (
          <li key={d.key}>
            <button className="forward__item" disabled={busy} onClick={() => void send(d)}>
              <strong>{d.label}</strong>
              <span className="muted small">{d.where}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="muted small">{tr('Nothing matches “{query}”.', { query })}</li>}
      </ul>
    </Modal>
  );
}
