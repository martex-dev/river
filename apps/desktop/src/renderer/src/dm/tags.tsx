import { tr } from '../i18n.ts';
import { useEffect, useState, type ReactElement } from 'react';
import { create } from 'zustand';
import { MAX_TAGS_PER_MESSAGE, TAG_RE, type MessageTags } from '../../../shared/dm.ts';
import { useCommunity } from '../community/store.ts';
import { Modal } from '../community/ui/common.tsx';

/**
 * Tags on your notes and saved messages (2.19), as Telegram's Saved Messages tags: give a note to
 * self or a saved channel message a few tags, then show only the ones with a tag. Kept in this
 * device's encrypted database (River cannot copy them to your other devices yet).
 */

/** The key a message's tags are kept under: a direct message (Note to self) or a saved channel message. */
export const noteTagKey = (messageId: string): string => `d:${messageId}`;
export const savedTagKey = (messageId: string): string => `c:${messageId}`;

interface TagsState {
  tags: MessageTags | null;
  load(): Promise<void>;
  set(key: string, tags: string[]): Promise<boolean>;
}

export const useMessageTags = create<TagsState>((set) => ({
  tags: null,
  load: async () => {
    const r = await (async () => window.river.dm.action({ a: 'messageTags' }))().catch(() => null);
    set({ tags: r?.ok ? r.value : {} });
  },
  set: async (key, tags) => {
    const r = await window.river.dm.action({ a: 'tagMessage', key, tags });
    if (!r.ok) {
      useCommunity.getState().notify(r.message, 'error');
      return false;
    }
    set({ tags: r.value });
    return true;
  },
}));

/** All tags (loaded once, the first time something shows them). */
export function useTags(): MessageTags {
  const tags = useMessageTags((s) => s.tags);
  useEffect(() => {
    if (useMessageTags.getState().tags === null) void useMessageTags.getState().load();
  }, []);
  return tags ?? EMPTY;
}
const EMPTY: MessageTags = {};

/** Every tag among these keys (or all), each once, in alphabetical order. */
export function tagsIn(tags: MessageTags, keys?: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const key of keys ?? Object.keys(tags))
    for (const t of tags[key] ?? []) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Whether the message under `key` has `tag` (null: no filter, everything matches). */
export function hasTag(tags: MessageTags, key: string, tag: string | null): boolean {
  if (tag === null) return true;
  const t = tag.toLowerCase();
  return (tags[key] ?? []).some((x) => x.toLowerCase() === t);
}

/** "#work" written as a tag: the # left out, spaces turned into _. */
export function cleanTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/\s+/g, '_').slice(0, 24);
}

/** A message's tags, as small chips under it. */
export function TagChips({ tags }: { tags: readonly string[] | undefined }): ReactElement | null {
  if (!tags?.length) return null;
  return (
    <div className="msg-tags" role="group" aria-label={tr('Tags')}>
      {tags.map((t) => (
        <span key={t} className="msg-tag">
          #{t}
        </span>
      ))}
    </div>
  );
}

/** "All · #ideas · #work": shows only the messages with one tag. */
export function TagFilter(props: {
  tags: readonly string[];
  value: string | null;
  onChange(tag: string | null): void;
}): ReactElement | null {
  if (props.tags.length === 0) return null;
  return (
    <div className="tag-filter" role="radiogroup" aria-label={tr('Show tagged')}>
      <button
        type="button"
        role="radio"
        aria-checked={props.value === null}
        className={`chip ${props.value === null ? 'is-on' : ''}`}
        onClick={() => props.onChange(null)}
      >
        {tr('All')}
      </button>
      {props.tags.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={props.value === t}
          className={`chip ${props.value === t ? 'is-on' : ''}`}
          onClick={() => props.onChange(props.value === t ? null : t)}
        >
          #{t}
        </button>
      ))}
    </div>
  );
}

/** Choose a message's tags: type one and press Enter, or pick one you used before. */
export function TagDialog(props: { tagKey: string; onClose(): void }): ReactElement {
  const all = useTags();
  const [tags, setTags] = useState<string[]>(() => [...(all[props.tagKey] ?? [])]);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const known = tagsIn(all).filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));
  const candidate = cleanTag(typed);
  const add = (t: string): void => {
    if (!TAG_RE.test(t) || tags.length >= MAX_TAGS_PER_MESSAGE) return;
    if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) setTags([...tags, t]);
    setTyped('');
  };
  return (
    <Modal title={tr('Tags')} onClose={props.onClose}>
      <p className="muted small">
        {tr(
          'Up to {count} tags, to find this again with the filter above your notes and saved messages. Kept encrypted on this device only.',
          { count: MAX_TAGS_PER_MESSAGE },
        )}
      </p>
      <div className="msg-tags" role="group" aria-label={tr("This message's tags")}>
        {tags.length === 0 && <span className="muted small">{tr('No tags yet.')}</span>}
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            className="msg-tag"
            aria-label={tr('Remove {name}', { name: `#${t}` })}
            onClick={() => setTags(tags.filter((x) => x !== t))}
          >
            #{t} ✕
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add(candidate);
        }}
      >
        <label className="textfield">
          <span className="field__label">{tr('Add a tag')}</span>
          <input
            autoFocus
            value={typed}
            maxLength={25}
            placeholder={tr('ideas')}
            disabled={tags.length >= MAX_TAGS_PER_MESSAGE}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        {typed && !TAG_RE.test(candidate) && (
          <p className="muted small" role="status">
            {tr('Letters, numbers, _ and - only.')}
          </p>
        )}
      </form>
      {known.length > 0 && (
        <div className="msg-tags" role="group" aria-label={tr('Tags you used before')}>
          {known.slice(0, 20).map((t) => (
            <button
              key={t}
              type="button"
              className="chip"
              disabled={tags.length >= MAX_TAGS_PER_MESSAGE}
              onClick={() => add(t)}
            >
              #{t}
            </button>
          ))}
        </div>
      )}
      <div className="modal__foot">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => {
            const pending = TAG_RE.test(candidate) ? [...tags, candidate] : tags;
            setBusy(true);
            void useMessageTags
              .getState()
              .set(props.tagKey, [...new Set(pending)].slice(0, MAX_TAGS_PER_MESSAGE))
              .then((ok) => {
                setBusy(false);
                if (ok) props.onClose();
              });
          }}
        >
          {tr('Save tags')}
        </button>
      </div>
    </Modal>
  );
}
