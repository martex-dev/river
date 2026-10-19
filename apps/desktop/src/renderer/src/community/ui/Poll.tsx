import { useState, type ReactElement } from 'react';
import type { ChatMessage } from '../../../../shared/ipc.ts';
import { POLL_LIMITS, tally, voteEmoji, type Poll } from '../../../../shared/poll.ts';
import { play } from '../sound.ts';
import { useCommunity } from '../store.ts';
import { Modal } from './common.tsx';
import { useNow } from './Events.tsx';
import { msg, tr, trn } from '../../i18n.ts';

/** "3 h left", "12 min left", "Poll closed". */
export function timeLeft(endsAt: string, now: number): string {
  const ms = Date.parse(endsAt) - now;
  if (ms <= 0) return tr('Poll closed');
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return trn('{count} min left', mins);
  const hours = Math.round(mins / 60);
  if (hours < 48) return trn('{count} h left', hours);
  return trn('{count} days left', Math.round(hours / 24));
}

/** A poll in a channel message. */
export function PollView({
  message,
  me,
  canVote,
}: {
  message: ChatMessage;
  me: string;
  canVote: boolean;
}): ReactElement | null {
  const s = useCommunity();
  if (!message.poll) return null;
  return (
    <PollCard
      poll={message.poll}
      reactions={message.reactions}
      me={me}
      canVote={canVote}
      onReact={(emoji, on) =>
        void s.run({ a: 'react', channelId: message.channelId, messageId: message.id, emoji, on })
      }
    />
  );
}

/**
 * A poll inside a message, in channels and direct messages (2.10.4): vote by clicking an option,
 * see the results as bars. Votes are reactions with a marker emoji.
 */
export function PollCard({
  poll,
  reactions,
  me,
  canVote,
  onReact,
}: {
  poll: Poll;
  reactions: ReadonlyArray<{ emoji: string; users: string[] }>;
  me: string;
  canVote: boolean;
  onReact(emoji: string, on: boolean): void;
}): ReactElement {
  const now = useNow();
  const t = tally(poll, reactions, me);
  const open = Date.parse(poll.endsAt) > now;
  const total = t.counts.reduce((a, b) => a + b, 0);
  const vote = (option: number): void => {
    if (!open || !canVote) return;
    const on = !t.mine.includes(option);
    if (on) play('reaction');
    // One choice only: picking a new option takes back the old one.
    if (on && !poll.multi) for (const old of t.mine) onReact(voteEmoji(old), false);
    onReact(voteEmoji(option), on);
  };
  return (
    <div className="poll" role="group" aria-label={tr('Poll: {question}', { question: poll.question })}>
      <div className="poll__question">{poll.question}</div>
      <div className="muted small">{poll.multi ? tr('Pick as many as you like') : tr('Pick one')}</div>
      <ul className="poll__options">
        {poll.options.map((label, i) => {
          const count = t.counts[i] ?? 0;
          const pct = total ? Math.round((count / total) * 100) : 0;
          const chosen = t.mine.includes(i);
          return (
            <li key={i}>
              <button
                className={`poll__option ${chosen ? 'is-chosen' : ''}`}
                aria-pressed={chosen}
                disabled={!open || !canVote}
                onClick={() => vote(i)}
              >
                <span className="poll__bar" style={{ width: `${pct}%` }} aria-hidden="true" />
                <span className="poll__label">
                  {chosen ? '✓ ' : ''}
                  {label}
                </span>
                <span className="poll__count">
                  {count} · {pct}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="muted small">
        {trn('{count} votes', t.voters)} · {timeLeft(poll.endsAt, now)}
      </div>
    </div>
  );
}

const DURATIONS = [
  { label: msg('1 hour'), ms: 3600_000 },
  { label: msg('4 hours'), ms: 4 * 3600_000 },
  { label: msg('8 hours'), ms: 8 * 3600_000 },
  { label: msg('24 hours'), ms: 24 * 3600_000 },
  { label: msg('3 days'), ms: 3 * 24 * 3600_000 },
  { label: msg('1 week'), ms: 7 * 24 * 3600_000 },
];

export function CreatePollDialog({
  channelId,
  onSend,
  onClose,
}: {
  /** A channel's poll, or `onSend` for a direct message or group (2.10.4). */
  channelId?: string;
  onSend?(poll: Poll, text: string): Promise<unknown>;
  onClose(): void;
}): ReactElement {
  const s = useCommunity();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [duration, setDuration] = useState(DURATIONS[3]!.ms);
  const [busy, setBusy] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ready = question.trim() !== '' && filled.length >= POLL_LIMITS.minOptions;
  const send = async (): Promise<void> => {
    setBusy(true);
    const poll = {
      question: question.trim(),
      options: filled,
      multi,
      endsAt: new Date(Date.now() + duration).toISOString(),
    };
    const text = `📊 ${question.trim()}`;
    const res = onSend
      ? await onSend(poll, text)
      : channelId
        ? await s.run({ a: 'send', channelId, text, poll })
        : null;
    setBusy(false);
    if (res) {
      play('send');
      onClose();
    }
  };
  return (
    <Modal title={tr('Create a poll')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void send();
        }}
      >
        <label className="textfield">
          <span className="field__label">{tr('Question')}</span>
          <input
            autoFocus
            maxLength={POLL_LIMITS.question}
            placeholder={tr('What should we play tonight?')}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <div className="field__label">{tr('Answers')}</div>
        {options.map((o, i) => (
          <div key={i} className="poll-form__option">
            <input
              aria-label={tr('Answer {number}', { number: i + 1 })}
              maxLength={POLL_LIMITS.option}
              placeholder={tr('Answer {number}', { number: i + 1 })}
              value={o}
              onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
            />
            {options.length > POLL_LIMITS.minOptions && (
              <button
                type="button"
                className="icon-btn"
                aria-label={tr('Remove answer {number}', { number: i + 1 })}
                onClick={() => setOptions(options.filter((_, j) => j !== i))}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {options.length < POLL_LIMITS.maxOptions && (
          <button type="button" className="btn btn--link" onClick={() => setOptions([...options, ''])}>
            + {tr('Add another answer')}
          </button>
        )}
        <div className="poll-form__row">
          <label className="textfield">
            <span className="field__label">{tr('Open for')}</span>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => (
                <option key={d.ms} value={d.ms}>
                  {tr(d.label)}
                </option>
              ))}
            </select>
          </label>
          <label className="poll-form__multi">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />{' '}
            {tr('Allow more than one answer')}
          </label>
        </div>
        <p className="muted small">{tr('Questions, answers and votes are end-to-end encrypted.')}</p>
        <div className="modal__foot">
          <button type="button" className="btn btn--link" onClick={onClose}>
            {tr('Cancel')}
          </button>
          <button className="btn btn--primary" disabled={!ready || busy}>
            {tr('Post poll')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
