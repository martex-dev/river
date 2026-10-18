import { useState, type ReactElement } from 'react';
import type { Settings } from '../../../shared/settings.ts';
import { msg, tr } from '../i18n.ts';
import { useRiver } from '../store.ts';
import { EmojiPicker, Modal, PRESENCE_LABEL, Popover, type Presence } from '../community/ui/common.tsx';

type Chosen = Settings['presence']['status'];

const CHOICES: Array<{ id: Chosen; dot: Presence; hint?: string }> = [
  { id: 'online', dot: 'online' },
  { id: 'idle', dot: 'idle' },
  { id: 'dnd', dot: 'dnd', hint: msg('You won’t get notifications or notification sounds.') },
  { id: 'invisible', dot: 'offline', hint: msg('You’ll appear offline but can use River as usual.') },
];

export const CHOSEN_LABEL: Record<Chosen, string> = {
  online: msg('Online'),
  idle: msg('Idle'),
  dnd: msg('Do Not Disturb'),
  invisible: msg('Invisible'),
};

/** How you appear right now, for your own panel (auto-idle shows only to others). */
export function myPresence(settings: Settings | null, connected: boolean): Presence {
  if (!connected) return 'offline';
  const s = settings?.presence.status ?? 'online';
  return s === 'invisible' ? 'offline' : s;
}

/** Online / Idle / Do Not Disturb / Invisible, and the custom status (1.0.17). */
export function StatusMenu(props: {
  x: number;
  y: number;
  onClose(): void;
  onEditProfile(): void;
}): ReactElement {
  const settings = useRiver((r) => r.settings);
  const update = useRiver((r) => r.updateSettings);
  const [customOpen, setCustomOpen] = useState(false);
  const presence = settings?.presence;
  const hasCustom = !!(presence && (presence.customText || presence.customEmoji));
  if (customOpen) return <CustomStatusDialog onClose={props.onClose} />;
  return (
    <Popover x={props.x} y={props.y} onClose={props.onClose} className="status-menu">
      <div role="menu" aria-label={tr('Your status')}>
        {CHOICES.map((c) => (
          <button
            key={c.id}
            role="menuitemradio"
            aria-checked={presence?.status === c.id}
            className={`status-menu__item ${presence?.status === c.id ? 'is-selected' : ''}`}
            onClick={() => {
              void update({ presence: { status: c.id } });
              props.onClose();
            }}
          >
            <span className={`status-menu__dot avatar__status--${c.dot}`} aria-hidden="true" />
            <span className="status-menu__text">
              <strong>{tr(CHOSEN_LABEL[c.id])}</strong>
              {c.hint && <span className="muted small">{tr(c.hint)}</span>}
            </span>
          </button>
        ))}
        <div className="status-menu__sep" role="separator" />
        <button role="menuitem" className="status-menu__item" onClick={() => setCustomOpen(true)}>
          <span className="status-menu__dot" aria-hidden="true">
            {presence?.customEmoji || '💬'}
          </span>
          <span className="status-menu__text">
            <strong>{hasCustom ? tr('Edit custom status') : tr('Set a custom status')}</strong>
            {hasCustom && <span className="muted small">{presence!.customText}</span>}
          </span>
        </button>
        {hasCustom && (
          <button
            role="menuitem"
            className="status-menu__item"
            onClick={() => {
              void update({ presence: { customText: '', customEmoji: '', customUntil: null } });
              props.onClose();
            }}
          >
            <span className="status-menu__dot" aria-hidden="true" />
            <span className="status-menu__text">{tr('Clear custom status')}</span>
          </button>
        )}
        <button
          role="menuitem"
          className="status-menu__item"
          onClick={() => {
            props.onClose();
            props.onEditProfile();
          }}
        >
          <span className="status-menu__dot" aria-hidden="true" />
          <span className="status-menu__text">{tr('Edit profile')}</span>
        </button>
      </div>
    </Popover>
  );
}

const CLEAR_AFTER: Array<{ label: string; ms: number | 'today' | null }> = [
  { label: msg('Today'), ms: 'today' },
  { label: msg('4 hours'), ms: 4 * 3600_000 },
  { label: msg('1 hour'), ms: 3600_000 },
  { label: msg('30 minutes'), ms: 30 * 60_000 },
  { label: msg('Don’t clear'), ms: null },
];

/** When a custom status chosen now should clear itself. */
export function clearTime(choice: number | 'today' | null, now = new Date()): string | null {
  if (choice === null) return null;
  if (choice === 'today') {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return end.toISOString();
  }
  return new Date(now.getTime() + choice).toISOString();
}

function CustomStatusDialog({ onClose }: { onClose(): void }): ReactElement {
  const settings = useRiver((r) => r.settings);
  const update = useRiver((r) => r.updateSettings);
  const [text, setText] = useState(settings?.presence.customText ?? '');
  const [emoji, setEmoji] = useState(settings?.presence.customEmoji ?? '');
  const [picking, setPicking] = useState(false);
  const [clear, setClear] = useState(0);
  const save = (): void => {
    void update({
      presence: {
        customText: text.trim().slice(0, 128),
        customEmoji: emoji,
        customUntil: text.trim() || emoji ? clearTime(CLEAR_AFTER[clear]!.ms) : null,
      },
    });
    onClose();
  };
  return (
    <Modal title={tr('Set a custom status')} onClose={onClose}>
      <p className="muted small">
        {tr(
          'Everyone in your communities sees it. It is end-to-end encrypted like the rest of your profile.',
        )}
      </p>
      <div className="custom-status-form">
        <button
          type="button"
          className="custom-status-form__emoji"
          aria-label={emoji ? tr('Emoji {emoji}, change', { emoji }) : tr('Choose an emoji')}
          onClick={() => setPicking(!picking)}
        >
          {emoji || '🙂'}
        </button>
        <input
          autoFocus
          maxLength={128}
          placeholder={tr('What’s happening?')}
          aria-label={tr('Custom status')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
        />
      </div>
      {picking && (
        <EmojiPicker
          onPick={(e) => {
            setEmoji(e);
            setPicking(false);
          }}
        />
      )}
      <label className="textfield">
        <span className="field__label">{tr('Clear after')}</span>
        <select value={clear} onChange={(e) => setClear(Number(e.target.value))}>
          {CLEAR_AFTER.map((c, i) => (
            <option key={c.label} value={i}>
              {tr(c.label)}
            </option>
          ))}
        </select>
      </label>
      <div className="modal__foot">
        <button className="btn btn--link" onClick={onClose}>
          {tr('Cancel')}
        </button>
        <button className="btn btn--primary" onClick={save}>
          {tr('Save')}
        </button>
      </div>
    </Modal>
  );
}

export { PRESENCE_LABEL };
