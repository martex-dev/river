import type { ReactElement } from 'react';
import type { Indicator } from '../../../shared/ipc.ts';
import { msg, tr } from '../i18n.ts';

const LABEL: Record<Indicator, string> = {
  active: msg('Active'),
  inactive: msg('Inactive'),
  planned: msg('Planned'),
  warning: msg('Attention'),
};

export function StatusDot({ indicator }: { indicator: Indicator }): ReactElement {
  return (
    <span className={`status-dot status-dot--${indicator}`} role="img" aria-label={tr(LABEL[indicator])} />
  );
}
