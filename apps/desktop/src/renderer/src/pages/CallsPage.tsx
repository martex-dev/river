import { useEffect, useState, type ReactElement } from 'react';
import type { CallView } from '../../../shared/dm.ts';
import { Avatar } from '../community/ui/common.tsx';
import { startDmCall, useDmCall } from '../dm/call.ts';
import { useDm } from '../dm/store.ts';
import { useRiver } from '../store.ts';

const duration = (s: number): string =>
  s < 60
    ? `${s}s`
    : s < 3600
      ? `${Math.floor(s / 60)}m ${s % 60}s`
      : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

/** Call history and quick calls to your contacts. */
export function CallsPage(): ReactElement {
  const account = useRiver((r) => r.account);
  const navigate = useRiver((r) => r.navigate);
  const active = useDmCall((s) => s.active);
  const dm = useDm();
  const [calls, setCalls] = useState<CallView[] | null>(null);

  useEffect(() => {
    if (account.state !== 'registered') return;
    void window.river.dm.action({ a: 'calls' }).then((r) => setCalls(r.ok ? r.value : []));
  }, [account.state, active]);

  const call = (peer: string, video: boolean): void => {
    navigate('messages');
    dm.select(peer);
    void startDmCall(peer, video);
  };
  const friends = dm.conversations.filter((c) => c.kind === 'direct' && c.state === 'accepted');

  return (
    <div className="page calls">
      <header className="page__header">
        <div className="eyebrow">Calls</div>
        <h1 className="page__title">Calls</h1>
        <p className="page__lead">
          Voice and video calls go directly between devices, encrypted with DTLS-SRTP; call setup travels
          inside end-to-end encrypted messages. Your call history is kept only on this computer.
        </p>
      </header>
      {account.state !== 'registered' ? (
        <p className="muted">Calls need an account on a River server.</p>
      ) : (
        <div className="calls__layout">
          <section className="glass calls__history" aria-label="Recent calls">
            <h2 className="contacts__title">Recent</h2>
            {calls === null && <p className="muted">Loading…</p>}
            {calls?.length === 0 && <p className="muted small">No calls yet.</p>}
            {calls?.map((c) => (
              <div key={c.id} className="call-row">
                <Avatar id={c.peer} name={c.name} avatar={c.avatar} size={36} />
                <span className="dm-row__text">
                  <strong className={!c.answered && c.direction === 'in' ? 'call-row__missed' : ''}>
                    {c.name}
                  </strong>
                  <span className="muted small">
                    {c.direction === 'in'
                      ? c.answered
                        ? '↙ Incoming'
                        : '↙ Missed'
                      : c.answered
                        ? '↗ Outgoing'
                        : '↗ No answer'}
                    {c.video ? ' video' : ''} ·{' '}
                    {new Date(c.startedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    {c.answered ? ` · ${duration(c.durationSec)}` : ''}
                  </span>
                </span>
                <button
                  className="icon-btn"
                  aria-label={`Call ${c.name}`}
                  disabled={!!active}
                  onClick={() => call(c.peer, false)}
                >
                  📞
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Video call ${c.name}`}
                  disabled={!!active}
                  onClick={() => call(c.peer, true)}
                >
                  🎥
                </button>
              </div>
            ))}
          </section>
          <section className="glass calls__people" aria-label="Call a contact">
            <h2 className="contacts__title">Call a contact</h2>
            {friends.length === 0 && <p className="muted small">Your contacts appear here.</p>}
            {friends.map((f) => (
              <div key={f.riverId} className="call-row">
                <Avatar id={f.riverId} name={f.name} avatar={f.avatar} size={32} />
                <span className="dm-row__text">
                  <strong>{f.name}</strong>
                </span>
                <button
                  className="icon-btn"
                  aria-label={`Call ${f.name}`}
                  disabled={!!active}
                  onClick={() => call(f.riverId, false)}
                >
                  📞
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Video call ${f.name}`}
                  disabled={!!active}
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
