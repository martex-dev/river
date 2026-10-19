import { useEffect, useState, type ReactElement } from 'react';
import { hasTag, savedTagKey, TagChips, TagDialog, TagFilter, tagsIn, useTags } from '../../dm/tags.tsx';
import { phoneShellActive } from '../../phone/mode.ts';
import { clockDateTime } from '../../time.ts';
import { useCommunity } from '../store.ts';
import { XIcon, usePanelLayer } from './common.tsx';

/**
 * Saved messages (1.0.19): everything you bookmarked, across communities, on this device only.
 * Since 2.19 each can have tags, and the list can show only the ones with a tag.
 */
export function SavedPanel(): ReactElement {
  const s = useCommunity();
  usePanelLayer(() => useCommunity.setState({ showSaved: false }));
  const saved = useCommunity((x) => x.saved);
  const tags = useTags();
  const [filter, setFilter] = useState<string | null>(null);
  const [tagging, setTagging] = useState<string | null>(null);
  useEffect(() => {
    void s.loadSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const where = (communityId: string, channelId: string): string => {
    const c = s.communities.find((x) => x.id === communityId);
    const ch = c?.channels.find((x) => x.id === channelId);
    return c ? `${c.name}${ch ? ` · #${ch.name}` : ''}` : 'A community you left';
  };
  const keys = (saved ?? []).map((m) => savedTagKey(m.messageId));
  const allTags = tagsIn(tags, keys);
  const active = filter && allTags.includes(filter) ? filter : null;
  const shown = (saved ?? []).filter((m) => hasTag(tags, savedTagKey(m.messageId), active));
  return (
    <div className="pins">
      <header className="pins__head">
        <span aria-hidden="true">🔖</span> <strong>Saved messages</strong>
        <button
          className="icon-btn"
          aria-label="Close saved messages"
          data-phone-back=""
          onClick={() => useCommunity.setState({ showSaved: false })}
        >
          <XIcon size={14} />
        </button>
      </header>
      <TagFilter tags={allTags} value={active} onChange={setFilter} />
      {saved === null && <p className="muted small">Loading…</p>}
      {saved?.length === 0 && (
        <p className="muted small">
          {phoneShellActive() ? 'Long-press' : 'Right-click'} a message and choose Save message to keep it
          here.
        </p>
      )}
      {shown.map((m) => (
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
            <TagChips tags={tags[savedTagKey(m.messageId)]} />
          </button>
          <button
            className="icon-btn"
            aria-label={`Tags for the message from ${m.senderName}`}
            title="Tags"
            onClick={() => setTagging(m.messageId)}
          >
            <span aria-hidden="true">#</span>
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
      {tagging && <TagDialog tagKey={savedTagKey(tagging)} onClose={() => setTagging(null)} />}
    </div>
  );
}
