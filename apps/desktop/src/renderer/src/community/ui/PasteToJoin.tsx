import { useEffect, useState, type ReactElement } from 'react';
import { looksLikeInvite, parseCallLink, parseFriend, parseSignup } from '../../../../shared/invite-link.ts';
import type { DeepLink } from '../../../../shared/ipc.ts';
import { addFriend, addFriendMessage, GREETING } from '../../dm/friends.ts';
import { offerCallLink } from '../../dm/group-call.ts';
import { useRiver } from '../../store.ts';
import { useCommunity } from '../store.ts';
import { Modal } from './common.tsx';
import { joinWithLink } from './StartScreen.tsx';
import { rich, tr } from '../../i18n.ts';

const editable = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

/** Asks before acting on a link that came from outside River (pasted, or "Open in River"). */
function offer(link: DeepLink): void {
  const s = useCommunity.getState();
  if (link.kind === 'device') {
    s.notify(
      tr(
        'That is a link code for a new device. Open it on the device you are adding, on its welcome screen.',
      ),
      'error',
    );
    return;
  }
  if (link.kind === 'call') {
    // A call link (2.18): "Ask to join"; nothing is sent until the person asks.
    offerCallLink(link.link);
    return;
  }
  if (link.kind === 'invite') {
    useRiver.getState().navigate('communities');
    s.setModal({ kind: 'join-invite', link: link.link });
    return;
  }
  if (link.kind === 'friend') {
    const friend = parseFriend(link.link);
    // The request goes through your own server: a bare River ID is enough to ask.
    if (friend)
      s.setModal({ kind: 'add-friend', riverId: friend.riverId, serverUrl: friend.serverUrl ?? '' });
    else
      s.notify(tr('That friend link is not complete. Ask for a new one, or add them by @username.'), 'error');
    return;
  }
  // A sign-up link is for someone without an account yet. It names the server the account would
  // live on, so a link from outside River only ever opens a question; nothing is created until
  // the person confirms (a web page must not be able to pick your server for you).
  if (useRiver.getState().account.state === 'none') {
    useRiver.getState().navigate('communities');
    s.setModal({ kind: 'signup', link: link.link });
  } else s.notify(tr('That sign-up link is for a new account — you already have one.'), 'error');
}

/**
 * Paste an invite or friend link anywhere in River (outside a text field) — or
 * click "Open in River" on an invite page — and River offers to join it.
 * Nothing is read from the clipboard unless you paste.
 */
export function PasteToJoin(): null {
  // River draws its shell for a moment before it knows whether this is the first run: a link
  // that opened River waits until there is an identity (the first screen takes invites itself).
  const ready = useRiver((r) => r.storage.state === 'open' && !!r.identity && !r.onboarding);
  useEffect(() => {
    if (!ready) return;
    // Links from the browser: taken once, whichever comes first (on start, or as they arrive).
    const take = (): void =>
      void window.river.app.takeDeepLink().then((link) => {
        if (link) offer(link);
      });
    take();
    return window.river.app.onDeepLink(take);
  }, [ready]);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (editable(e.target) || editable(document.activeElement)) return;
      const text = e.clipboardData?.getData('text') ?? '';
      const friend = parseFriend(text);
      if (parseCallLink(text)) {
        e.preventDefault();
        offerCallLink(text);
      } else if (looksLikeInvite(text)) {
        e.preventDefault();
        useCommunity.getState().setModal({ kind: 'join-invite', link: text.trim() });
      } else if (friend) {
        // A friend link, or a bare River ID (a link without its server address): River asks first.
        e.preventDefault();
        useCommunity
          .getState()
          .setModal({ kind: 'add-friend', riverId: friend.riverId, serverUrl: friend.serverUrl ?? '' });
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
    <Modal title={tr('Join this community?')} onClose={() => s.setModal(null)}>
      <p className="modal__text">
        {tr(
          "You've been invited to a River community. Joining shares your River name and avatar with its members.",
        )}
      </p>
      {error && <p className="field__error">{error}</p>}
      <div className="modal__foot">
        <button className="btn btn--link" onClick={() => s.setModal(null)}>
          {tr('Not now')}
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
          {busy ? tr('Joining…') : tr('Join community')}
        </button>
      </div>
    </Modal>
  );
}

/** Confirms a sign-up link from outside River, naming the server the account would be created on. */
export function SignupDialog({ link }: { link: string }): ReactElement {
  const s = useCommunity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseSignup(link);
  const host = parsed ? new URL(parsed.serverUrl).host : null;
  return (
    <Modal title={tr('Create your account here?')} onClose={() => s.setModal(null)}>
      <p className="modal__text">
        {host
          ? rich(
              tr(
                'This link would create your River account on {host}. That server will know your River ID and which devices you use, never your messages. Continue only if you trust whoever sent you this link.',
              ),
              { host: <strong>{host}</strong> },
            )
          : tr('This sign-up link is not valid.')}
      </p>
      {error && <p className="field__error">{error}</p>}
      <div className="modal__foot">
        <button className="btn btn--link" onClick={() => s.setModal(null)}>
          {tr('Not now')}
        </button>
        <button
          className="btn btn--primary"
          autoFocus
          disabled={busy || !host}
          onClick={() => {
            setBusy(true);
            void window.river.account.redeemSignup(link).then((res) => {
              setBusy(false);
              if (!res.ok) return setError(res.message);
              useRiver.getState().setAccount(res.value);
              s.notify(tr('Your account is ready'));
              s.setModal(null);
            });
          }}
        >
          {busy ? tr('Creating…') : tr('Create account')}
        </button>
      </div>
    </Modal>
  );
}

export function AddFriendDialog(props: { riverId: string; serverUrl: string }): ReactElement {
  const s = useCommunity();
  const account = useRiver((r) => r.account);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Just past the first screen (2.14), River may still be making your account: the request
  // can go as soon as it is ready, without leaving this dialog.
  const settingUp = account.state === 'none' && account.waiting === true;
  const problem = settingUp
    ? null
    : account.state !== 'registered'
      ? tr('You need an account first: join or create a community.')
      : account.riverId === props.riverId
        ? tr("That's your own friend link.")
        : null;
  return (
    <Modal title={tr('Add a friend?')} onClose={() => s.setModal(null)}>
      <p className="modal__text">
        {props.serverUrl ? tr('This is a River friend link.') : tr('You pasted a River ID.')}{' '}
        {tr('River will send them “{greeting}” as an end-to-end encrypted request.', {
          greeting: tr(GREETING),
        })}
      </p>
      {(problem ?? error) && <p className="field__error">{problem ?? error}</p>}
      {settingUp && (
        <p className="muted small" role="status">
          {tr('Setting up your account… The button works as soon as it is ready.')}
        </p>
      )}
      <div className="modal__foot">
        <button className="btn btn--link" onClick={() => s.setModal(null)}>
          {tr('Not now')}
        </button>
        <button
          className="btn btn--primary"
          autoFocus
          disabled={busy || settingUp || problem !== null}
          onClick={() => {
            setBusy(true);
            // Already a friend: their chat opens and nothing is sent; a request from them is accepted.
            void addFriend(props.riverId).then((result) => {
              setBusy(false);
              if (result === 'failed' || result === 'blocked') return setError(addFriendMessage(result));
              s.notify(result === 'friend' ? tr('You are already friends') : addFriendMessage(result));
              s.setModal(null);
            });
          }}
        >
          {busy ? tr('Sending…') : tr('Send friend request')}
        </button>
      </div>
    </Modal>
  );
}
