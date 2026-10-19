import { useEffect, useState, type ReactElement } from 'react';
import type { ActivitySummary } from '../../../../shared/insights.ts';
import { joinsPerWeek } from '../../../../shared/insights.ts';
import type { CommunityView } from '../../../../shared/ipc.ts';
import { useCommunity } from '../store.ts';
import { hex } from './common.tsx';
import { tr, trn } from '../../i18n.ts';

function Bars(props: { values: number[]; labels: string[]; label: string }): ReactElement {
  const max = Math.max(1, ...props.values);
  return (
    <div className="bars" role="img" aria-label={props.label}>
      {props.values.map((v, i) => (
        <div key={i} className="bars__col" title={`${props.labels[i]}: ${v}`}>
          <div className="bars__bar" style={{ height: `${(v / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

/** Community settings → Insights (1.0.26): counted on your device from what you can see. */
export function InsightsPanel({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const [days, setDays] = useState<7 | 30>(7);
  const [loaded, setLoaded] = useState<{ key: string; data: ActivitySummary | null } | null>(null);
  // Only show numbers for the period and community on screen.
  const activity = loaded?.key === `${community.id}:${days}` ? loaded.data : null;
  const [now] = useState(() => new Date());
  useEffect(() => {
    let alive = true;
    const key = `${community.id}:${days}`;
    void s.run({ a: 'activity', communityId: community.id, days }).then((data) => {
      if (alive) setLoaded({ key, data });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community.id, days]);
  const members = community.members;
  const online = members.filter((m) => m.online).length;
  const weeks = joinsPerWeek(
    members.map((m) => m.joinedOn),
    now,
    8,
  );
  const newThisWeek = weeks.at(-1) ?? 0;
  const roleCounts = community.roles
    .filter((r) => !r.everyone)
    .map((r) => ({ r, n: members.filter((m) => m.roles.includes(r.id)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const channelName = (id: string): string =>
    community.channels.find((c) => c.id === id)?.name ?? tr('channel');
  const personName = (id: string): string =>
    members.find((m) => m.riverId === id)?.name ?? tr('Someone who left');
  const copy = (): void => {
    if (!activity) return;
    const lines = [
      `${community.name} — ${trn('last {count} days', days)}`,
      `${tr('Members')}\t${members.length}`,
      `${tr('Messages')}\t${activity.total}`,
      ...activity.days.map((d) => `${d.date}\t${d.count}`),
      ...activity.channels.map((c) => `#${channelName(c.channelId)}\t${c.count}`),
    ];
    void navigator.clipboard.writeText(lines.join('\n')).then(() => s.notify(tr('Copied.')));
  };
  return (
    <div className="settings-page insights">
      <h2>{tr('Insights')}</h2>
      <p className="muted small">
        {tr(
          'Counted on your device from messages you can read; the server cannot see them, so it cannot count them.',
        )}
      </p>
      <div className="insights__cards">
        <div className="insights__card">
          <strong>{members.length}</strong>
          <span className="muted small">{tr('members')}</span>
        </div>
        <div className="insights__card">
          <strong>{online}</strong>
          <span className="muted small">{tr('online now')}</span>
        </div>
        <div className="insights__card">
          <strong>{newThisWeek}</strong>
          <span className="muted small">{tr('joined this week')}</span>
        </div>
        <div className="insights__card">
          <strong>{activity ? activity.total : '…'}</strong>
          <span className="muted small">{trn('messages, last {count} days', days)}</span>
        </div>
      </div>
      <div className="insights__head">
        <h3>{tr('Messages per day')}</h3>
        <div className="segmented" role="radiogroup" aria-label={tr('Period')}>
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              role="radio"
              aria-checked={days === d}
              className={`segmented__item ${days === d ? 'is-active' : ''}`}
              onClick={() => setDays(d)}
            >
              {trn('{count} days', d)}
            </button>
          ))}
        </div>
        <button className="btn btn--ghost btn--small" disabled={!activity} onClick={copy}>
          {tr('Copy')}
        </button>
      </div>
      {activity ? (
        <>
          <Bars
            values={activity.days.map((d) => d.count)}
            labels={activity.days.map((d) => d.date)}
            label={trn('Messages per day over the last {count} days', days)}
          />
          {activity.partial && (
            <p className="muted small">{tr('Some busy channels have more history than River counted.')}</p>
          )}
          <div className="insights__cols">
            <div>
              <h3>{tr('Busiest channels')}</h3>
              <ol className="insights__list">
                {activity.channels.slice(0, 8).map((c) => (
                  <li key={c.channelId}>
                    <span>#{channelName(c.channelId)}</span>
                    <span className="muted">{c.count}</span>
                  </li>
                ))}
                {activity.channels.length === 0 && <li className="muted">{tr('No messages yet.')}</li>}
              </ol>
            </div>
            <div>
              <h3>{tr('Most active people')}</h3>
              <ol className="insights__list">
                {activity.people.map((p) => (
                  <li key={p.riverId}>
                    <span>{personName(p.riverId)}</span>
                    <span className="muted">{p.count}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </>
      ) : (
        <p className="muted">{tr('Counting…')}</p>
      )}
      <h3>{tr('New members per week')}</h3>
      <Bars
        values={weeks}
        labels={weeks.map((_, i) => trn('{count} weeks ago', 7 - i))}
        label={tr('New members per week, last 8 weeks')}
      />
      {roleCounts.length > 0 && (
        <>
          <h3>{tr('Roles')}</h3>
          <ol className="insights__list">
            {roleCounts.map(({ r, n }) => (
              <li key={r.id}>
                <span style={r.color ? { color: hex(r.color) } : undefined}>{r.name}</span>
                <span className="muted">{n}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
