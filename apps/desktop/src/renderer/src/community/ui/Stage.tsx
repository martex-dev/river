import type { ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { ChannelView, CommunityView, VoiceStateView } from '../../../../shared/ipc.ts';
import { sendVoiceState, useCommunity } from '../store.ts';
import { Avatar, can } from './common.tsx';

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
  const name = (id: string): string => community.members.find((m) => m.riverId === id)?.name ?? 'Someone';
  const setSpeaker = (riverId: string, speaker: boolean): void =>
    void s.run({ a: 'moderateVoice', riverId, speaker });
  const raise = (up: boolean): void => {
    useCommunity.setState({ handRaised: up });
    sendVoiceState();
  };
  return (
    <div className="stage">
      <div className="stage__head">
        <span className="stage__live">LIVE</span>
        <strong>{channel.topic || channel.name}</strong>
        <span className="muted small">
          {speakers.length} speaking · {audience.length} listening
        </span>
        {listening && (
          <button
            className={`btn btn--small ${s.handRaised ? 'btn--primary' : 'btn--ghost'}`}
            aria-pressed={s.handRaised}
            onClick={() => raise(!s.handRaised)}
          >
            ✋ {s.handRaised ? 'Lower hand' : 'Request to speak'}
          </button>
        )}
        {!listening && moderator && speakers.includes(me) && (
          <button className="btn btn--ghost btn--small" onClick={() => setSpeaker(me, false)}>
            Move me to the audience
          </button>
        )}
      </div>
      {moderator && hands.length > 0 && (
        <div className="stage__hands" aria-label="People asking to speak">
          {hands.map((id) => (
            <span key={id} className="stage__hand">
              ✋ {name(id)}
              <button className="btn btn--primary btn--small" onClick={() => setSpeaker(id, true)}>
                Invite to speak
              </button>
              <button
                className="btn btn--link btn--small"
                onClick={() => void s.run({ a: 'moderateVoice', riverId: id, speaker: false })}
              >
                Dismiss
              </button>
            </span>
          ))}
        </div>
      )}
      {audience.length > 0 && (
        <div className="stage__audience" aria-label="Audience">
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
                    aria-label={`Invite ${name(id)} to speak`}
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
          Speakers:{' '}
          {speakers
            .filter((id) => id !== me)
            .map((id) => (
              <span key={id} className="stage__speaker">
                {name(id)}
                <button
                  className="btn btn--link btn--small"
                  aria-label={`Move ${name(id)} to the audience`}
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
