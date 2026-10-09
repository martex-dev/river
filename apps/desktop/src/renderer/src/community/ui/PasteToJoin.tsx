import { useEffect, useState, type ReactElement } from 'react';
import { inviteHost, looksLikeInvite, parseFriend } from '../../../../shared/invite-link.ts';
import { GREETING, sendFriendRequest } from '../../dm/friends.ts';
import { useRiver } from '../../store.ts';
import { useCommunity } from '../store.ts';
import { Modal } from './common.tsx';
import { joinWithLink } from './StartScreen.tsx';

const editable = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

/**
 * Paste an invite or friend link anywhere in River (outside a text field) and River
 * offers to join it. Nothing is read from the clipboard unless you paste.
 */
export function PasteToJoin(): null {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (editable(e.target) || editable(document.activeElement)) return;
      const text = e.clipboardData?.getData('text') ?? '';
      const friend = parseFriend(text);
      if (looksLikeInvite(text)) {
        e.preventDefault();
        useCommunity.getState().setModal({ kind: 'join-invite', link: text.trim() });
      } else if (friend?.serverUrl) {
        e.preventDefault();
        useCommunity
          .getState()
          .setModal({ kind: 'add-friend', riverId: friend.riverId, serverUrl: friend.serverUrl });
      }
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

const trim = (url: string): string => url.replace(/\/+$/, '');

export function AddFriendDialog(props: { riverId: string; serverUrl: string }): ReactElement {
  const s = useCommunity();
  const account = useRiver((r) => r.account);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem =
    account.state !== 'registered'
      ? 'You need an account first: join or create a community.'
      : account.riverId === props.riverId
        ? "That's your own friend link."
        : trim(account.serverUrl) !== trim(props.serverUrl)
          ? 'That person is on another River server. Friends need to be on the same server for now.'
          : null;
  return (
    <Modal title="Add a friend?" onClose={() => s.setModal(null)}>
      <p className="modal__text">
        You pasted a friend link. River will send them “{GREETING}” as an end-to-end encrypted request.
      </p>
      {(problem ?? error) && <p className="field__error">{problem ?? error}</p>}
      <div className="modal__foot">
        <button className="btn btn--link" onClick={() => s.setModal(null)}>
          Not now
        </button>
        <button
          className="btn btn--primary"
          autoFocus
          disabled={busy || problem !== null}
          onClick={() => {
            setBusy(true);
            void sendFriendRequest(props.riverId).then((ok) => {
              setBusy(false);
              if (!ok) return setError('Could not send the request.');
              s.notify('Friend request sent');
              s.setModal(null);
            });
          }}
        >
          {busy ? 'Sending…' : 'Send friend request'}
        </button>
      </div>
    </Modal>
  );
}
