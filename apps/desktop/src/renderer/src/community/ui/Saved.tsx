import { useEffect, type ReactElement } from 'react';
import { clockDateTime } from '../../time.ts';
import { useCommunity } from '../store.ts';
import { XIcon } from './common.tsx';

/** Saved messages (1.0.19): everything you bookmarked, across communities, on this device only. */
export function SavedPanel(): ReactElement {
  const s = useCommunity();
  const saved = useCommunity((x) => x.saved);
  useEffect(() => {
    void s.loadSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const where = (communityId: string, channelId: string): string => {
    const c = s.communities.find((x) => x.id === communityId);
    const ch = c?.channels.find((x) => x.id === channelId);
    return c ? `${c.name}${ch ? ` · #${ch.name}` : ''}` : 'A community you left';
  };
  return (
    <div className="pins">
      <header className="pins__head">
        <span aria-hidden="true">🔖</span> <strong>Saved messages</strong>
        <button
          className="icon-btn"
          aria-label="Close saved messages"
          onClick={() => useCommunity.setState({ showSaved: false })}
        >
          <XIcon size={14} />
        </button>
      </header>
      {saved === null && <p className="muted small">Loading…</p>}
      {saved?.length === 0 && (
        <p className="muted small">Right-click a message and choose Save message to keep it here.</p>
      )}
      {saved?.map((m) => (
        <div key={m.messageId} className="pins__item saved__item">
          <button
            className="saved__open"
            onClick={() => {
              useCommunity.setState({ showSaved: false });
              s.openMessage(m.communityId, m.channelId, m.messageId);
            }}
          >
            <span className="muted small">
              {where(m.communityId, m.channelId)} · {clockDateTime(m.sentAt)}
            </span>
            <strong>{m.senderName}</strong>
            <span className="saved__text">{m.text.slice(0, 200) || 'An attachment'}</span>
          </button>
          <button
            className="icon-btn"
            aria-label="Remove from saved"
            onClick={() => void s.toggleSaved(m.channelId, m.messageId, false)}
          >
            <XIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
