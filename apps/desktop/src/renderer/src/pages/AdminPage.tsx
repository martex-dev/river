import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { AdminAccount, AdminCommunity, AdminOverview } from '@river/protocol/admin';
import { BANNED_UNTIL } from '@river/protocol/admin';
import { play } from '../community/sound.ts';
import { useCommunity } from '../community/store.ts';
import { useDm } from '../dm/store.ts';
import { useRiver } from '../store.ts';

const TIMEOUTS: Array<[string, number]> = [
  ['1 hour', 60 * 60 * 1000],
  ['1 day', 24 * 60 * 60 * 1000],
  ['1 week', 7 * 24 * 60 * 60 * 1000],
];

type Confirm =
  | { kind: 'ban'; account: AdminAccount; name: string }
  | { kind: 'delete-account'; account: AdminAccount; name: string }
  | { kind: 'delete-community'; community: AdminCommunity; name: string };

/**
 * Admin (only on the PC that hosts River's server): everyone who uses this
 * server, and every community on it. The server knows ids, dates and counts —
 * never names or content — so names come from what this app already knows
 * (people you share a community or a conversation with).
 */
export function AdminPage(): ReactElement {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const me = useRiver((r) => (r.account.state === 'registered' ? r.account.riverId : null));
  const communities = useCommunity((c) => c.communities);
  const conversations = useDm((d) => d.conversations);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of communities) for (const m of c.members) map.set(m.riverId, m.name);
    for (const c of conversations) {
      if (c.kind === 'direct') map.set(c.riverId, c.name);
      for (const m of c.members) map.set(m.riverId, m.name);
    }
    return map;
  }, [communities, conversations]);
  const communityNames = useMemo(() => new Map(communities.map((c) => [c.id, c.name])), [communities]);
  const nameOf = (riverId: string): string => names.get(riverId) ?? `River user ${riverId.slice(0, 8)}`;

  const apply = useCallback((res: Awaited<ReturnType<typeof window.river.admin.overview>>): void => {
    if (res.ok) {
      setData(res.value);
      setError(null);
    } else setError(res.message);
  }, []);
  const load = useCallback(async (): Promise<void> => apply(await window.river.admin.overview()), [apply]);
  useEffect(() => {
    // Fresh numbers every 15 s: who is online, new people, new communities.
    const refresh = (): void => void window.river.admin.overview().then(apply);
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(timer);
  }, [apply]);

  const act = async (key: string, fn: () => Promise<{ ok: boolean; message?: string }>): Promise<void> => {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    setConfirm(null);
    if (!res.ok) {
      play('error');
      setError(res.message ?? 'That did not work.');
      return;
    }
    play('success');
    await load();
  };

  const q = filter.trim().toLowerCase();
  const people = (data?.accounts ?? []).filter(
    (a) => !q || nameOf(a.riverId).toLowerCase().includes(q) || a.riverId.includes(q),
  );
  const online = data?.accounts.filter((a) => a.online).length ?? 0;
  const suspended = data?.accounts.filter((a) => a.suspendedUntil).length ?? 0;

  return (
    <div className="page admin">
      <header className="page__header">
        <div className="eyebrow">Admin</div>
        <h1 className="page__title">Your River server</h1>
        <p className="page__lead">
          Everyone who uses River through your server, and every community on it. The server never sees
          messages or names; names show for people you share a community or a conversation with.
        </p>
      </header>

      {error && (
        <div className="glass card card--error" role="alert">
          {error}
        </div>
      )}

      {data && (
        <div className="admin__stats" role="list">
          <Stat label="People" value={data.accounts.length} />
          <Stat label="Online now" value={online} />
          <Stat label="Communities" value={data.communities.length} />
          <Stat label="Timed out or banned" value={suspended} />
        </div>
      )}

      <section className="glass card admin__section" aria-labelledby="admin-people">
        <div className="admin__head">
          <h2 id="admin-people" className="card__title">
            People
          </h2>
          <input
            className="admin__search"
            aria-label="Search people"
            placeholder="Search by name or ID"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {!data && !error && <p className="muted small">Loading…</p>}
        {data && people.length === 0 && <p className="muted small">Nobody matches.</p>}
        <ul className="admin__list">
          {people.map((a) => {
            const name = nameOf(a.riverId);
            const banned = a.suspendedUntil === BANNED_UNTIL;
            const isMe = a.riverId === me;
            return (
              <li key={a.riverId} className="admin__row">
                <div className="admin__who">
                  <span
                    className={`status-dot ${a.online ? 'status-dot--active' : ''}`}
                    aria-label={a.online ? 'Online' : 'Offline'}
                    role="img"
                  />
                  <div>
                    <strong>{name}</strong>
                    {isMe && <span className="chip admin__chip">You</span>}
                    {a.suspendedUntil && (
                      <span className="chip chip--error admin__chip">
                        {banned ? 'Banned' : `Timed out until ${new Date(a.suspendedUntil).toLocaleString()}`}
                      </span>
                    )}
                    <div className="muted small">
                      Joined {a.createdOn} · {a.communities}{' '}
                      {a.communities === 1 ? 'community' : 'communities'} · {a.devices}{' '}
                      {a.devices === 1 ? 'device' : 'devices'}
                      {a.suspendReason ? ` · Reason: ${a.suspendReason}` : ''}
                    </div>
                  </div>
                </div>
                {!isMe && (
                  <div className="admin__actions">
                    {a.suspendedUntil ? (
                      <button
                        className="btn btn--ghost btn--small"
                        disabled={busy !== null}
                        onClick={() =>
                          void act(`un:${a.riverId}`, () => window.river.admin.unsuspend(a.riverId))
                        }
                      >
                        {banned ? 'Unban' : 'End timeout'}
                      </button>
                    ) : (
                      <>
                        <select
                          className="admin__timeout"
                          aria-label={`Time out ${name}`}
                          value=""
                          disabled={busy !== null}
                          onChange={(e) => {
                            const ms = Number(e.target.value);
                            if (!ms) return;
                            const until = new Date(Date.now() + ms).toISOString();
                            void act(`to:${a.riverId}`, () => window.river.admin.suspend(a.riverId, until));
                          }}
                        >
                          <option value="">Time out…</option>
                          {TIMEOUTS.map(([label, ms]) => (
                            <option key={label} value={ms}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn--ghost btn--small"
                          disabled={busy !== null}
                          onClick={() => setConfirm({ kind: 'ban', account: a, name })}
                        >
                          Ban
                        </button>
                      </>
                    )}
                    <button
                      className="btn btn--danger btn--small"
                      disabled={busy !== null}
                      onClick={() => setConfirm({ kind: 'delete-account', account: a, name })}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="glass card admin__section" aria-labelledby="admin-communities">
        <h2 id="admin-communities" className="card__title">
          Communities
        </h2>
        {data && data.communities.length === 0 && <p className="muted small">No communities yet.</p>}
        <ul className="admin__list">
          {(data?.communities ?? []).map((c) => {
            const name = communityNames.get(c.id) ?? 'A community you are not in';
            return (
              <li key={c.id} className="admin__row">
                <div>
                  <strong>{name}</strong>
                  <div className="muted small">
                    Owner {nameOf(c.owner)} · {c.members} {c.members === 1 ? 'member' : 'members'} ·{' '}
                    {c.channels} {c.channels === 1 ? 'channel' : 'channels'} · created {c.createdOn}
                  </div>
                </div>
                <div className="admin__actions">
                  <button
                    className="btn btn--danger btn--small"
                    disabled={busy !== null}
                    onClick={() => setConfirm({ kind: 'delete-community', community: c, name })}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {confirm && (
        <div className="modal" role="presentation" onClick={() => setConfirm(null)}>
          <div
            className="modal__card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="admin-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <ConfirmBody
              confirm={confirm}
              busy={busy !== null}
              onCancel={() => setConfirm(null)}
              onConfirm={(reason) => {
                if (confirm.kind === 'ban') {
                  const id = confirm.account.riverId;
                  void act(`ban:${id}`, () => window.river.admin.suspend(id, null, reason || undefined));
                } else if (confirm.kind === 'delete-account') {
                  const id = confirm.account.riverId;
                  void act(`del:${id}`, () => window.river.admin.deleteAccount(id));
                } else {
                  const id = confirm.community.id;
                  void act(`delc:${id}`, () => window.river.admin.deleteCommunity(id));
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat(props: { label: string; value: number }): ReactElement {
  return (
    <div className="glass admin__stat" role="listitem">
      <span className="admin__stat-value">{props.value}</span>
      <span className="muted small">{props.label}</span>
    </div>
  );
}

function ConfirmBody(props: {
  confirm: Confirm;
  busy: boolean;
  onCancel(): void;
  onConfirm(reason: string): void;
}): ReactElement {
  const [reason, setReason] = useState('');
  const c = props.confirm;
  const title =
    c.kind === 'ban'
      ? `Ban ${c.name}?`
      : c.kind === 'delete-account'
        ? `Remove ${c.name}?`
        : `Delete ${c.name}?`;
  const body =
    c.kind === 'ban'
      ? 'They are signed out at once and cannot use River on your server until you unban them. Nothing is deleted.'
      : c.kind === 'delete-account'
        ? 'Their account leaves your server: they are removed from every community, communities they own are deleted, and they would need to create a new account. Messages they already sent stay.'
        : `The community, its channels and its messages are deleted for all ${c.community.members} members. This cannot be undone.`;
  return (
    <>
      <h2 id="admin-confirm-title" className="card__title">
        {title}
      </h2>
      <p className="modal__text">{body}</p>
      {c.kind === 'ban' && (
        <label className="textfield">
          <span className="field__label">Reason (optional, shown to them)</span>
          <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      <div className="modal__foot">
        <button
          className="btn btn--danger"
          disabled={props.busy}
          onClick={() => props.onConfirm(reason.trim())}
        >
          {c.kind === 'ban' ? 'Ban' : c.kind === 'delete-account' ? 'Remove account' : 'Delete community'}
        </button>
        <button className="btn btn--ghost" autoFocus onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}
