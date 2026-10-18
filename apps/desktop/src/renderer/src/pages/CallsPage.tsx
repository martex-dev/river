import { useEffect, useState, type ReactElement } from 'react';
import type { CallLinkView, CallView } from '../../../shared/dm.ts';
import { Avatar } from '../community/ui/common.tsx';
import { useCommunity } from '../community/store.ts';
import { startDmCall, useDmCall } from '../dm/call.ts';
import { createCallLink, startGroupCall, startLinkCall, useGroupCall } from '../dm/group-call.ts';
import { useDm } from '../dm/store.ts';
import { tr, trn } from '../i18n.ts';
import { dateLocale } from '../time.ts';
import { useRiver } from '../store.ts';

const duration = (s: number): string =>
  s < 60
    ? `${s}s`
    : s < 3600
      ? `${Math.floor(s / 60)}m ${s % 60}s`
      : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

/** How a call ended (entries from older versions only know answered or not). */
export function callOutcome(
  c: Pick<CallView, 'answered'> & { outcome?: CallView['outcome'] },
): CallView['outcome'] {
  return c.answered ? 'answered' : (c.outcome ?? 'missed');
}

/** "↙ Missed", "↗ Declined", "↙ Could not connect"… */
export function callLabel(
  c: Pick<CallView, 'answered' | 'direction'> & { outcome?: CallView['outcome'] },
): string {
  const arrow = c.direction === 'in' ? '↙' : '↗';
  switch (callOutcome(c)) {
    case 'answered':
      return `${arrow} ${c.direction === 'in' ? tr('Incoming') : tr('Outgoing')}`;
    case 'declined':
      return `${arrow} ${tr('Declined')}`;
    case 'failed':
      return `${arrow} ${tr('Could not connect')}`;
    case 'busy':
      return `${arrow} ${tr('Busy')}`;
    case 'missed':
      return `${arrow} ${c.direction === 'in' ? tr('Missed') : tr('No answer')}`;
  }
}

/** "Group call · Climbing", "Call link · Alice": what a call-history row is (2.18). */
export function callTitle(c: Pick<CallView, 'name' | 'kind' | 'people'>): string {
  if (c.kind === 'group')
    return c.people && c.people > 1
      ? tr('{name} · group call ({count})', { name: c.name, count: c.people })
      : tr('{name} · group call', { name: c.name });
  if (c.kind === 'link') return tr('{name} · call link', { name: c.name });
  return c.name;
}

/** Your call links (2.18): start the call, copy the link, or stop it working. */
function CallLinks(props: { busy: boolean }): ReactElement {
  const [links, setLinks] = useState<CallLinkView[]>([]);
  const made = useGroupCall((s) => s.madeLink);
  const notify = useCommunity((s) => s.notify);
  useEffect(() => {
    void window.river.dm.action({ a: 'callLinks' }).then((r) => {
      if (r.ok) setLinks(r.value);
    });
  }, [made]);
  return (
    <section className="glass calls__people" aria-label={tr('Call links')}>
      <h2 className="contacts__title">{tr('Call links')}</h2>
      <p className="muted small">
        {tr(
          'Anyone with a call link can ask to join; you let each person in. Good for calls with people outside a group.',
        )}
      </p>
      <div className="call-row">
        <button className="btn btn--primary btn--small" onClick={() => void createCallLink(false)}>
          {tr('Create call link')}
        </button>
        <button className="btn btn--ghost btn--small" onClick={() => void createCallLink(true)}>
          {tr('Video call link')}
        </button>
      </div>
      {links.map((l) => (
        <div key={l.id} className="call-row">
          <span className="dm-row__text">
            <strong>{l.title ?? (l.video ? tr('Video call link') : tr('Call link'))}</strong>
            <span className="muted small">
              {tr('Works until {date}', { date: new Date(l.expiresAt).toLocaleDateString(dateLocale()) })} ·{' '}
              {trn('{count} let in', l.admitted.length)}
            </span>
          </span>
          <button
            className="icon-btn"
            aria-label={tr('Copy call link')}
            title={tr('Copy the link')}
            onClick={() =>
              void navigator.clipboard
                .writeText(l.url)
                .then(() => notify(tr('Call link copied.')))
                .catch(() => notify(tr('Could not copy the link.'), 'error'))
            }
          >
            🔗
          </button>
          <button
            className="icon-btn"
            aria-label={tr('Start the call of this link')}
            disabled={props.busy}
            onClick={() => void startLinkCall(l)}
          >
            📞
          </button>
          <button
            className="icon-btn"
            aria-label={tr('Stop this call link')}
            title={tr('Stop this link working')}
            onClick={() =>
              void window.river.dm
                .action({ a: 'revokeCallLink', link: l.id })
                .then(() => setLinks(links.filter((x) => x.id !== l.id)))
            }
          >
            ✕
          </button>
        </div>
      ))}
    </section>
  );
}

/** Call history and quick calls to your contacts. */
export function CallsPage(): ReactElement {
  const account = useRiver((r) => r.account);
  const navigate = useRiver((r) => r.navigate);
  const active = useDmCall((s) => s.active);
  // One call at a time: none while one is on or ringing (a group call too, 2.18).
  const inGroupCall = useGroupCall((s) => !!s.active);
  const busy = useDmCall((s) => !!s.active || !!s.incoming) || inGroupCall;
  const dm = useDm();
  const [calls, setCalls] = useState<CallView[] | null>(null);

  useEffect(() => {
    if (account.state !== 'registered') return;
    let live = true;
    const load = (): void =>
      void window.river.dm.action({ a: 'calls' }).then((r) => {
        if (live) setCalls(r.ok ? r.value : []);
      });
    load();
    // A call added to the history (missed while you look at this page, declined, ended) shows at once.
    const off = window.river.dm.onEvent((e) => {
      if (e.t === 'calls') load();
    });
    return () => {
      live = false;
      off();
    };
  }, [account.state, active]);

  const call = (peer: string, video: boolean, kind?: CallView['kind']): void => {
    navigate('messages');
    dm.select(peer);
    if (kind === 'group') void startGroupCall(peer, video);
    else void startDmCall(peer, video);
  };
  /** A call-link call has nobody to call back; a group you left cannot be called. */
  const canCallBack = (c: CallView): boolean =>
    c.kind === 'link'
      ? false
      : c.kind === 'group'
        ? dm.conversations.some((x) => x.riverId === c.peer && x.state === 'accepted')
        : true;
  // Contacts who accepted (a request still waiting for their answer cannot be called yet).
  const friends = dm.conversations.filter(
    (c) => c.kind === 'direct' && !c.self && c.state === 'accepted' && !c.awaitingReply,
  );

  return (
    <div className="page calls">
      <header className="page__header">
        <div className="eyebrow">{tr('Calls')}</div>
        <h1 className="page__title">{tr('Calls')}</h1>
        <p className="page__lead">
          {tr(
            'Voice and video calls go directly between devices, encrypted with DTLS-SRTP; call setup travels inside end-to-end encrypted messages. Your call history is kept only on this computer.',
          )}
        </p>
      </header>
      {account.state !== 'registered' ? (
        <p className="muted">{tr('Calls need an account on a River server.')}</p>
      ) : (
        <div className="calls__layout">
          <section className="glass calls__history" aria-label={tr('Recent calls')}>
            <h2 className="contacts__title">{tr('Recent')}</h2>
            {calls === null && <p className="muted">{tr('Loading…')}</p>}
            {calls?.length === 0 && <p className="muted small">{tr('No calls yet.')}</p>}
            {calls?.map((c) => (
              <div key={c.id} className="call-row">
                <Avatar id={c.peer} name={c.name} avatar={c.avatar} size={36} />
                <span className="dm-row__text">
                  <strong
                    className={callOutcome(c) === 'missed' && c.direction === 'in' ? 'call-row__missed' : ''}
                  >
                    {callTitle(c)}
                  </strong>
                  <span className="muted small">
                    {callLabel(c)}
                    {c.video ? ` ${tr('video')}` : ''} ·{' '}
                    {new Date(c.startedAt).toLocaleString(dateLocale(), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                    {c.answered ? ` · ${duration(c.durationSec)}` : ''}
                  </span>
                </span>
                <button
                  className="icon-btn"
                  aria-label={tr('Call {name}', { name: c.name })}
                  disabled={busy || !canCallBack(c)}
                  onClick={() => call(c.peer, false, c.kind)}
                >
                  📞
                </button>
                <button
                  className="icon-btn"
                  aria-label={tr('Video call {name}', { name: c.name })}
                  disabled={busy || !canCallBack(c)}
                  onClick={() => call(c.peer, true, c.kind)}
                >
                  🎥
                </button>
              </div>
            ))}
          </section>
          <CallLinks busy={busy} />
          <section className="glass calls__people" aria-label={tr('Call a contact')}>
            <h2 className="contacts__title">{tr('Call a contact')}</h2>
            {friends.length === 0 && <p className="muted small">{tr('Your contacts appear here.')}</p>}
            {friends.map((f) => (
              <div key={f.riverId} className="call-row">
                <Avatar id={f.riverId} name={f.name} avatar={f.avatar} size={32} />
                <span className="dm-row__text">
                  <strong>{f.name}</strong>
                </span>
                <button
                  className="icon-btn"
                  aria-label={tr('Call {name}', { name: f.name })}
                  disabled={busy}
                  onClick={() => call(f.riverId, false)}
                >
                  📞
                </button>
                <button
                  className="icon-btn"
                  aria-label={tr('Video call {name}', { name: f.name })}
                  disabled={busy}
                  onClick={() => call(f.riverId, true)}
                >
                  🎥
                </button>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
