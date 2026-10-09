import type { ReactElement } from 'react';
import { ArrowIcon } from '../components/Icons.tsx';
import { NetworkField } from '../components/NetworkField.tsx';
import { StatusDot } from '../components/StatusDot.tsx';
import { useRiver } from '../store.ts';

/** What each Stage 1 series actually shipped (see CHANGELOG.md). */
export const STAGE_ONE = [
  { v: '0.0', name: 'Foundation' },
  { v: '0.1', name: 'Accounts' },
  { v: '0.2', name: 'Communities' },
  { v: '0.3', name: 'Roles & moderation' },
  { v: '0.4', name: 'Encrypted files' },
  { v: '0.5', name: 'Messages & calls' },
  { v: '0.6', name: 'Groups & key rotation' },
  { v: '0.7', name: 'Social' },
  { v: '0.8', name: 'Backup & recovery' },
  { v: '0.9', name: 'Hardening' },
  { v: '1.0', name: 'Stage 1' },
];

/** The next few milestones (Stage 2), shown on Home. Keep in step with ROADMAP.md. */
const NEXT = [
  { v: '1.1', name: 'Protocol freeze and test vectors' },
  { v: '1.2', name: 'Linked devices' },
  { v: '1.3', name: 'iOS app' },
  { v: '1.4', name: 'Android app' },
];

/** Index of the current minor series on the Stage 1 timeline (e.g. 0.0.1 → 0). */
export function stageIndex(version: string | undefined): number {
  if (!version) return 0;
  const [major, minor] = version.split('.').map((n) => Number.parseInt(n, 10));
  if (major === undefined || minor === undefined || Number.isNaN(major) || Number.isNaN(minor)) return 0;
  if (major >= 1) return STAGE_ONE.length - 1;
  return Math.min(minor, STAGE_ONE.length - 1);
}

export function HomePage({ reducedMotion }: { reducedMotion: boolean }): ReactElement {
  const info = useRiver((s) => s.info);
  const security = useRiver((s) => s.security);
  const identity = useRiver((s) => s.identity);
  const navigate = useRiver((s) => s.navigate);
  const current = stageIndex(info?.version);

  return (
    <div className="page home">
      <section className="hero glass">
        <NetworkField reducedMotion={reducedMotion} />
        <div className="hero__content">
          <div className="eyebrow">
            River <span className="mono">{info?.version ?? '…'}</span> · {STAGE_ONE[current]?.name}
          </div>
          <h1 className="hero__title">
            {identity?.displayName ? (
              <>
                Welcome, <span className="gradient-text">{identity.displayName}</span>.
              </>
            ) : (
              <>
                Your private <span className="gradient-text">river</span>.
              </>
            )}
          </h1>
          <p className="hero__lead">
            Messages, communities, media and calls in one place — end-to-end encrypted, with no phone number,
            no ads and no tracking.
          </p>
          <div className="hero__actions">
            <button className="btn btn--primary" onClick={() => navigate('security')}>
              Open Security Center <ArrowIcon size={16} />
            </button>
            <button className="btn btn--ghost" onClick={() => navigate('settings')}>
              Update settings
            </button>
          </div>
        </div>
      </section>

      <section className="glass card" aria-labelledby="timeline-title">
        <div className="card__head">
          <h2 id="timeline-title" className="card__title">
            Stage 1 — the desktop platform
          </h2>
          <span className="muted small">
            {current === STAGE_ONE.length - 1 ? 'Complete · ' : ''}Each step ships as a signed update
          </span>
        </div>
        <ol className="timeline">
          {STAGE_ONE.map((m, i) => (
            <li
              key={m.v}
              className={`timeline__step ${i < current ? 'is-done' : ''} ${i === current ? 'is-current' : ''}`}
              aria-current={i === current ? 'step' : undefined}
            >
              <span className="timeline__dot" />
              <span className="timeline__v mono">{m.v}</span>
              <span className="timeline__name">{m.name}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="home__grid">
        <section className="glass card" aria-labelledby="works-title">
          <h2 id="works-title" className="card__title">
            Working in this version
          </h2>
          <ul className="statuslist">
            {(security?.items ?? [])
              .filter((i) => i.indicator === 'active')
              .map((i) => (
                <li key={i.id}>
                  <StatusDot indicator={i.indicator} />
                  <span>{i.label}</span>
                  <span className="statuslist__value">{i.value}</span>
                </li>
              ))}
            <li>
              <StatusDot indicator="active" />
              <span>Release channels</span>
              <span className="statuslist__value">Stable · Beta · Nightly</span>
            </li>
          </ul>
        </section>
        <section className="glass card" aria-labelledby="next-title">
          <h2 id="next-title" className="card__title">
            Coming next
          </h2>
          <ul className="statuslist">
            {NEXT.map((n) => (
              <li key={n.v}>
                <StatusDot indicator="planned" />
                <span>{n.name}</span>
                <span className="statuslist__value mono">{n.v}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
