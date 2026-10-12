import { useMemo, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import { useDm } from '../../dm/store.ts';
import { useOutbox } from '../outbox.ts';
import { play } from '../sound.ts';
import { useCommunity } from '../store.ts';
import { Modal, can } from './common.tsx';

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
        where: c.kind === 'group' ? 'Group' : 'Direct message',
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
    const ok = await d.send(forwardedText(props.text, props.from));
    setBusy(false);
    if (ok) {
      play('send');
      useCommunity.getState().notify(`Forwarded to ${d.label}.`);
      props.onClose();
    }
  };

  return (
    <Modal title="Forward message" onClose={props.onClose}>
      <blockquote className="forward__preview">{props.text.slice(0, 300)}</blockquote>
      <label className="textfield">
        <span className="field__label">Send to</span>
        <input
          autoFocus
          placeholder="Search channels and people"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <ul className="forward__list" aria-label="Destinations">
        {shown.map((d) => (
          <li key={d.key}>
            <button className="forward__item" disabled={busy} onClick={() => void send(d)}>
              <strong>{d.label}</strong>
              <span className="muted small">{d.where}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="muted small">Nothing matches “{query}”.</li>}
      </ul>
    </Modal>
  );
}
