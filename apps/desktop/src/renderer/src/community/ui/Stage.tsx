import type { ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { ChannelView, CommunityView, VoiceStateView } from '../../../../shared/ipc.ts';
import { sendVoiceState, useCommunity } from '../store.ts';
import { Avatar, can } from './common.tsx';
import { tr } from '../../i18n.ts';

/** Who is speaking on a stage and who is listening (pure, for tests). */
export function stageGroups(
  participants: string[],
  states: Record<string, VoiceStateView | undefined>,
): { speakers: string[]; audience: string[]; hands: string[] } {
  const speakers = participants.filter((id) => !states[id]?.serverMuted);
  const audience = participants.filter((id) => states[id]?.serverMuted);
  return { speakers, audience, hands: audience.filter((id) => states[id]?.handRaised) };
}

/** The stage panel above the speakers (1.0.22): topic, audience, hands and moderator controls. */
export function StagePanel(props: {
  community: CommunityView;
  channel: ChannelView;
  me: string;
}): ReactElement {
  const { community, channel, me } = props;
  const s = useCommunity();
  const participants = community.voice[channel.id] ?? [];
  const { speakers, audience, hands } = stageGroups(participants, community.voiceStates);
  const moderator = can(channel.permissions, Permission.MUTE_MEMBERS);
  const listening = audience.includes(me);
  const name = (id: string): string => community.members.find((m) => m.riverId === id)?.name ?? tr('Someone');
  const setSpeaker = (riverId: string, speaker: boolean): void =>
    void s.run({ a: 'moderateVoice', riverId, speaker });
  const raise = (up: boolean): void => {
    useCommunity.setState({ handRaised: up });
    sendVoiceState();
  };
  return (
    <div className="stage">
      <div className="stage__head">
        <span className="stage__live">{tr('LIVE')}</span>
        <strong>{channel.topic || channel.name}</strong>
        <span className="muted small">
          {tr('{speaking} speaking · {listening} listening', {
            speaking: speakers.length,
            listening: audience.length,
          })}
        </span>
        {listening && (
          <button
            className={`btn btn--small ${s.handRaised ? 'btn--primary' : 'btn--ghost'}`}
            aria-pressed={s.handRaised}
            onClick={() => raise(!s.handRaised)}
          >
            ✋ {s.handRaised ? tr('Lower hand') : tr('Request to speak')}
          </button>
        )}
        {!listening && moderator && speakers.includes(me) && (
          <button className="btn btn--ghost btn--small" onClick={() => setSpeaker(me, false)}>
            {tr('Move me to the audience')}
          </button>
        )}
      </div>
      {moderator && hands.length > 0 && (
        <div className="stage__hands" aria-label={tr('People asking to speak')}>
          {hands.map((id) => (
            <span key={id} className="stage__hand">
              ✋ {name(id)}
              <button className="btn btn--primary btn--small" onClick={() => setSpeaker(id, true)}>
                {tr('Invite to speak')}
              </button>
              <button
                className="btn btn--link btn--small"
                onClick={() => void s.run({ a: 'moderateVoice', riverId: id, speaker: false })}
              >
                {tr('Dismiss')}
              </button>
            </span>
          ))}
        </div>
      )}
      {audience.length > 0 && (
        <div className="stage__audience" aria-label={tr('Audience')}>
          {audience.map((id) => {
            const member = community.members.find((m) => m.riverId === id);
            return (
              <span key={id} className="stage__listener" title={name(id)}>
                <Avatar id={id} name={name(id)} avatar={member?.avatar} size={28} />
                {community.voiceStates[id]?.handRaised && <span className="stage__raised">✋</span>}
                <span className="stage__listener-name">{name(id)}</span>
                {moderator && id !== me && (
                  <button
                    className="btn btn--link btn--small"
                    aria-label={tr('Invite {name} to speak', { name: name(id) })}
                    onClick={() => setSpeaker(id, true)}
                  >
                    ↑
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
      {moderator && speakers.filter((id) => id !== me).length > 0 && (
        <div className="stage__speakers muted small">
          {tr('Speakers:')}{' '}
          {speakers
            .filter((id) => id !== me)
            .map((id) => (
              <span key={id} className="stage__speaker">
                {name(id)}
                <button
                  className="btn btn--link btn--small"
                  aria-label={tr('Move {name} to the audience', { name: name(id) })}
                  onClick={() => setSpeaker(id, false)}
                >
                  ↓
                </button>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
