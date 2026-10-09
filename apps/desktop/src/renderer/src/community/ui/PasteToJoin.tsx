import { useEffect, useState, type ReactElement } from 'react';
import { inviteHost, looksLikeInvite } from '../../../../shared/invite-link.ts';
import { useCommunity } from '../store.ts';
import { Modal } from './common.tsx';
import { joinWithLink } from './StartScreen.tsx';

const editable = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

/**
 * Paste an invite link anywhere in River (outside a text field) and River
 * offers to join it. Nothing is read from the clipboard unless you paste.
 */
export function PasteToJoin(): null {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (editable(e.target) || editable(document.activeElement)) return;
      const text = e.clipboardData?.getData('text') ?? '';
      if (!looksLikeInvite(text)) return;
      e.preventDefault();
      useCommunity.getState().setModal({ kind: 'join-invite', link: text.trim() });
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);
  return null;
}

export function JoinInviteDialog({ link }: { link: string }): ReactElement {
  const s = useCommunity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Join this community?" onClose={() => s.setModal(null)}>
      <p className="modal__text">
        You pasted an invite to a community on <strong>{inviteHost(link)}</strong>. Joining shares your River
        name and avatar with its members.
      </p>
      {error && <p className="field__error">{error}</p>}
      <div className="modal__foot">
        <button className="btn btn--link" onClick={() => s.setModal(null)}>
          Not now
        </button>
        <button
          className="btn btn--primary"
          autoFocus
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void joinWithLink(link).then((failed) => {
              setBusy(false);
              if (failed) setError(failed);
              else s.setModal(null);
            });
          }}
        >
          {busy ? 'Joining…' : 'Join community'}
        </button>
      </div>
    </Modal>
  );
}
