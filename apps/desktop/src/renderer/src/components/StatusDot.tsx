import type { ReactElement } from 'react';
import type { Indicator } from '../../../shared/ipc.ts';

const LABEL: Record<Indicator, string> = {
  active: 'Active',
  inactive: 'Inactive',
  planned: 'Planned',
  warning: 'Attention',
};

export function StatusDot({ indicator }: { indicator: Indicator }): ReactElement {
  return <span className={`status-dot status-dot--${indicator}`} role="img" aria-label={LABEL[indicator]} />;
}
