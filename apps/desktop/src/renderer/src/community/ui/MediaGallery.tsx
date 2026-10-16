import { useState, type ReactElement } from 'react';
import type { ChatMessage } from '../../../../shared/ipc.ts';
import { AttachmentList } from './Attachments.tsx';

/** Pictures and videos of a channel, newest first (pure, for tests). */
export function mediaPosts(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((m) => m.attachments.some((a) => a.mime.startsWith('image/') || a.mime.startsWith('video/')))
    .slice()
    .reverse();
}

/** A media channel's gallery (1.0.26): every picture and video, with who shared it. */
export function MediaGallery(props: {
  messages: ChatMessage[];
  onLoadOlder(): Promise<unknown> | void;
  more: boolean;
}): ReactElement {
  const posts = mediaPosts(props.messages);
  // One page at a time: pressing again while one loads does nothing.
  const [loading, setLoading] = useState(false);
  return (
    <div className="media-gallery" aria-label="Gallery">
      {posts.length === 0 && (
        <p className="muted media-gallery__empty">No pictures or videos yet. Drop some into the box below.</p>
      )}
      <div className="media-gallery__grid">
        {posts.map((m) => (
          <figure key={m.id} className="media-gallery__item">
            <AttachmentList
              attachments={m.attachments.filter(
                (a) => a.mime.startsWith('image/') || a.mime.startsWith('video/'),
              )}
              alts={m.alts}
            />
            <figcaption className="muted small">
              {m.senderName}
              {m.text ? ` — ${m.text.slice(0, 80)}` : ''}
            </figcaption>
          </figure>
        ))}
      </div>
      {props.more && posts.length > 0 && (
        <button
          className="btn btn--ghost btn--small media-gallery__more"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void Promise.resolve(props.onLoadOlder()).finally(() => setLoading(false));
          }}
        >
          {loading ? 'Decrypting…' : 'Load older'}
        </button>
      )}
    </div>
  );
}
