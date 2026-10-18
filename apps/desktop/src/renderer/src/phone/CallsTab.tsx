import { useEffect, useState, type ReactElement } from 'react';
import type { CallView } from '../../../shared/dm.ts';
import { Avatar } from '../community/ui/common.tsx';
import { startDmCall, useDmCall } from '../dm/call.ts';
import { createCallLink, startGroupCall, useGroupCall } from '../dm/group-call.ts';
import { useDm } from '../dm/store.ts';
import { callOutcome, callTitle } from '../pages/CallsPage.tsx';
import { tr, trn } from '../i18n.ts';
import { useRiver } from '../store.ts';
import { clockTime, dateLocale } from '../time.ts';
import { useCallHistory } from './calls.ts';
import { CallInIcon, CallOutIcon, PhoneCallIcon, VideoIcon } from './icons.tsx';
import { openPhoneChat } from './nav.ts';
import { TabPage } from './ui.tsx';

/** "12:04", "Yesterday", "Monday", "3 Oct": when a call was, as in Telegram's list. */
export function callWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days <= 0) return clockTime(iso);
  if (days === 1) return tr('Yesterday');
  if (days < 7) return d.toLocaleDateString(dateLocale(), { weekday: 'long' });
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
}

/** "Missed", "Outgoing · 4 min"… */
function describe(c: CallView): string {
  const outcome = callOutcome(c);
  if (outcome === 'answered') {
    const mins = Math.max(1, Math.round(c.durationSec / 60));
    const how =
      c.direction === 'in'
        ? c.video
          ? tr('Incoming video')
          : tr('Incoming voice')
        : c.video
          ? tr('Outgoing video')
          : tr('Outgoing voice');
    const long = c.durationSec < 60 ? trn('{count} s', c.durationSec) : trn('{count} min', mins);
    return `${how} · ${long}`;
  }
  if (outcome === 'declined') return c.video ? tr('Declined video') : tr('Declined voice');
  if (outcome === 'failed') return tr('Could not connect');
  if (c.direction !== 'in') return tr('No answer');
  return c.video ? tr('Missed video') : tr('Missed voice');
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
    <TabPage title={tr('Calls')}>
      {account.state !== 'registered' ? (
        <div className="pempty">
          <div className="pempty__icon" aria-hidden="true">
            📞
          </div>
          <h2>{tr('No account yet')}</h2>
          <p>{tr('Calls need an account on a River server.')}</p>
        </div>
      ) : (
        <>
          <div className="pcall__links">
            <button className="btn btn--ghost btn--small" onClick={() => void createCallLink(false)}>
              🔗 {tr('Create call link')}
            </button>
          </div>
          <div className="psegment" role="radiogroup" aria-label={tr('Show calls')}>
            {(['all', 'missed'] as const).map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={only === id}
                className={`psegment__item ${only === id ? 'is-active' : ''}`}
                onClick={() => setOnly(id)}
              >
                {id === 'all' ? tr('All') : tr('Missed')}
              </button>
            ))}
          </div>
          {history.calls === null ? (
            <p className="pempty pempty--small">{tr('Loading…')}</p>
          ) : calls.length === 0 ? (
            <div className="pempty pempty--small">
              <p>
                {only === 'missed'
                  ? tr('No missed calls.')
                  : tr('No calls yet. Call a friend from your chat with them.')}
              </p>
            </div>
          ) : (
            <ul className="plist" aria-label={tr('Recent calls')}>
              {calls.map((c) => {
                const missed = c.direction === 'in' && callOutcome(c) === 'missed';
                return (
                  <li key={c.id} className="pcall">
                    <button
                      className={`prow pcall__row ${missed ? 'is-missed' : ''}`}
                      onClick={() => openPhoneChat(c.peer)}
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
                    </button>
                    <button
                      className="pcall__back"
                      aria-label={
                        c.video
                          ? tr('Video call {name}', { name: c.name })
                          : tr('Call {name}', { name: c.name })
                      }
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
