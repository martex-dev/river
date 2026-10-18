import { useState, type ReactElement } from 'react';
import {
  FOREVER,
  MUTE_CHOICES,
  isMuted,
  muteUntil,
  withOverride,
  type Override,
} from '../../../../shared/notify-rules.ts';
import { NOTIFY_SOUNDS, NOTIFY_SOUND_LABELS, type NotifySound } from '../../../../shared/notify-sounds.ts';
import { useDm } from '../../dm/store.ts';
import { useRiver } from '../../store.ts';
import { playNotifySound } from '../sound.ts';
import { MenuItem } from './common.tsx';

const LEVELS: Array<{ id: Override['level']; label: string }> = [
  { id: 'default', label: 'Use the default' },
  { id: 'all', label: 'All messages' },
  { id: 'mentions', label: 'Only @mentions' },
  { id: 'nothing', label: 'Nothing' },
];

/**
 * A chat's levels (2.17): chats notify for every message by default; a group can be set to only
 * mentions and replies to you, any chat to nothing at all.
 */
function chatLevels(group: boolean): Array<{ id: Override['level']; label: string }> {
  return [
    { id: 'default', label: 'All messages' },
    ...(group ? [{ id: 'mentions' as const, label: 'Only @mentions and replies' }] : []),
    { id: 'nothing', label: 'Nothing' },
  ];
}

/** "Muted until 18:30", "Muted" (for good) or null. */
export function mutedLabel(until: string | null | undefined, now = Date.now()): string | null {
  if (!until || Date.parse(until) <= now) return null;
  if (until === FOREVER) return 'Muted';
  const d = new Date(until);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return `Muted until ${sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`;
}

/**
 * Mute, notification level and sound for one channel, category, community or chat, as menu
 * items (1.0.18; chats' levels and sounds, and @everyone for communities, 2.17). Saved on this
 * device.
 */
export function NotifyMenuSection(props: {
  id: string;
  kind: 'channel' | 'category' | 'community' | 'conversation';
  onDone(): void;
}): ReactElement | null {
  const settings = useRiver((r) => r.settings);
  const update = useRiver((r) => r.updateSettings);
  const group = useDm((d) => d.conversations.find((c) => c.riverId === props.id)?.kind === 'group');
  const [choosing, setChoosing] = useState<'mute' | 'level' | 'sound' | null>(null);
  if (!settings) return null;
  const overrides = settings.notifications.overrides;
  const current = overrides[props.id];
  const muted = isMuted(settings.notifications, props.id);
  const save = (patch: Partial<Override>): void => {
    void update({ notifications: { overrides: withOverride(overrides, props.id, patch) } });
    props.onDone();
  };
  const toggle = (menu: 'mute' | 'level' | 'sound'): void => setChoosing(choosing === menu ? null : menu);
  const noun = props.kind === 'conversation' ? 'chat' : props.kind;
  const levels = props.kind === 'conversation' ? chatLevels(group) : LEVELS;
  const level = current?.level ?? 'default';
  const levelLabel = (levels.find((l) => l.id === level) ?? levels[0]!).label;
  const sound: NotifySound = current?.sound ?? 'default';
  const fallback = props.kind === 'conversation' ? 'dm' : 'message';
  return (
    <>
      <div className="menu__sep" role="separator" />
      {muted ? (
        <MenuItem icon={<span aria-hidden="true">🔔</span>} onClick={() => save({ muteUntil: null })}>
          Unmute {noun}
          <span className="menu__hint">{mutedLabel(current?.muteUntil)}</span>
        </MenuItem>
      ) : (
        <MenuItem icon={<span aria-hidden="true">🔕</span>} onClick={() => toggle('mute')}>
          Mute {noun} {choosing === 'mute' ? '▾' : '▸'}
        </MenuItem>
      )}
      {choosing === 'mute' &&
        MUTE_CHOICES.map((c) => (
          <MenuItem key={c.label} onClick={() => save({ muteUntil: muteUntil(c.ms) })}>
            <span className="menu__indent">{c.label}</span>
          </MenuItem>
        ))}
      <MenuItem icon={<span aria-hidden="true">⚙</span>} onClick={() => toggle('level')}>
        Notifications {choosing === 'level' ? '▾' : '▸'}
        <span className="menu__hint">{levelLabel}</span>
      </MenuItem>
      {choosing === 'level' &&
        levels.map((l) => (
          <MenuItem key={l.id} onClick={() => save({ level: l.id })}>
            <span className="menu__indent">
              {level === l.id ? '● ' : '○ '}
              {l.label}
            </span>
          </MenuItem>
        ))}
      <MenuItem icon={<span aria-hidden="true">♪</span>} onClick={() => toggle('sound')}>
        Sound {choosing === 'sound' ? '▾' : '▸'}
        <span className="menu__hint">{NOTIFY_SOUND_LABELS[sound]}</span>
      </MenuItem>
      {choosing === 'sound' &&
        NOTIFY_SOUNDS.map((s) => (
          <MenuItem
            key={s}
            onClick={() => {
              // Heard once as it is chosen.
              playNotifySound(s, fallback, true);
              save({ sound: s });
            }}
          >
            <span className="menu__indent">
              {sound === s ? '● ' : '○ '}
              {NOTIFY_SOUND_LABELS[s]}
            </span>
          </MenuItem>
        ))}
      {props.kind === 'community' && (
        <MenuItem
          icon={<span aria-hidden="true">@</span>}
          onClick={() => save({ suppressEveryone: !current?.suppressEveryone })}
        >
          {current?.suppressEveryone ? '● ' : '○ '}Ignore @everyone and @here
        </MenuItem>
      )}
    </>
  );
}
