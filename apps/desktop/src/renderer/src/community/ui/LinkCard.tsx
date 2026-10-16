import type { ReactElement } from 'react';
import type { LinkEmbed } from '../../../../shared/ipc.ts';

/** The first web link in a message, outside `code` (for a link preview). */
export function firstLink(text: string): string | null {
  const plain = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  const m = /https?:\/\/[^\s<>()]+[^\s<>().,!?:;'"]/.exec(plain);
  return m ? m[0] : null;
}

/** A sender-made link preview (1.0.23): opening it asks first, like any link. */
export function LinkCard({ embed }: { embed: LinkEmbed }): ReactElement {
  return (
    <div className="link-card">
      <span className="link-card__site muted small">{embed.site}</span>
      <button className="link-card__title" onClick={() => void window.river.links.openUrl(embed.url)}>
        {embed.title}
      </button>
      {embed.description && <span className="link-card__text small">{embed.description}</span>}
    </div>
  );
}
