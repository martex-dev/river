import type { ReactElement } from 'react';
import { SECTION_ICONS, CheckIcon } from '../components/Icons.tsx';
import type { PlannedFeature } from '../features.ts';
import type { Section } from '../store.ts';

export function PlannedPage({
  section,
  feature,
}: {
  section: Section;
  feature: PlannedFeature;
}): ReactElement {
  const Icon = SECTION_ICONS[section];
  return (
    <div className="page planned">
      <div className="planned__hero glass">
        <div className="planned__icon">
          <Icon size={34} />
        </div>
        <div>
          <div className="eyebrow">
            Arrives in <span className="mono">{feature.arrives}</span>
          </div>
          <h1 className="page__title">{feature.title}</h1>
          <p className="page__lead">{feature.tagline}</p>
        </div>
      </div>

      <div className="planned__grid">
        <section className="glass card" aria-labelledby={`${section}-caps`}>
          <h2 id={`${section}-caps`} className="card__title">
            What’s coming
          </h2>
          <ul className="checklist">
            {feature.capabilities.map((c) => (
              <li key={c}>
                <CheckIcon size={16} />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="glass card card--note" aria-label="Privacy note">
          <h2 className="card__title">Privacy by design</h2>
          <p className="muted">{feature.note}</p>
          <p className="muted small">
            This section is a preview. Nothing here works yet in this version of River.
          </p>
        </section>
      </div>
    </div>
  );
}
