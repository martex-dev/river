import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { create } from 'zustand';
import type { SharedContent } from '../../../shared/ipc.ts';
import { Modal } from '../community/ui/common.tsx';
import { useCommunity } from '../community/store.ts';
import { useDm } from '../dm/store.ts';
import { useRiver } from '../store.ts';

/**
 * "Share → River" on phones: another app hands River text or files, River asks
 * where to send them, opens that conversation and puts them in its message box.
 * Nothing is sent until the person presses Send there.
 */

export interface Incoming {
  text: string;
  files: File[];
}

interface ShareState {
  /** Shared, waiting for a destination. */
  incoming: Incoming | null;
  /** Picked: waiting for that conversation's message box (draft key: c:<channel> or d:<person>). */
  ready: { key: string; text: string | null; files: File[] | null } | null;
  offer(content: Incoming): void;
  sendTo(key: string): void;
  cancel(): void;
  /** The message box for `key` takes the shared text (or files), once. */
  take(key: string, part: 'text'): string | null;
  take(key: string, part: 'files'): File[] | null;
}

export const useShare = create<ShareState>((set, get) => ({
  incoming: null,
  ready: null,
  offer: (content) => set({ incoming: content, ready: null }),
  sendTo: (key) => {
    const content = get().incoming;
    if (!content) return;
    set({
      incoming: null,
      ready: { key, text: content.text || null, files: content.files.length ? content.files : null },
    });
  },
  cancel: () => set({ incoming: null, ready: null }),
  take: ((key: string, part: 'text' | 'files') => {
    const ready = get().ready;
    if (!ready || ready.key !== key) return null;
    const value = ready[part];
    const rest = { ...ready, [part]: null };
    set({ ready: rest.text === null && rest.files === null ? null : rest });
    return value;
  }) as ShareState['take'],
}));

export function toIncoming(content: SharedContent): Incoming {
  return {
    text: typeof content.text === 'string' ? content.text.slice(0, 4000) : '',
    files: (Array.isArray(content.files) ? content.files : [])
      .slice(0, 10)
      .filter((f) => f && f.data instanceof Uint8Array)
      .map(
        (f) =>
          new File([f.data as BlobPart], String(f.name).slice(0, 200) || 'shared file', {
            type: String(f.type),
          }),
      ),
  };
}

/** Message boxes call these: what was shared for them, as soon as it is there. */
export function useSharedText(key: string, accept: (text: string) => void): void {
  const waiting = useShare((s) => s.ready?.key === key && s.ready.text !== null);
  useEffect(() => {
    if (!waiting) return;
    const text = useShare.getState().take(key, 'text');
    if (text) accept(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, key]);
}

export function useSharedFiles(key: string, accept: (files: File[]) => void): void {
  const waiting = useShare((s) => s.ready?.key === key && s.ready.files !== null);
  useEffect(() => {
    if (!waiting) return;
    const files = useShare.getState().take(key, 'files');
    if (files) accept(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, key]);
}

export function ShareSheet(): ReactElement | null {
  const incoming = useShare((s) => s.incoming);
  const conversations = useDm((d) => d.conversations);
  const communities = useCommunity((c) => c.communities);
  const [query, setQuery] = useState('');

  useEffect(() => window.river.app.onShare((content) => useShare.getState().offer(toIncoming(content))), []);

  const targets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const people = conversations.map((c) => ({
      key: `d:${c.riverId}`,
      label: c.name,
      detail: 'Direct message',
    }));
    const channels = communities.flatMap((community) =>
      community.channels
        .filter((ch) => ch.kind === 'text')
        .map((ch) => ({ key: `c:${ch.id}`, label: `# ${ch.name}`, detail: community.name })),
    );
    return [...people, ...channels].filter(
      (t) => !q || t.label.toLowerCase().includes(q) || t.detail.toLowerCase().includes(q),
    );
  }, [conversations, communities, query]);

  if (!incoming) return null;
  const what =
    incoming.files.length > 0
      ? `${incoming.files.length} ${incoming.files.length === 1 ? 'file' : 'files'}${incoming.text ? ' and text' : ''}`
      : 'text';

  const pick = (key: string): void => {
    useShare.getState().sendTo(key);
    setQuery('');
    if (key.startsWith('d:')) {
      useDm.getState().select(key.slice(2));
      useRiver.getState().navigate('messages');
    } else {
      useCommunity.getState().selectChannel(key.slice(2));
      useRiver.getState().navigate('communities');
    }
  };

  return (
    <Modal title="Send to…" onClose={() => useShare.getState().cancel()}>
      <p className="muted small">
        Sharing {what}. Pick a conversation; it opens with this in the message box, and nothing is sent until
        you press Send.
      </p>
      <input
        className="input"
        placeholder="Search"
        aria-label="Search conversations and channels"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="share-sheet__list">
        {targets.slice(0, 50).map((t) => (
          <li key={t.key}>
            <button className="share-sheet__target" onClick={() => pick(t.key)}>
              <strong>{t.label}</strong>
              <span className="muted small">{t.detail}</span>
            </button>
          </li>
        ))}
        {targets.length === 0 && <li className="muted small">Nothing matches.</li>}
      </ul>
    </Modal>
  );
}
