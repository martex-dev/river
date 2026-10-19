import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ChannelView, CommunityView } from '../../../../shared/ipc.ts';
import { useRiver } from '../../store.ts';
import {
  ActiveSpeaker,
  callStatus,
  handQueue,
  saveView,
  savedView,
  talkingLine,
  type MeetingView,
} from '../meeting.ts';
import { play } from '../sound.ts';
import { useCommunity } from '../store.ts';
import type { VoiceCall } from '../voice.ts';
import { nameOf } from './common.tsx';
import { tr, trn } from '../../i18n.ts';
import '../../styles/meeting.css';

/** Grid or speaker view, remembered on this computer. */
export function useMeetingView(): [MeetingView, (v: MeetingView) => void] {
  const [view, setView] = useState<MeetingView>(savedView);
  return [
    view,
    (v) => {
      setView(v);
      saveView(v);
    },
  ];
}

/** Who speaker view shows large right now (null in grid view). */
export function useSpeakerFocus(
  call: VoiceCall | null,
  me: string,
  people: readonly string[],
  view: MeetingView,
): string | null {
  const [picker] = useState(() => new ActiveSpeaker());
  if (!call || view !== 'speaker') return null;
  const sharing = [
    ...(call.localTrack('screen') ? [me] : []),
    ...call
      .remotes()
      .filter((r) => r.screenOn)
      .map((r) => r.id),
  ];
  return picker.update({ me, people, speaking: call.speaking, sharing });
}

/**
 * The meeting bar above the tiles (2.13): layout, raise hand, noise
 * suppression, who is talking, raised hands in order, and honest warnings
 * (reconnecting, microphone gone).
 */
export function MeetingBar(props: {
  call: VoiceCall;
  community: CommunityView;
  channel: ChannelView;
  me: string;
  view: MeetingView;
  onView(view: MeetingView): void;
}): ReactElement {
  const { call, community, channel, me, view, onView } = props;
  const connection = useCommunity((x) => x.connection);
  const voice = useRiver((r) => r.settings?.voice);
  const updateSettings = useRiver((r) => r.updateSettings);
  const remotes = call.remotes();
  const name = (id: string): string => (id === me ? tr('You') : nameOf(community, id));
  const talking = [...call.speaking]
    .filter((id) => id !== me || call.transmitting)
    .sort((a, b) => (a === me ? 1 : b === me ? -1 : 0))
    .map(name);
  const hands = handQueue([{ id: me, hand: call.hand }, ...remotes]);
  const status = callStatus({ server: connection, others: remotes });
  const noise = voice?.noiseSuppression ?? true;

  // A soft sound when someone else raises a hand.
  const handsUp = hands.filter((h) => h.id !== me).length;
  const before = useRef(handsUp);
  useEffect(() => {
    if (handsUp > before.current) play('reaction');
    before.current = handsUp;
  }, [handsUp]);

  return (
    <div className="meeting-bar" role="toolbar" aria-label={tr('Meeting')}>
      <div className="segmented meeting-bar__views" role="radiogroup" aria-label={tr('Layout')}>
        {(['grid', 'speaker'] as const).map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={view === v}
            className={`segmented__item ${view === v ? 'is-active' : ''}`}
            title={v === 'grid' ? tr('Everyone the same size') : tr('Whoever is talking (or sharing) large')}
            onClick={() => onView(v)}
          >
            {v === 'grid' ? tr('Grid') : tr('Speaker')}
          </button>
        ))}
      </div>
      {/* Stages have their own "Request to speak". */}
      {!channel.stage && (
        <button
          className={`btn btn--small ${call.hand !== null ? 'btn--primary' : 'btn--ghost'}`}
          aria-pressed={call.hand !== null}
          title={
            call.hand !== null ? tr('Lower your hand') : tr('Raise your hand: everyone sees it, in order')
          }
          onClick={() => call.setHand(call.hand === null)}
        >
          <span aria-hidden="true">✋</span> {call.hand !== null ? tr('Lower hand') : tr('Raise hand')}
        </button>
      )}
      <button
        className={`btn btn--small ${noise ? 'btn--primary' : 'btn--ghost'}`}
        aria-pressed={noise}
        title={
          noise
            ? tr('Noise suppression is on: background noise is filtered out of your voice')
            : tr('Noise suppression is off (music, instruments)')
        }
        onClick={() => {
          void updateSettings({ voice: { noiseSuppression: !noise } });
          void call.updateOptions({ noiseSuppression: !noise });
        }}
      >
        {tr('Noise suppression')}
      </button>
      <span className="meeting-bar__talking" title={tr('Who is talking now')}>
        {talkingLine(talking, tr, trn) ?? (remotes.length > 0 ? tr('Nobody is talking') : '')}
      </span>
      {hands.length > 0 && (
        <ol className="meeting-bar__hands" aria-label={tr('Raised hands, in order')}>
          {hands.map((h, i) => (
            <li key={h.id}>
              <span aria-hidden="true">✋</span> {i + 1}. {name(h.id)}
            </li>
          ))}
        </ol>
      )}
      {status === 'reconnecting' && (
        <span className="meeting-bar__warn" role="status">
          {tr('Reconnecting to your server… you stay in the channel.')}
        </span>
      )}
      {call.micLost && (
        <span className="meeting-bar__warn" role="alert">
          {tr('Your microphone was disconnected: nobody can hear you until one is plugged in.')}
        </span>
      )}
    </div>
  );
}
