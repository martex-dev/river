import { useState, type ReactElement } from 'react';
import { looksLikeInvite } from '../../../shared/invite-link.ts';
import { joinWithLink } from '../community/ui/StartScreen.tsx';
import { tr } from '../i18n.ts';
import { useRiver } from '../store.ts';

/**
 * "Join a community" where a new person lands (2.14): paste an invite and you are in, or start
 * your own from a template (Communities' start screen). Used by Friends while you have none.
 */
export function JoinCommunityCard(): ReactElement {
  const setCommunityStart = useRiver((r) => r.setCommunityStart);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const join = async (value: string): Promise<void> => {
    setBusy(true);
    setError(null);
    const failed = await joinWithLink(value);
    setBusy(false);
    if (failed) setError(failed);
  };
  return (
    <form
      className="glass card get-started__join"
      onSubmit={(e) => {
        e.preventDefault();
        void join(link);
      }}
    >
      <h2 className="card__title">{tr('Join a community')}</h2>
      <p className="muted small">{tr('Got an invite link? Paste it here — River does the rest.')}</p>
      <div className="start__join-row">
        <input
          aria-label={tr('Community invite link')}
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setError(null);
          }}
          onPaste={(e) => {
            // Pasting a whole invite link joins straight away, as on Communities' start screen.
            const pasted = e.clipboardData.getData('text');
            if (looksLikeInvite(pasted) && !busy) {
              e.preventDefault();
              setLink(pasted.trim());
              void join(pasted);
            }
          }}
          placeholder={tr('Paste an invite link')}
          spellCheck={false}
        />
        <button className="btn btn--primary" disabled={busy || link.trim() === ''}>
          {busy ? tr('Joining…') : tr('Join')}
        </button>
      </div>
      {error && <p className="field__error">{error}</p>}
      <button
        type="button"
        className="btn btn--link get-started__own"
        onClick={() => setCommunityStart(true)}
      >
        {tr('Or start your own community')}
      </button>
    </form>
  );
}
