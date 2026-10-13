import { useEffect, useState, type ReactElement } from 'react';
import { useRiver } from '../store.ts';
import { markSeen, readLastSeen, whatsNew } from '../whats-new.ts';

/** A small card after an update: what changed, once (1.0.40). */
export function WhatsNew(): ReactElement | null {
  const version = useRiver((r) => r.info?.version ?? null);
  // Read once per run: what was seen before this start, so remembering the new version below cannot hide the card.
  const [before] = useState(readLastSeen);
  const items = version ? whatsNew(version, before) : null;
  // Remember this version, so a fresh install or a dismissed card stays quiet next time.
  useEffect(() => {
    if (version) markSeen(version);
  }, [version]);
  const [open, setOpen] = useState(true);
  if (!version || !items || !open) return null;
  return (
    <section className="whats-new glass" aria-labelledby="whats-new-title">
      <h2 id="whats-new-title">What's new in River {version}</h2>
      <ul>
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <div className="button-row">
        <button
          className="btn btn--ghost btn--small"
          onClick={() => void window.river.links.open('releases')}
        >
          See all changes
        </button>
        <button className="btn btn--primary btn--small" onClick={() => setOpen(false)}>
          Got it
        </button>
      </div>
    </section>
  );
}
