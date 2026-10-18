import { useEffect, useState, type ReactElement } from 'react';
import type { CallLinkView, CallView } from '../../../shared/dm.ts';
import { useCommunity } from '../community/store.ts';
import { Avatar } from '../community/ui/common.tsx';
import { startDmCall, useDmCall } from '../dm/call.ts';
import { createCallLink, startGroupCall, startLinkCall, useGroupCall } from '../dm/group-call.ts';
import { useDm } from '../dm/store.ts';
import { callOutcome, callTitle } from '../pages/CallsPage.tsx';
import { useRiver } from '../store.ts';
import { clockTime } from '../time.ts';
import { useCallHistory } from './calls.ts';
import {
  CallInIcon,
  CallOutIcon,
  CopyIcon,
  LinkIcon,
  PhoneCallIcon,
  TrashIcon,
  VideoIcon,
} from './icons.tsx';
import { openPhoneChat } from './nav.ts';
import { TabPage } from './ui.tsx';

/** "12:04", "Yesterday", "Monday", "3 Oct": when a call was, as in Telegram's list. */
export function callWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days <= 0) return clockTime(iso);
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** "Missed", "Outgoing · 4 min"… */
function describe(c: CallView): string {
  const outcome = callOutcome(c);
  const kind = c.video ? 'video' : 'voice';
  if (outcome === 'answered') {
    const mins = Math.max(1, Math.round(c.durationSec / 60));
    return `${c.direction === 'in' ? 'Incoming' : 'Outgoing'} ${kind} · ${c.durationSec < 60 ? `${c.durationSec} s` : `${mins} min`}`;
  }
  if (outcome === 'declined') return `Declined ${kind}`;
  if (outcome === 'failed') return `Could not connect`;
  return c.direction === 'in' ? `Missed ${kind}` : `No answer`;
}

/**
 * Your call links (2.19), as on a computer's Calls page: make one, and for each one copy it again,
 * start its call or stop it working. Without this list a link was gone once its dialog closed.
 */
function PhoneCallLinks(props: { busy: boolean }): ReactElement {
  const [links, setLinks] = useState<CallLinkView[]>([]);
  const made = useGroupCall((s) => s.madeLink);
  const notify = useCommunity((s) => s.notify);
  useEffect(() => {
    let live = true;
    void window.river.dm.action({ a: 'callLinks' }).then((r) => {
      if (live && r.ok) setLinks(r.value);
    });
    return () => {
      live = false;
    };
  }, [made]);
  return (
    <ul className="plist pcall-links" aria-label="Call links">
      <li>
        <button className="prow pcall-links__new" onClick={() => void createCallLink(false)}>
          <span className="pcall-links__icon" aria-hidden="true">
            <LinkIcon size={22} />
          </span>
          <span className="prow__main">
            <strong className="prow__name">Create call link</strong>
            <span className="prow__preview">Anyone with it can ask to join; you let each person in</span>
          </span>
        </button>
      </li>
      {links.map((l) => (
        <li key={l.id} className="pcall pcall-links__link">
          <div className="prow">
            <span className="pcall-links__icon" aria-hidden="true">
              {l.video ? <VideoIcon size={22} /> : <LinkIcon size={22} />}
            </span>
            <span className="prow__main">
              <strong className="prow__name">{l.title ?? (l.video ? 'Video call link' : 'Call link')}</strong>
              <span className="prow__preview">
                Until {new Date(l.expiresAt).toLocaleDateString([], { day: 'numeric', month: 'short' })} ·{' '}
                {l.admitted.length} let in
              </span>
            </span>
            <button
              className="pcall-links__action"
              aria-label="Copy call link"
              onClick={() =>
                void navigator.clipboard
                  .writeText(l.url)
                  .then(() => notify('Call link copied.'))
                  .catch(() => notify('Could not copy the link.', 'error'))
              }
            >
              <CopyIcon size={22} />
            </button>
            <button
              className="pcall-links__action"
              aria-label="Start the call of this link"
              disabled={props.busy}
              onClick={() => void startLinkCall(l)}
            >
              <PhoneCallIcon size={22} />
            </button>
            <button
              className="pcall-links__action pcall-links__action--danger"
              aria-label="Stop this call link"
              onClick={() =>
                void window.river.dm
                  .action({ a: 'revokeCallLink', link: l.id })
                  .then(() => setLinks((all) => all.filter((x) => x.id !== l.id)))
              }
            >
              <TrashIcon size={22} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Calls (2.12): the call history as in Telegram, with a call-back button on every row. */
export function CallsTab(): ReactElement {
  const history = useCallHistory();
  const account = useRiver((r) => r.account);
  const inGroupCall = useGroupCall((s) => !!s.active);
  const busy = useDmCall((s) => !!s.active || !!s.incoming) || inGroupCall;
  const [only, setOnly] = useState<'all' | 'missed'>('all');
  const conversations = useDm((d) => d.conversations);
  useEffect(() => {
    void useCallHistory.getState().load();
    useCallHistory.getState().markSeen();
    // Calls missed while you looked at this list are seen too.
    return () => useCallHistory.getState().markSeen();
  }, [account.state]);
  const calls = (history.calls ?? []).filter(
    (c) => only === 'all' || (c.direction === 'in' && callOutcome(c) === 'missed'),
  );
  const call = (c: CallView): void => {
    openPhoneChat(c.peer);
    // A group call (2.18) calls the group again.
    if (c.kind === 'group') void startGroupCall(c.peer, c.video);
    else void startDmCall(c.peer, c.video);
  };
  return (
    <TabPage title="Calls">
      {account.state !== 'registered' ? (
        <div className="pempty">
          <div className="pempty__icon" aria-hidden="true">
            📞
          </div>
          <h2>No account yet</h2>
          <p>Calls need an account on a River server.</p>
        </div>
      ) : (
        <>
          <PhoneCallLinks busy={busy} />
          <div className="psegment" role="radiogroup" aria-label="Show calls">
            {(['all', 'missed'] as const).map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={only === id}
                className={`psegment__item ${only === id ? 'is-active' : ''}`}
                onClick={() => setOnly(id)}
              >
                {id === 'all' ? 'All' : 'Missed'}
              </button>
            ))}
          </div>
          {history.calls === null ? (
            <p className="pempty pempty--small">Loading…</p>
          ) : calls.length === 0 ? (
            <div className="pempty pempty--small">
              <p>
                {only === 'missed'
                  ? 'No missed calls.'
                  : 'No calls yet. Call a friend from your chat with them.'}
              </p>
            </div>
          ) : (
            <ul className="plist" aria-label="Recent calls">
              {calls.map((c) => {
                const missed = c.direction === 'in' && callOutcome(c) === 'missed';
                // A call through a call link has no chat to open (its "peer" is the link's host, you
                // included: that opened Note to self), nor has a chat that is gone.
                const chat = c.kind !== 'link' && conversations.some((x) => x.riverId === c.peer && !x.self);
                const Row = chat ? 'button' : 'div';
                return (
                  <li key={c.id} className="pcall">
                    <Row
                      className={`prow pcall__row ${missed ? 'is-missed' : ''}`}
                      {...(chat ? { onClick: () => openPhoneChat(c.peer) } : {})}
                    >
                      <Avatar id={c.peer} name={c.name} avatar={c.avatar} size={44} />
                      <span className="prow__main">
                        <span className="prow__top">
                          <strong className="prow__name">{callTitle(c)}</strong>
                          <time className="prow__time">{callWhen(c.startedAt)}</time>
                        </span>
                        <span className="prow__bottom">
                          <span className="prow__preview pcall__what">
                            <span className={`pcall__arrow ${missed ? 'is-missed' : ''}`} aria-hidden="true">
                              {c.direction === 'in' ? <CallInIcon size={15} /> : <CallOutIcon size={15} />}
                            </span>
                            {describe(c)}
                          </span>
                        </span>
                      </span>
                    </Row>
                    <button
                      className="pcall__back"
                      aria-label={`${c.video ? 'Video call' : 'Call'} ${c.name}`}
                      disabled={
                        busy ||
                        c.kind === 'link' ||
                        !conversations.some((x) => x.riverId === c.peer && x.state !== 'left')
                      }
                      onClick={() => call(c)}
                    >
                      {c.video ? <VideoIcon size={24} /> : <PhoneCallIcon size={23} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </TabPage>
  );
}
