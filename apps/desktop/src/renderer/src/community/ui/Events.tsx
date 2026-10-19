import { useEffect, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { EventView } from '../../../../shared/community-actions.ts';
import type { CommunityView } from '../../../../shared/ipc.ts';
import { clockDateTime, clockTime } from '../../time.ts';
import { useCommunity } from '../store.ts';
import { Modal, can, memberOf } from './common.tsx';
import { msg, tr, trn } from '../../i18n.ts';

/** "live", "upcoming" or "past" at this moment. */
export function eventPhase(
  e: Pick<EventView, 'startsAt' | 'endsAt'>,
  now = Date.now(),
): 'live' | 'upcoming' | 'past' {
  if (Date.parse(e.endsAt) <= now) return 'past';
  return Date.parse(e.startsAt) <= now ? 'live' : 'upcoming';
}

/** "in 3 hours", "tomorrow at 19:00", "Fri 12 Oct, 19:00". */
export function whenLabel(e: Pick<EventView, 'startsAt' | 'endsAt'>, now = Date.now()): string {
  const start = new Date(e.startsAt);
  const phase = eventPhase(e, now);
  if (phase === 'live') return tr('Happening now · until {time}', { time: clockTime(e.endsAt) });
  if (phase === 'past') return tr('Ended {when}', { when: clockDateTime(e.endsAt) });
  const mins = Math.round((start.getTime() - now) / 60_000);
  if (mins < 60) return trn('Starts in {count} min', Math.max(1, mins));
  const today = new Date(now);
  const tomorrow = new Date(now + 86_400_000);
  if (start.toDateString() === today.toDateString()) return tr('Today at {time}', { time: clockTime(start) });
  if (start.toDateString() === tomorrow.toDateString())
    return tr('Tomorrow at {time}', { time: clockTime(start) });
  return `${start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${clockTime(start)}`;
}

/** The current time, updated every 30 seconds (so "starts in 5 min" stays right). */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}

/** The community's upcoming and live events (used by the sidebar too). */
export function useEvents(communityId: string): EventView[] | null {
  const events = useCommunity((s) => s.events[communityId] ?? null);
  const load = useCommunity((s) => s.loadEvents);
  useEffect(() => {
    void load(communityId);
  }, [communityId, load]);
  return events;
}

const PHASE_LABEL = {
  live: msg('Happening now'),
  upcoming: msg('Upcoming'),
  past: msg('Past week'),
} as const;

export function EventsDialog({ community, me }: { community: CommunityView; me: string }): ReactElement {
  const s = useCommunity();
  const events = useEvents(community.id);
  const [editing, setEditing] = useState<EventView | 'new' | null>(null);
  const manage = can(community.permissions, Permission.MANAGE_EVENTS);
  const now = useNow();
  if (editing) {
    return (
      <EventForm
        community={community}
        event={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
      />
    );
  }
  const groups = (['live', 'upcoming', 'past'] as const).map((phase) => ({
    phase,
    items: (events ?? []).filter((e) => eventPhase(e, now) === phase),
  }));
  return (
    <Modal title={tr('Events')} onClose={() => s.setModal(null)} wide>
      <div className="events__head">
        <h2>{tr('Events in {name}', { name: community.name })}</h2>
        {manage && (
          <button className="btn btn--primary" onClick={() => setEditing('new')}>
            {tr('Create event')}
          </button>
        )}
      </div>
      {events === null && <p className="muted">{tr('Loading…')}</p>}
      {events?.length === 0 && (
        <div className="empty">
          <p>{tr('No events yet.')}</p>
          <p className="muted small">
            {manage
              ? tr(
                  'Plan a game night, a study session or a call: everyone here can see it and say they are interested.',
                )
              : tr('When someone plans one, it shows up here.')}
          </p>
        </div>
      )}
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.phase} aria-label={tr(PHASE_LABEL[g.phase])}>
              <h3 className="events__group">{tr(PHASE_LABEL[g.phase])}</h3>
              {g.items.map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  community={community}
                  me={me}
                  manage={manage}
                  onEdit={() => setEditing(e)}
                />
              ))}
            </section>
          ),
      )}
    </Modal>
  );
}

function EventCard(props: {
  event: EventView;
  community: CommunityView;
  me: string;
  manage: boolean;
  onEdit(): void;
}): ReactElement {
  const { event: e, community } = props;
  const s = useCommunity();
  const interested = e.interested.includes(props.me);
  const channel = e.channelId ? community.channels.find((c) => c.id === e.channelId) : null;
  const phase = eventPhase(e);
  return (
    <article className={`event-card ${e.canceled ? 'is-canceled' : ''} event-card--${phase}`}>
      <div className="event-card__when">
        {phase === 'live' && !e.canceled && <span className="live-badge">{tr('LIVE')}</span>}
        {e.canceled ? <strong>{tr('Cancelled')}</strong> : whenLabel(e)}
      </div>
      <h4 className="event-card__name">{e.name}</h4>
      {e.description && <p className="event-card__desc">{e.description}</p>}
      <div className="event-card__meta muted small">
        {channel ? `🔊 ${channel.name}` : e.place ? `📍 ${e.place}` : null}
        <span>
          {trn('{count} interested · by {name}', e.interested.length, {
            name: memberOf(community, e.createdBy)?.name ?? tr('someone'),
          })}
        </span>
      </div>
      <div className="event-card__actions">
        {!e.canceled && phase !== 'past' && (
          <button
            className={`btn ${interested ? 'btn--primary' : 'btn--ghost'}`}
            aria-pressed={interested}
            onClick={() => void s.run({ a: 'eventInterest', eventId: e.id, on: !interested })}
          >
            {interested ? `★ ${tr('Interested')}` : `☆ ${tr('Interested')}`}
          </button>
        )}
        {channel && phase === 'live' && !e.canceled && (
          <button
            className="btn btn--ghost"
            onClick={() => {
              s.setModal(null);
              s.selectChannel(channel.id);
              void s.joinVoice(channel.id, props.me);
            }}
          >
            {tr('Join voice')}
          </button>
        )}
        {props.manage && (
          <>
            <button className="btn btn--link" onClick={props.onEdit}>
              {tr('Edit')}
            </button>
            <button
              className="btn btn--link"
              onClick={() => void s.run({ a: 'updateEvent', eventId: e.id, canceled: !e.canceled })}
            >
              {e.canceled ? tr('Restore') : tr('Cancel event')}
            </button>
            <button
              className="btn btn--link btn--danger"
              onClick={() =>
                s.setModal({
                  kind: 'confirm',
                  title: tr('Delete {name}', { name: e.name }),
                  body: tr('The event disappears for everyone. This cannot be undone.'),
                  action: tr('Delete event'),
                  run: async () => {
                    await s.run({ a: 'deleteEvent', eventId: e.id });
                    s.setModal({ kind: 'events', communityId: community.id });
                  },
                })
              }
            >
              {tr('Delete')}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

/** A datetime-local value ("2026-10-11T19:00") for a time in the reader's zone. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DURATIONS = [
  { label: msg('30 minutes'), ms: 30 * 60_000 },
  { label: msg('1 hour'), ms: 3600_000 },
  { label: msg('2 hours'), ms: 2 * 3600_000 },
  { label: msg('3 hours'), ms: 3 * 3600_000 },
  { label: msg('All day'), ms: 24 * 3600_000 },
];

/** "1 hour 30 minutes", "2 days" — for a length that is not one of the usual choices. */
export function durationLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [
    days ? trn('{count} days', days) : '',
    hours ? trn('{count} hours', hours) : '',
    mins ? trn('{count} minutes', mins) : '',
  ];
  return parts.filter(Boolean).join(' ') || trn('{count} minutes', 0);
}

export function EventForm(props: {
  community: CommunityView;
  event: EventView | null;
  onClose(): void;
}): ReactElement {
  const s = useCommunity();
  const e = props.event;
  const voice = props.community.channels.filter((c) => c.kind === 'voice');
  const [name, setName] = useState(e?.name ?? '');
  const [description, setDescription] = useState(e?.description ?? '');
  // New events default to the next full hour.
  const [start, setStart] = useState(() => {
    if (e) return toLocalInput(e.startsAt);
    const d = new Date(Date.now() + 3600_000);
    d.setMinutes(0, 0, 0);
    return toLocalInput(d.toISOString());
  });
  const spanned = e ? Date.parse(e.endsAt) - Date.parse(e.startsAt) : 3600_000;
  const initialDuration = Number.isFinite(spanned) && spanned > 0 ? spanned : 3600_000;
  // An event of another length (say 90 minutes) keeps it when edited: it is one of the choices.
  const durations = DURATIONS.some((d) => d.ms === initialDuration)
    ? DURATIONS
    : [...DURATIONS, { label: durationLabel(initialDuration), ms: initialDuration }].sort(
        (a, b) => a.ms - b.ms,
      );
  const [duration, setDuration] = useState(initialDuration);
  const [where, setWhere] = useState<string>(e ? (e.channelId ?? 'place') : (voice[0]?.id ?? 'place'));
  const [place, setPlace] = useState(e?.place ?? '');
  const [busy, setBusy] = useState(false);
  // A half-typed date (the field is cleared, or a part is missing) is no time at all: Save waits.
  const startMs = start ? Date.parse(start) : NaN;
  const valid = Number.isFinite(startMs);
  const startsAt = valid ? new Date(startMs).toISOString() : '';
  const endsAt = valid ? new Date(startMs + duration).toISOString() : '';
  const save = async (): Promise<void> => {
    if (!valid) return;
    setBusy(true);
    const channelId = where === 'place' ? null : where;
    const res = e
      ? await window.river.community.action({
          a: 'updateEvent',
          eventId: e.id,
          name: name.trim(),
          description,
          place: channelId ? '' : place,
          startsAt,
          endsAt,
          channelId,
        })
      : await window.river.community.action({
          a: 'createEvent',
          communityId: props.community.id,
          name: name.trim(),
          description,
          place: channelId ? '' : place,
          startsAt,
          endsAt,
          channelId,
        });
    setBusy(false);
    if (res.ok) props.onClose();
    else s.notify(res.message, 'error');
  };
  return (
    <Modal title={e ? tr('Edit event') : tr('Create event')} onClose={props.onClose}>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void save();
        }}
      >
        <label className="textfield">
          <span className="field__label">{tr('Event name')}</span>
          <input
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(ev) => setName(ev.target.value)}
          />
        </label>
        <label className="textfield">
          <span className="field__label">{tr('Description')}</span>
          <textarea
            maxLength={1000}
            rows={3}
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
          />
        </label>
        <div className="event-form__row">
          <label className="textfield">
            <span className="field__label">{tr('Starts')}</span>
            <input
              type="datetime-local"
              required
              value={start}
              onChange={(ev) => setStart(ev.target.value)}
              aria-invalid={!valid}
            />
            {!valid && <span className="field__error">{tr('Choose a date and time.')}</span>}
          </label>
          <label className="textfield">
            <span className="field__label">{tr('Lasts')}</span>
            <select value={duration} onChange={(ev) => setDuration(Number(ev.target.value))}>
              {durations.map((d) => (
                <option key={d.ms} value={d.ms}>
                  {tr(d.label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="textfield">
          <span className="field__label">{tr('Where')}</span>
          <select value={where} onChange={(ev) => setWhere(ev.target.value)}>
            {voice.map((c) => (
              <option key={c.id} value={c.id}>
                🔊 {c.name}
              </option>
            ))}
            <option value="place">{tr('Somewhere else…')}</option>
          </select>
        </label>
        {where === 'place' && (
          <label className="textfield">
            <span className="field__label">{tr('Place')}</span>
            <input
              maxLength={200}
              placeholder={tr('Our usual café, a game server…')}
              value={place}
              onChange={(ev) => setPlace(ev.target.value)}
            />
          </label>
        )}
        <p className="muted small">
          {tr(
            'Name, description and place are end-to-end encrypted; the server only sees when it starts and ends.',
          )}
        </p>
        <div className="modal__foot">
          <button type="button" className="btn btn--link" onClick={props.onClose}>
            {tr('Back')}
          </button>
          <button className="btn btn--primary" disabled={busy || !name.trim() || !valid}>
            {e ? tr('Save') : tr('Create event')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
