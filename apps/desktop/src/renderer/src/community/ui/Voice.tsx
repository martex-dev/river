import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { ChannelView, CommunityView, ScreenSource } from '../../../../shared/ipc.ts';
import { useRiver } from '../../store.ts';
import { play } from '../sound.ts';
import { sendVoiceState, useCommunity } from '../store.ts';
import type { RemotePeer } from '../voice.ts';
import {
  Avatar,
  CameraIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  ScreenIcon,
  SpeakerIcon,
  can,
  memberOf,
  nameOf,
} from './common.tsx';

export function VoiceChannel(props: {
  community: CommunityView;
  channel: ChannelView;
  me: string;
}): ReactElement {
  const { community, channel, me } = props;
  const s = useCommunity();
  useCommunity((x) => x.callVersion);
  const call = s.call;
  const inThisCall = call !== null && call.channelId === channel.id;
  const participants = community.voice[channel.id] ?? [];
  const [picker, setPicker] = useState<ScreenSource[] | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const remotes = inThisCall ? call.remotes() : [];
  const canConnect = can(channel.permissions, Permission.CONNECT);
  const canStream = can(channel.permissions, Permission.STREAM);

  const meMember = memberOf(community, me);
  const tiles = inThisCall
    ? [{ id: me, self: true as const }, ...remotes.map((r) => ({ id: r.id, self: false as const, peer: r }))]
    : [];
  const focused = focus && tiles.some((t) => t.id === focus) ? focus : null;

  return (
    <div className="voice">
      <header className="chat__head">
        <span className="channel__icon">
          <SpeakerIcon size={20} />
        </span>
        <strong>{channel.name}</strong>
        <span className="chat__topic">
          {participants.length} in channel · encrypted directly between devices (DTLS-SRTP)
        </span>
      </header>

      {!inThisCall ? (
        <div className="voice__lobby">
          <div className="voice__lobby-faces">
            {participants.slice(0, 6).map((id) => (
              <Avatar
                key={id}
                id={id}
                name={nameOf(community, id)}
                avatar={memberOf(community, id)?.avatar}
                size={56}
              />
            ))}
            {participants.length === 0 && (
              <div className="voice__lobby-icon">
                <SpeakerIcon size={40} />
              </div>
            )}
          </div>
          <h2>{channel.name}</h2>
          <p className="muted">
            {participants.length
              ? `${participants.map((id) => nameOf(community, id)).join(', ')} ${participants.length === 1 ? 'is' : 'are'} here.`
              : 'Nobody is here yet.'}
          </p>
          {canConnect ? (
            <button className="btn btn--primary" onClick={() => void s.joinVoice(channel.id, me)}>
              Join voice
            </button>
          ) : (
            <p className="muted small">You do not have permission to connect to this channel.</p>
          )}
          {s.callError && <p className="field__error">{s.callError}</p>}
        </div>
      ) : (
        <>
          <div className={`voice__grid ${focused ? 'voice__grid--focus' : ''}`} data-count={tiles.length}>
            {tiles.map((t) =>
              t.self ? (
                <Tile
                  key={t.id}
                  label={`${meMember?.name ?? 'You'} (you)`}
                  id={me}
                  avatar={meMember?.avatar ?? null}
                  muted={!call.transmitting}
                  deafened={call.deafened}
                  speaking={call.speaking.has(me)}
                  camera={call.localTrack('camera')}
                  screen={call.localTrack('screen')}
                  focused={focused === me}
                  onClick={() => setFocus(focused === me ? null : me)}
                  self
                />
              ) : (
                <RemoteTile
                  key={t.id}
                  peer={t.peer}
                  community={community}
                  speaking={call.speaking.has(t.id)}
                  focused={focused === t.id}
                  onClick={() => setFocus(focused === t.id ? null : t.id)}
                />
              ),
            )}
          </div>
          <div className="voice__controls">
            <button
              className={`round-btn ${s.selfMuted ? 'round-btn--off' : ''}`}
              aria-label={s.selfMuted ? 'Unmute' : 'Mute'}
              title={s.selfMuted ? 'Unmute' : 'Mute'}
              onClick={s.toggleMute}
            >
              {s.selfMuted ? <MicOffIcon /> : <MicIcon />}
            </button>
            <button
              className={`round-btn ${s.selfDeafened ? 'round-btn--off' : ''}`}
              aria-label={s.selfDeafened ? 'Undeafen' : 'Deafen'}
              title={s.selfDeafened ? 'Undeafen' : 'Deafen'}
              onClick={s.toggleDeafen}
            >
              {s.selfDeafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
            </button>
            <button
              className={`round-btn ${call.localTrack('camera') ? 'round-btn--on' : ''}`}
              aria-label={call.localTrack('camera') ? 'Camera off' : 'Camera on'}
              title={call.localTrack('camera') ? 'Turn camera off' : 'Turn camera on'}
              disabled={!canStream}
              onClick={() =>
                void call
                  .setCamera(!call.localTrack('camera'))
                  .catch(() => s.notify('Could not start your camera.', 'error'))
              }
            >
              <CameraIcon />
            </button>
            <button
              className={`round-btn ${call.localTrack('screen') ? 'round-btn--on' : ''}`}
              aria-label={call.localTrack('screen') ? 'Stop sharing' : 'Share screen'}
              title={call.localTrack('screen') ? 'Stop sharing' : 'Share your screen'}
              disabled={!canStream}
              onClick={() => {
                if (call.localTrack('screen')) {
                  void call.setScreen(false).then(() => {
                    play('streamStop');
                    sendVoiceState();
                  });
                } else void window.river.voice.screenSources().then(setPicker);
              }}
            >
              <ScreenIcon />
            </button>
            <button
              className="round-btn round-btn--danger"
              aria-label="Leave"
              title="Disconnect"
              onClick={() => void s.leaveVoice()}
            >
              <PhoneOffIcon />
            </button>
          </div>
        </>
      )}

      {picker && call && (
        <div className="picker" role="dialog" aria-label="Choose what to share">
          <div className="picker__card glass">
            <h2 className="card__title">Share your screen</h2>
            {picker.length === 0 && (
              <p className="muted">
                River could not find any screen or window to share. On Linux with Wayland, screen sharing
                needs PipeWire and the desktop portal.
              </p>
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
                      .then(() => {
                        play('streamStart');
                        sendVoiceState();
                      })
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

export function Video({
  stream,
  track,
  mirrored,
}: {
  stream?: MediaStream | null;
  track?: MediaStreamTrack | null;
  mirrored?: boolean;
}): ReactElement {
  const ref = useRef<HTMLVideoElement>(null);
  const current = track ?? stream?.getVideoTracks()[0] ?? null;
  // Re-attach whenever the underlying track changes (peers can be re-created mid-call).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const attached = (el.srcObject as MediaStream | null)?.getVideoTracks()[0] ?? null;
    if (attached === current) return;
    el.srcObject = current ? new MediaStream([current]) : null;
    if (current) void el.play().catch(() => undefined);
  });
  return <video ref={ref} autoPlay playsInline muted className={mirrored ? 'is-mirrored' : ''} />;
}

function Tile(props: {
  id: string;
  label: string;
  avatar: string | null;
  muted?: boolean;
  deafened?: boolean;
  speaking: boolean;
  camera: MediaStreamTrack | null;
  screen: MediaStreamTrack | null;
  focused: boolean;
  onClick(): void;
  self?: boolean;
}): ReactElement {
  return (
    <div
      className={`tile ${props.screen ? 'tile--screen' : ''} ${props.speaking ? 'is-speaking' : ''} ${props.focused ? 'is-focused' : ''}`}
      onClick={props.onClick}
    >
      {props.screen ? (
        <Video track={props.screen} />
      ) : props.camera ? (
        <Video track={props.camera} mirrored={props.self} />
      ) : (
        <div className="tile__avatar">
          <Avatar
            id={props.id}
            name={props.label.replace(' (you)', '')}
            avatar={props.avatar}
            size={84}
            speaking={props.speaking}
          />
        </div>
      )}
      <span className="tile__label">
        {props.muted && <MicOffIcon size={14} />}
        {props.deafened && <HeadphonesOffIcon size={14} />}
        {props.label}
        {props.muted ? ' · muted' : ''}
      </span>
      {props.screen && <span className="live-badge tile__live">LIVE</span>}
    </div>
  );
}

function RemoteTile(props: {
  peer: RemotePeer;
  community: CommunityView;
  speaking: boolean;
  focused: boolean;
  onClick(): void;
}): ReactElement {
  const { peer, community } = props;
  const member = memberOf(community, peer.id);
  const label = member?.name ?? 'Someone';
  const state = community.voiceStates[peer.id];
  const connecting = peer.state !== 'connected';
  return (
    <div
      className={`tile ${peer.screenOn ? 'tile--screen' : ''} ${props.speaking ? 'is-speaking' : ''} ${props.focused ? 'is-focused' : ''}`}
      onClick={props.onClick}
    >
      {peer.screenOn && peer.screen ? (
        <Video stream={peer.screen} />
      ) : peer.cameraOn && peer.camera ? (
        <Video stream={peer.camera} />
      ) : (
        <div className="tile__avatar">
          <Avatar id={peer.id} name={label} avatar={member?.avatar} size={84} speaking={props.speaking} />
        </div>
      )}
      <span className="tile__label">
        {(peer.muted || state?.serverMuted) && <MicOffIcon size={14} />}
        {state?.deafened && <HeadphonesOffIcon size={14} />}
        {label}
        {peer.muted ? ' · muted' : ''}
        {connecting ? ` · ${peer.state === 'failed' ? 'could not connect' : 'connecting…'}` : ''}
      </span>
      {peer.screenOn && <span className="live-badge tile__live">LIVE</span>}
    </div>
  );
}

/**
 * Plays everyone's voice. Mounted at the app root, so the call stays audible
 * while you read text channels or other parts of River.
 */
export function CallAudio(): ReactElement | null {
  const call = useCommunity((x) => x.call);
  useCommunity((x) => x.callVersion);
  if (!call) return null;
  return (
    <div className="call-audio" hidden>
      {call.remotes().map((peer) => (
        <PeerAudio key={peer.id} peer={peer} deafened={call.deafened} />
      ))}
    </div>
  );
}

function PeerAudio({ peer, deafened }: { peer: RemotePeer; deafened: boolean }): ReactElement {
  const ref = useRef<HTMLAudioElement>(null);
  const voiceSettings = useRiver((r) => r.settings?.voice);
  const volume = voiceSettings?.userVolumes[peer.id] ?? 1;
  const output = voiceSettings?.outputDeviceId ?? null;
  const track = peer.audio?.getAudioTracks()[0] ?? null;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const attached = (el.srcObject as MediaStream | null)?.getAudioTracks()[0] ?? null;
    if (attached !== track) {
      el.srcObject = track ? new MediaStream([track]) : null;
      if (track) void el.play().catch(() => undefined);
    }
    el.volume = Math.min(1, volume);
    el.muted = deafened || volume === 0;
    const sink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
    if (sink.setSinkId && (sink.sinkId ?? '') !== (output ?? '')) {
      void sink.setSinkId(output ?? '').catch(() => undefined);
    }
  });
  return <audio ref={ref} autoPlay data-peer={peer.id} />;
}
