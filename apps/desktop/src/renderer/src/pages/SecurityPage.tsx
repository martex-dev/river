import type { ReactElement } from 'react';
import { ExternalIcon } from '../components/Icons.tsx';
import { StatusDot } from '../components/StatusDot.tsx';
import { useRiver } from '../store.ts';

/** Groups a hex key ID like "626db4cbb389fc32" as "626D B4CB B389 FC32". */
export function groupHex(hex: string): string {
  return (hex.toUpperCase().match(/.{1,4}/g) ?? []).join(' ');
}

export function SecurityPage(): ReactElement {
  const security = useRiver((s) => s.security);

  return (
    <div className="page security">
      <header className="page__header">
        <div className="eyebrow">River Security Center</div>
        <h1 className="page__title">What is protected, right now</h1>
        <p className="page__lead">
          This page only shows what this version of River actually does. Features that are not built yet are
          marked as planned, never as active.
        </p>
      </header>

      <section className="glass board" aria-label="Security status">
        {(security?.items ?? []).map((item) => (
          <details key={item.id} className="board__row">
            <summary>
              <span className="board__label">{item.label}</span>
              <span className={`board__value board__value--${item.indicator}`}>
                <StatusDot indicator={item.indicator} />
                {item.value}
              </span>
            </summary>
            <p className="board__detail">{item.detail}</p>
          </details>
        ))}
      </section>

      <div className="security__grid">
        <section className="glass card" aria-labelledby="keys-title">
          <h2 id="keys-title" className="card__title">
            Release signing keys
          </h2>
          <p className="muted small">
            Updates are installed only when signed by one of these keys, which are built into this copy of
            River.
          </p>
          <ul className="keylist">
            {(security?.releaseKeys ?? []).map((k) => (
              <li key={k.keyId}>
                <span className="mono keylist__id">{groupHex(k.keyId)}</span>
                {k.comment && <span className="muted small">{k.comment}</span>}
              </li>
            ))}
          </ul>
        </section>
        <section className="glass card" aria-labelledby="limits-title">
          <h2 id="limits-title" className="card__title">
            Honest limits
          </h2>
          <ul className="plainlist muted">
            <li>River is not an anonymity network and cannot hide that you use it.</li>
            <li>Malware on an unlocked device can read anything you can.</li>
            <li>People you message can always screenshot or forward what you send.</li>
            <li>River has not had an independent security audit yet.</li>
          </ul>
          <div className="linkrow">
            <button className="btn btn--link" onClick={() => void window.river.links.open('threatModel')}>
              Threat model <ExternalIcon size={14} />
            </button>
            <button className="btn btn--link" onClick={() => void window.river.links.open('privacy')}>
              Privacy policy <ExternalIcon size={14} />
            </button>
            <button className="btn btn--link" onClick={() => void window.river.links.open('security')}>
              Report a vulnerability <ExternalIcon size={14} />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
