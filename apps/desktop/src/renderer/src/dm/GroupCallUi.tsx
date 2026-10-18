import { useEffect, useState, type ReactElement } from 'react';
import type { ConversationView } from '../../../shared/dm.ts';
import type { ScreenSource } from '../../../shared/ipc.ts';
import { isPhone } from '../../../shared/platform.ts';
import { useCommunity } from '../community/store.ts';
import type { RemotePeer, VoiceCall } from '../community/voice.ts';
import { SpeakerButton, Video, useJoinGrace } from '../community/ui/Voice.tsx';
import {
  Avatar,
  CameraIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  Modal,
  PhoneIcon,
  PhoneOffIcon,
  ScreenIcon,
  UsersIcon,
} from '../community/ui/common.tsx';
import { useRiver } from '../store.ts';
import { callClock } from './call-clock.ts';
import { useDmCall } from './call-common.ts';
import {
  answerKnock,
  askToJoin,
  callName,
  inCall,
  joinGroupCall,
  leaveGroupCall,
  personName,
  ringAgain,
  startGroupCall,
  startLinkCall,
  stopAsking,
  useGroupCall,
  type ActiveGroupCall,
} from './group-call.ts';
import { useDm } from './store.ts';
import '../styles/group-call.css';

/** The call going on in a group right now (someone is in it), if any: the newest. */
export function useOngoingCall(groupId: string): string | null {
  return useGroupCall((s) => {
    const calls = Object.values(s.known)
      .filter((k) => k.groupId === groupId && inCall(k.callId).length > 0)
      .sort((a, b) => b.at - a.at);
    return calls[0]?.callId ?? null;
  });
}

function Timer(props: { since: number }): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="call-timer">{callClock((now - props.since) / 1000)}</span>;
}

/** "Alice, Bob and 3 others" */
function namesLine(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/**
 * Start (or join) a call in a group: the header's call buttons. A call already going on in the
 * group is joined instead of starting a second one.
 */
export function GroupCallButtons(props: {
  c: ConversationView;
  className: string;
  disabled: boolean;
  iconSize?: number;
}): ReactElement | null {
  const { c } = props;
  const ongoing = useOngoingCall(c.riverId);
  const inThis = useGroupCall((s) => s.active?.groupId === c.riverId);
  if (c.kind !== 'group' || c.state !== 'accepted') return null;
  const go = (video: boolean): void => {
    if (ongoing) void joinGroupCall(ongoing, video);
    else void startGroupCall(c.riverId, video);
  };
  const busy = props.disabled || inThis;
  return (
    <>
      <button
        className={props.className}
        aria-label={ongoing ? 'Join call' : 'Start group voice call'}
        title={ongoing ? 'Join the call going on in this group' : 'Call everyone in this group'}
        disabled={busy}
        onClick={() => go(false)}
      >
        <PhoneIcon size={props.iconSize ?? 18} />
      </button>
      <button
        className={props.className}
        aria-label={ongoing ? 'Join call with video' : 'Start group video call'}
        title={ongoing ? 'Join the call with your camera on' : 'Video call everyone in this group'}
        disabled={busy}
        onClick={() => go(true)}
      >
        <CameraIcon size={props.iconSize ?? 18} />
      </button>
    </>
  );
}

/**
 * "Call in progress" above a group's messages (2.18): who is in it, and Join. Shown while the
 * server says someone is in a call this device heard of and you are not in it.
 */
export function GroupCallBar({ conversation: c }: { conversation: ConversationView }): ReactElement | null {
  const ongoing = useOngoingCall(c.riverId);
  const active = useGroupCall((s) => s.active);
  // Drawn again whenever who is in a call changes.
  useGroupCall((s) => s.rosters);
  const busy = useDmCall((s) => !!s.active || !!s.incoming);
  const known = useGroupCall((s) => (ongoing ? s.known[ongoing] : undefined));
  if (!ongoing || !known || active?.callId === ongoing) return null;
  const people = inCall(ongoing);
  const names = people.map((id) => personName(id, c.riverId));
  return (
    <div className="gcall-bar" role="region" aria-label="Call in progress">
      <span className="gcall-bar__dot" aria-hidden="true" />
      <span className="gcall-bar__faces" aria-hidden="true">
        {people.slice(0, 4).map((id) => {
          const m = c.members.find((x) => x.riverId === id);
          return <Avatar key={id} id={id} name={personName(id, c.riverId)} avatar={m?.avatar} size={24} />;
        })}
      </span>
      <span className="gcall-bar__text">
        <strong>{known.video ? 'Video call' : 'Call'} in progress</strong>
        <span className="small muted"> · {namesLine(names)}</span>
      </span>
      <button
        className="btn btn--primary btn--small"
        disabled={busy || !!active}
        onClick={() => void joinGroupCall(ongoing, false)}
      >
        Join
      </button>
      <button
        className="btn btn--ghost btn--small"
        aria-label="Join with video"
        title="Join with your camera on"
        disabled={busy || !!active}
        onClick={() => void joinGroupCall(ongoing, true)}
      >
        <CameraIcon size={16} />
      </button>
    </div>
  );
}

/** The group's own call, in its conversation (a call-link call shows over everything instead). */
export function GroupCallInChat({
  conversation: c,
}: {
  conversation: ConversationView;
}): ReactElement | null {
  const active = useGroupCall((s) => s.active);
  const call = useCommunity((x) => x.call);
  if (!active || active.groupId !== c.riverId || !call || call.channelId !== `gcall:${active.callId}`)
    return null;
  return <GroupCallPanel key={active.callId} active={active} call={call} conversation={c} />;
}

function GroupTile(props: {
  id: string;
  name: string;
  avatar: string | null | undefined;
  speaking: boolean;
  /** Someone else in the call; absent: your own tile. */
  peer?: RemotePeer;
  /** Your own tile: what you send. */
  self?: { camera: MediaStreamTrack | null; screen: MediaStreamTrack | null; muted: boolean };
  big: boolean;
}): ReactElement {
  const { peer, self } = props;
  const settling = useJoinGrace(peer?.since, peer?.reconnecting ?? false);
  const connecting = !!peer && peer.state !== 'connected' && !peer.relayed && !settling;
  const remoteScreen = peer?.screenOn ? peer.screen : null;
  const remoteCamera = peer?.cameraOn ? peer.camera : null;
  const sharing = !!(self?.screen ?? remoteScreen);
  const picture = sharing || !!(self?.camera ?? remoteCamera);
  const muted = self ? self.muted : !!peer?.muted;
  return (
    <div
      className={`tile ${props.speaking ? 'is-speaking' : ''} ${sharing ? 'tile--screen' : ''} ${connecting ? 'tile--connecting' : ''} ${picture ? '' : 'tile--avatar'}`}
      {...(peer ? { 'data-remote': '' } : {})}
    >
      {self?.screen ? (
        <Video track={self.screen} />
      ) : self?.camera ? (
        <Video track={self.camera} mirrored />
      ) : remoteScreen ? (
        <Video stream={remoteScreen} />
      ) : remoteCamera ? (
        <Video stream={remoteCamera} />
      ) : (
        <div className="tile__avatar">
          <Avatar
            id={props.id}
            name={props.name}
            avatar={props.avatar}
            size={props.big ? 96 : 64}
            speaking={props.speaking}
          />
        </div>
      )}
      <span className="tile__label">
        {muted && <MicOffIcon size={14} />}
        {props.name}
        {self ? ' (you)' : ''}
        {peer?.relayed ? ' · via server' : ''}
        {connecting ? ` · ${peer?.reconnecting ? 'reconnecting…' : 'connecting…'}` : ''}
      </span>
      {sharing && <span className="live-badge tile__live">LIVE</span>}
    </div>
  );
}

/**
 * A group or call-link call (2.18): everyone's tile, who is not in it yet (ring them), and the
 * controls. On a phone it fills the screen like a phone call; ⌄ shrinks it.
 */
export function GroupCallPanel(props: {
  active: ActiveGroupCall;
  call: VoiceCall;
  conversation?: ConversationView;
  overlay?: boolean;
}): ReactElement {
  const { active, call, conversation: c } = props;
  const s = useCommunity();
  useCommunity((x) => x.callVersion);
  useGroupCall((x) => x.rosters);
  useGroupCall((x) => x.allowed);
  const me = useRiver((r) => r.identity);
  const phone = useRiver((r) => isPhone(r.info?.platform));
  const [minimized, setMinimized] = useState(false);
  const [picker, setPicker] = useState<ScreenSource[] | null>(null);
  const full = phone && !minimized;
  const remotes = call.remotes();
  const inside = inCall(active.callId);
  const missing = (c?.members ?? []).filter(
    (m) =>
      m.riverId !== me?.riverId && !inside.includes(m.riverId) && !remotes.some((r) => r.id === m.riverId),
  );
  const title = callName(active);
  const people = 1 + remotes.length;
  const status =
    remotes.length === 0
      ? active.outgoing && !active.connectedAt && active.groupId
        ? 'Ringing…'
        : 'Waiting for others to join…'
      : active.state === 'waiting'
        ? 'Connecting…'
        : call.largeRoom
          ? `${people} people · voice through your server, end-to-end encrypted`
          : `${people} people · end-to-end encrypted`;
  const big = remotes.length <= 1;
  const avatarOf = (id: string): string | null | undefined =>
    c?.members.find((m) => m.riverId === id)?.avatar;
  return (
    <div
      className={`gcall ${full ? 'gcall--full' : ''} ${props.overlay && !full ? 'gcall--overlay' : ''}`}
      role="region"
      aria-label={`Call: ${title}`}
    >
      <div className="gcall__top">
        {full && (
          <button
            className="dm-call__min"
            aria-label="Back to the conversation"
            title="Back to the conversation"
            onClick={() => setMinimized(true)}
          >
            ⌄
          </button>
        )}
        <strong className="gcall__name">{title}</strong>
        <span className="gcall__status small" role="status">
          {active.connectedAt && (
            <>
              <Timer since={active.connectedAt} />
              {' · '}
            </>
          )}
          {status}
        </span>
        {phone && minimized && (
          <button className="btn btn--link" onClick={() => setMinimized(false)}>
            Full screen
          </button>
        )}
      </div>
      <div className={`gcall__grid gcall__grid--${Math.min(people, 9)}`}>
        <GroupTile
          id={me?.riverId ?? 'me'}
          name={me?.displayName ?? 'You'}
          avatar={null}
          speaking={call.speaking.has(me?.riverId ?? '')}
          self={{
            camera: call.localTrack('camera'),
            screen: call.localTrack('screen'),
            muted: !call.transmitting,
          }}
          big={big}
        />
        {remotes.map((r) => (
          <GroupTile
            key={r.id}
            id={r.id}
            name={personName(r.id, active.groupId)}
            avatar={avatarOf(r.id)}
            speaking={call.speaking.has(r.id)}
            peer={r}
            big={big}
          />
        ))}
      </div>
      {active.groupId && missing.length > 0 && (
        <div className="gcall__missing small">
          <span className="muted">Not in the call: {namesLine(missing.map((m) => m.name))}</span>
          <button
            className="btn btn--link"
            aria-label="Ring everyone not in the call"
            onClick={() => void ringAgain(missing.map((m) => m.riverId))}
          >
            Ring
          </button>
        </div>
      )}
      <div className="voice__controls">
        <button
          className={`round-btn ${s.selfMuted ? 'round-btn--off' : ''}`}
          aria-label={s.selfMuted ? 'Unmute' : 'Mute'}
          onClick={s.toggleMute}
        >
          {s.selfMuted ? <MicOffIcon /> : <MicIcon />}
        </button>
        <button
          className={`round-btn ${s.selfDeafened ? 'round-btn--off' : ''}`}
          aria-label={s.selfDeafened ? 'Undeafen' : 'Deafen'}
          onClick={s.toggleDeafen}
        >
          {s.selfDeafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
        </button>
        <button
          className={`round-btn ${call.localTrack('camera') ? 'round-btn--on' : ''}`}
          aria-label={call.localTrack('camera') ? 'Camera off' : 'Camera on'}
          onClick={() =>
            void call
              .setCamera(!call.localTrack('camera'))
              .catch(() => s.notify('Could not start your camera.', 'error'))
          }
        >
          <CameraIcon />
        </button>
        {phone && <SpeakerButton initial={active.video} call={call} />}
        {!phone && document.pictureInPictureEnabled && remotes.some((r) => r.cameraOn || r.screenOn) && (
          <button
            className="round-btn"
            aria-label="Picture in picture"
            title="Keep their video in a small window on top"
            onClick={() => {
              if (document.pictureInPictureElement)
                void document.exitPictureInPicture().catch(() => undefined);
              else
                void document
                  .querySelector<HTMLVideoElement>('.gcall [data-remote] video')
                  ?.requestPictureInPicture()
                  .catch(() => s.notify('Picture in picture is not available here.', 'error'));
            }}
          >
            ⧉
          </button>
        )}
        {!phone && (
          <button
            className={`round-btn ${call.localTrack('screen') ? 'round-btn--on' : ''}`}
            aria-label={call.localTrack('screen') ? 'Stop sharing' : 'Share screen'}
            onClick={() => {
              if (call.localTrack('screen')) void call.setScreen(false);
              else void window.river.voice.screenSources().then(setPicker);
            }}
          >
            <ScreenIcon />
          </button>
        )}
        <button
          className="round-btn round-btn--danger"
          aria-label="Leave call"
          title="Leave the call (it goes on for the others)"
          onClick={() => void leaveGroupCall()}
        >
          <PhoneOffIcon />
        </button>
      </div>
      {picker && (
        <div className="picker" role="dialog" aria-label="Choose what to share">
          <div className="picker__card glass">
            <h2 className="card__title">Share your screen</h2>
            {picker.length === 0 && (
              <p className="muted">River could not find any screen or window to share.</p>
            )}
            <div className="picker__grid">
              {picker.map((src) => (
                <button
                  key={src.id}
                  className="picker__item"
                  onClick={() => {
                    setPicker(null);
                    void window.river.voice
                      .selectScreen(src.id)
                      .then(() => call.setScreen(true))
                      .catch(() => undefined);
                  }}
                >
                  <img src={src.thumbnail} alt="" />
                  <span>{src.name}</span>
                </button>
              ))}
            </div>
            <button className="btn btn--ghost" onClick={() => setPicker(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * What group calls and call links show over everything (2.18): a call-link call (it has no
 * conversation), people asking to join your call links, "Ask to join" for a link you opened,
 * and a link you just made.
 */
export function GroupCallOverlays(): ReactElement {
  const active = useGroupCall((s) => s.active);
  const call = useCommunity((x) => x.call);
  return (
    <>
      {active && !active.groupId && call?.channelId === `gcall:${active.callId}` && (
        <GroupCallPanel key={active.callId} active={active} call={call} overlay />
      )}
      <Knocks />
      <AskToJoin />
      <MadeLink />
    </>
  );
}

function Knocks(): ReactElement | null {
  const knocks = useGroupCall((s) => s.knocks);
  if (knocks.length === 0) return null;
  return (
    <div className="gcall-knocks" role="region" aria-label="People asking to join your call">
      {knocks.map((k) => (
        <div key={`${k.link}:${k.from}`} className="gcall-knock glass" role="alert">
          <Avatar id={k.from} name={k.name} size={36} />
          <span className="gcall-knock__text">
            <strong>{k.name}</strong> asks to join your call
            {!k.contact && (
              <span className="small muted"> · not in your friends (the name is theirs to choose)</span>
            )}
          </span>
          <button className="btn btn--ghost btn--small" onClick={() => void answerKnock(k, false)}>
            Deny
          </button>
          <button
            className="btn btn--primary btn--small"
            aria-label={`Let ${k.name} in`}
            onClick={() => void answerKnock(k, true)}
          >
            Let in
          </button>
        </div>
      ))}
    </div>
  );
}

function AskToJoin(): ReactElement | null {
  const asking = useGroupCall((s) => s.asking);
  useDm((d) => d.conversations);
  if (!asking) return null;
  const host = personName(asking.host, null);
  const text = {
    confirm: `${host} invited you to a call. River asks ${host} to let you in; they see your name.`,
    asking: `Waiting for ${host} to let you in…`,
    denied: `${host} didn't let you in.`,
    gone: 'That call link no longer works.',
    unanswered: `${host} didn't answer. Try again later.`,
  }[asking.state];
  return (
    <Modal title="Join the call?" onClose={stopAsking}>
      <p className="modal__text" role="status">
        {text}
      </p>
      <div className="modal__foot">
        <button className="btn btn--link" onClick={stopAsking}>
          {asking.state === 'confirm' || asking.state === 'asking' ? 'Cancel' : 'Close'}
        </button>
        {asking.state === 'confirm' && (
          <button className="btn btn--primary" autoFocus onClick={() => void askToJoin()}>
            Ask to join
          </button>
        )}
      </div>
    </Modal>
  );
}

function MadeLink(): ReactElement | null {
  const link = useGroupCall((s) => s.madeLink);
  const notify = useCommunity((x) => x.notify);
  if (!link) return null;
  const close = (): void => useGroupCall.setState({ madeLink: null });
  return (
    <Modal title="Your call link" onClose={close}>
      <p className="modal__text">
        Anyone with this link can ask to join; you let each person in. It works for 7 days. The call is
        end-to-end encrypted like every River call.
      </p>
      <input className="input gcall-link__url" readOnly value={link.url} aria-label="Call link" />
      <div className="modal__foot">
        <button
          className="btn btn--ghost"
          onClick={() =>
            void navigator.clipboard
              .writeText(link.url)
              .then(() => notify('Call link copied.'))
              .catch(() => notify('Could not copy the link.', 'error'))
          }
        >
          Copy link
        </button>
        <button className="btn btn--primary" onClick={() => void startLinkCall(link)}>
          <UsersIcon size={16} /> Start the call
        </button>
      </div>
    </Modal>
  );
}
