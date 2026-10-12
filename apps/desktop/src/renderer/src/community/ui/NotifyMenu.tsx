import { useState, type ReactElement } from 'react';
import {
  FOREVER,
  MUTE_CHOICES,
  isMuted,
  muteUntil,
  withOverride,
  type Override,
} from '../../../../shared/notify-rules.ts';
import { useRiver } from '../../store.ts';
import { MenuItem } from './common.tsx';

const LEVELS: Array<{ id: Override['level']; label: string }> = [
  { id: 'default', label: 'Use the default' },
  { id: 'all', label: 'All messages' },
  { id: 'mentions', label: 'Only @mentions' },
  { id: 'nothing', label: 'Nothing' },
];

/** "Muted until 18:30", "Muted" (for good) or null. */
export function mutedLabel(until: string | null | undefined, now = Date.now()): string | null {
  if (!until || Date.parse(until) <= now) return null;
  if (until === FOREVER) return 'Muted';
  const d = new Date(until);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return `Muted until ${sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`;
}

/**
 * Mute and notification level for one channel or community, as menu items
 * (1.0.18). Saved on this device.
 */
export function NotifyMenuSection(props: {
  id: string;
  kind: 'channel' | 'community' | 'conversation';
  onDone(): void;
}): ReactElement | null {
  const settings = useRiver((r) => r.settings);
  const update = useRiver((r) => r.updateSettings);
  const [choosing, setChoosing] = useState<'mute' | 'level' | null>(null);
  if (!settings) return null;
  const overrides = settings.notifications.overrides;
  const current = overrides[props.id];
  const muted = isMuted(settings.notifications, props.id);
  const save = (patch: Partial<Override>): void => {
    void update({ notifications: { overrides: withOverride(overrides, props.id, patch) } });
    props.onDone();
  };
  const noun = props.kind;
  return (
    <>
      <div className="menu__sep" role="separator" />
      {muted ? (
        <MenuItem icon={<span aria-hidden="true">🔔</span>} onClick={() => save({ muteUntil: null })}>
          Unmute {noun}
          <span className="menu__hint">{mutedLabel(current?.muteUntil)}</span>
        </MenuItem>
      ) : (
        <MenuItem
          icon={<span aria-hidden="true">🔕</span>}
          onClick={() => setChoosing(choosing === 'mute' ? null : 'mute')}
        >
          Mute {noun} {choosing === 'mute' ? '▾' : '▸'}
        </MenuItem>
      )}
      {choosing === 'mute' &&
        MUTE_CHOICES.map((c) => (
          <MenuItem key={c.label} onClick={() => save({ muteUntil: muteUntil(c.ms) })}>
            <span className="menu__indent">{c.label}</span>
          </MenuItem>
        ))}
      {props.kind !== 'conversation' && (
        <MenuItem
          icon={<span aria-hidden="true">⚙</span>}
          onClick={() => setChoosing(choosing === 'level' ? null : 'level')}
        >
          Notifications {choosing === 'level' ? '▾' : '▸'}
          <span className="menu__hint">
            {LEVELS.find((l) => l.id === (current?.level ?? 'default'))!.label}
          </span>
        </MenuItem>
      )}
      {choosing === 'level' &&
        LEVELS.map((l) => (
          <MenuItem key={l.id} onClick={() => save({ level: l.id })}>
            <span className="menu__indent">
              {(current?.level ?? 'default') === l.id ? '● ' : '○ '}
              {l.label}
            </span>
          </MenuItem>
        ))}
    </>
  );
}
