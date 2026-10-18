import { isPhone } from '../../../../shared/platform.ts';
import {
  boost,
  boostReady,
  effectiveGain,
  onAudioStateChange,
  PHONE_OUTPUT_VOLUME,
  setBoostOutput,
  type BoostChain,
} from '../peer-audio.ts';
import { tr } from '../../i18n.ts';
import { SCREEN_QUALITIES, saveQuality, savedQuality, type ScreenQuality } from '../screen-quality.ts';
import { StagePanel } from './Stage.tsx';
import { MeetingBar, useMeetingView, useSpeakerFocus } from './Meeting.tsx';
import { encryptionNote } from '../meeting.ts';
import { priorityFactor } from '../priority-speaker.ts';
import { SoundboardButton } from './Soundboard.tsx';
import { describeLink, linkQuality, type LinkStats } from '../link-stats.ts';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { ChannelView, CommunityView, ScreenSource } from '../../../../shared/ipc.ts';
import { useRiver } from '../../store.ts';
import { play } from '../sound.ts';
import { sendVoiceState, useCommunity } from '../store.ts';
import type { RemotePeer, VoiceCall } from '../voice.ts';
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
  const phone = useRiver((r) => isPhone(r.info?.platform));
  const s = useCommunity();
  useCommunity((x) => x.callVersion);
  const call = s.call;
  const inThisCall = call !== null && call.channelId === channel.id;
  const links = useLinkStats(inThisCall ? call : null);
  const participants = community.voice[channel.id] ?? [];
  const [picker, setPicker] = useState<ScreenSource[] | null>(null);
  const [quality, setQuality] = useState<ScreenQuality>(savedQuality);
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useMeetingView();
  const placesTaken = (community.voice[channel.id] ?? []).length;
  const full =
    channel.userLimit > 0 &&
    placesTaken >= channel.userLimit &&
    !can(channel.permissions, Permission.MOVE_MEMBERS);
  const remotes = inThisCall ? call.remotes() : [];
  const canConnect = can(channel.permissions, Permission.CONNECT);
  const canStream = can(channel.permissions, Permission.STREAM);

  const meMember = memberOf(community, me);
  const tiles = inThisCall
    ? [{ id: me, self: true as const }, ...remotes.map((r) => ({ id: r.id, self: false as const, peer: r }))]
    : [];
  // On a stage only the speakers get tiles; the audience is listed in the stage panel.
  const shownTiles = channel.stage ? tiles.filter((t) => !community.voiceStates[t.id]?.serverMuted) : tiles;
  // Speaker view (2.13) shows whoever talks or shares large; a tile you clicked stays large.
  const auto = useSpeakerFocus(
    inThisCall ? call : null,
    me,
    shownTiles.map((t) => t.id),
    view,
  );
  const focused = focus && shownTiles.some((t) => t.id === focus) ? focus : auto;
  const note = encryptionNote({
    inCall: inThisCall,
    others: remotes.length,
    relayed: remotes.filter((r) => r.relayed).length,
    large: inThisCall && call.largeRoom,
  });

  return (
    <div className="voice">
      <header className="chat__head">
        <span className="channel__icon">
          {channel.stage ? <span aria-hidden="true">🎙️</span> : <SpeakerIcon size={20} />}
        </span>
        <strong>{channel.name}</strong>
        <span className="chat__topic">
          {participants.length} in channel · {note}
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
            {channel.userLimit > 0 && ` ${participants.length} of ${channel.userLimit} places taken.`}
          </p>
          {canConnect && full ? (
            <button className="btn btn--primary" disabled>
              Channel is full
            </button>
          ) : canConnect ? (
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
          {channel.stage && <StagePanel community={community} channel={channel} me={me} />}
          {!phone && (
            <MeetingBar
              call={call}
              community={community}
              channel={channel}
              me={me}
              view={view}
              onView={(v) => {
                setView(v);
                setFocus(null);
              }}
            />
          )}
          <div
            className={`voice__grid ${focused ? 'voice__grid--focus' : ''}`}
            data-count={shownTiles.length}
            data-size={shownTiles.length > 12 ? 'large' : undefined}
          >
            {shownTiles.map((t) =>
              t.self ? (
                <Tile
                  key={t.id}
                  label={`${meMember?.name ?? 'You'} (you)`}
                  id={me}
                  avatar={meMember?.avatar ?? null}
                  muted={!call.transmitting}
                  deafened={call.hearingOff}
                  speaking={call.speaking.has(me)}
                  camera={call.localTrack('camera')}
                  screen={call.localTrack('screen')}
                  focused={focused === me}
                  onClick={() => setFocus(focused === me ? null : me)}
                  hand={call.hand !== null}
                  self
                />
              ) : (
                <RemoteTile
                  key={t.id}
                  peer={t.peer}
                  link={links[t.id]}
                  community={community}
                  speaking={call.speaking.has(t.id)}
                  focused={focused === t.id}
                  onClick={() => setFocus(focused === t.id ? null : t.id)}
                  onPoint={(x, y) => call.pointAt(t.id, x, y)}
                />
              ),
            )}
          </div>
          <div className="voice__controls">
            <button
              className={`round-btn ${s.selfMuted ? 'round-btn--off' : ''}`}
              aria-label={s.selfMuted ? tr('Unmute') : tr('Mute')}
              title={s.selfMuted ? tr('Unmute') : tr('Mute')}
              onClick={s.toggleMute}
            >
              {s.selfMuted ? <MicOffIcon /> : <MicIcon />}
            </button>
            <button
              className={`round-btn ${s.selfDeafened ? 'round-btn--off' : ''}`}
              aria-label={s.selfDeafened ? tr('Undeafen') : tr('Deafen')}
              title={s.selfDeafened ? tr('Undeafen') : tr('Deafen')}
              onClick={s.toggleDeafen}
            >
              {s.selfDeafened ? <HeadphonesOffIcon /> : <HeadphonesIcon />}
            </button>
            <button
              className={`round-btn ${call.localTrack('camera') ? 'round-btn--on' : ''}`}
              aria-label={call.localTrack('camera') ? tr('Camera off') : tr('Camera on')}
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
            {phone && <SpeakerButton initial call={call} />}
            {/* Phones have no screen picker yet. */}
            {!phone && (
              <button
                className={`round-btn ${call.localTrack('screen') ? 'round-btn--on' : ''}`}
                aria-label={call.localTrack('screen') ? tr('Stop sharing') : tr('Share screen')}
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
            )}
            <SoundboardButton community={community} channelId={call.channelId} />
            {channel.prioritySpeakers?.includes(me) && (
              <button
                className={`round-btn ${call.priority ? 'round-btn--on' : ''}`}
                aria-label={call.priority ? 'Priority speaker on' : 'Priority speaker off'}
                aria-pressed={call.priority}
                title={
                  call.priority
                    ? 'Priority speaker is on: others are turned down while you talk. Click to turn off.'
                    : 'Priority speaker: turn others down while you talk'
                }
                onClick={() => call.setPriority(!call.priority)}
              >
                <span aria-hidden="true">📣</span>
              </button>
            )}
            <button
              className="round-btn round-btn--danger"
              aria-label={tr('Leave')}
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
            <div className="segmented picker__quality" role="radiogroup" aria-label="Quality">
              {SCREEN_QUALITIES.map((q) => (
                <button
                  key={q.id}
                  role="radio"
                  aria-checked={quality === q.id}
                  title={q.hint}
                  className={`segmented__item ${quality === q.id ? 'is-active' : ''}`}
                  onClick={() => {
                    setQuality(q.id);
                    saveQuality(q.id);
                  }}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <p className="muted small">{SCREEN_QUALITIES.find((q) => q.id === quality)?.hint}</p>
            <div className="picker__grid">
              {picker.map((src) => (
                <button
                  key={src.id}
                  className="picker__item"
                  onClick={() => {
                    setPicker(null);
                    void window.river.voice
                      .selectScreen(src.id)
                      .then(() => call.setScreen(true, quality))
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

/**
 * The loudspeaker choice of each call, kept for as long as the call: leaving the call's screen
 * (another conversation, another page) and coming back keeps it (2.11.3: it reset every time).
 */
const speakerChoice = new WeakMap<object, boolean>();

/** Phones: loudspeaker, or earpiece (a headset when one is connected), for this call. */
export function SpeakerButton(props: { initial: boolean; call: object }): ReactElement {
  const { initial, call } = props;
  const [on, setOn] = useState(() => speakerChoice.get(call) ?? initial);
  useEffect(() => {
    // Set once per call; afterwards the button decides.
    if (speakerChoice.has(call)) return;
    speakerChoice.set(call, initial);
    void window.river.voice.setSpeaker(initial).catch(() => undefined);
  }, [call, initial]);
  return (
    <button
      className={`round-btn ${on ? 'round-btn--on' : ''}`}
      aria-pressed={on}
      aria-label={on ? 'Speaker on' : 'Speaker off'}
      title={on ? 'Playing through the loudspeaker' : 'Playing through the earpiece, or your headset'}
      onClick={() => {
        const next = !on;
        setOn(next);
        speakerChoice.set(call, next);
        void window.river.voice.setSpeaker(next).catch(() => undefined);
      }}
    >
      <SpeakerIcon />
    </button>
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
  hand?: boolean;
}): ReactElement {
  return (
    <div
      className={`tile ${props.screen ? 'tile--screen' : ''} ${props.speaking ? 'is-speaking' : ''} ${props.focused ? 'is-focused' : ''}`}
      {...tileControls(props.label, props.speaking, props.focused, props.onClick)}
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
        {props.speaking && <SpeakingWaves />}
        {props.label}
        {props.muted ? ' · muted' : ''}
      </span>
      {props.screen && <span className="live-badge tile__live">LIVE</span>}
      {props.hand && <HandBadge />}
    </div>
  );
}

/** ✋ on the tile of someone whose hand is up (2.13). */
function HandBadge(): ReactElement {
  return (
    <span className="tile__hand" title="Hand raised" role="img" aria-label="Hand raised">
      ✋
    </span>
  );
}

/** Connection details for everyone in the call, refreshed every 3 s while shown. */
function useLinkStats(call: VoiceCall | null): Record<string, LinkStats> {
  const [links, setLinks] = useState<Record<string, LinkStats>>({});
  useEffect(() => {
    if (!call) return;
    let alive = true;
    const tick = (): void => {
      void call.linkStats().then((l) => alive && setLinks(l));
    };
    tick();
    const t = window.setInterval(tick, 3000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [call]);
  return links;
}

function LinkBars({ link }: { link: LinkStats | undefined }): ReactElement | null {
  if (!link) return null;
  const q = linkQuality(link);
  const text = describeLink(link);
  return (
    <span
      className={`link-bars link-bars--${q ?? link.path}`}
      title={text}
      aria-label={`Connection: ${text}`}
      role="img"
    >
      {link.path === 'server' ? (
        '⇄'
      ) : (
        <>
          <i />
          <i />
          <i />
        </>
      )}
    </span>
  );
}

/**
 * Where a click landed on the screen shown in a tile's video, as fractions of the shared
 * screen (the video is letterboxed: object-fit contain). Null outside the picture.
 */
export function pointOnVideo(e: MouseEvent<HTMLElement>): { x: number; y: number } | null {
  const video = e.currentTarget.querySelector('video');
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  const rect = video.getBoundingClientRect();
  const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const w = video.videoWidth * scale;
  const h = video.videoHeight * scale;
  const x = (e.clientX - rect.left - (rect.width - w) / 2) / w;
  const y = (e.clientY - rect.top - (rect.height - h) / 2) / h;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

function RemoteTile(props: {
  link?: LinkStats | undefined;
  /** Remote assistance: point at a spot on their shared screen (ADR 0007). */
  onPoint?(x: number, y: number): void;
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
  // Relayed voice works while the direct connection is still being set up.
  // A join takes a moment to connect (the server carries voice after 1.5 s if the direct way is
  // slow): only someone still not reachable after JOIN_GRACE_MS shows "connecting…".
  const settling = useJoinGrace(peer.since, peer.reconnecting);
  const connecting = peer.state !== 'connected' && !peer.relayed && !settling;
  return (
    <div
      className={`tile ${connecting ? 'tile--connecting' : ''} ${peer.screenOn ? 'tile--screen' : ''} ${props.speaking ? 'is-speaking' : ''} ${props.focused ? 'is-focused' : ''}`}
      {...tileControls(label, props.speaking, props.focused, props.onClick)}
      onClick={(e) => {
        // On a shared screen, Alt+click (or a click in fullscreen) points instead of focusing.
        if (peer.screenOn && props.onPoint && (e.altKey || document.fullscreenElement === e.currentTarget)) {
          const at = pointOnVideo(e);
          if (at) props.onPoint(at.x, at.y);
          return;
        }
        props.onClick();
      }}
      title={
        peer.screenOn ? 'Alt+click (or click in fullscreen) to point at something on their screen' : undefined
      }
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
        <LinkBars link={props.link} />
        {(peer.muted || state?.serverMuted) && <MicOffIcon size={14} />}
        {(state?.deafened || state?.serverDeafened) && <HeadphonesOffIcon size={14} />}
        {props.speaking && <SpeakingWaves />}
        {label}
        {peer.muted ? ' · muted' : ''}
        {peer.relayed ? ' · via server' : ''}
        {/* What matters is whether their voice reaches you: a direct connection does not care that
            their link to the server blipped; relayed voice does. */}
        {connecting
          ? ` · ${peer.reconnecting ? 'reconnecting…' : 'connecting…'}`
          : peer.relayed && state?.reconnecting
            ? ' · reconnecting…'
            : ''}
      </span>
      {peer.screenOn && <span className="live-badge tile__live">LIVE</span>}
      {peer.hand ? <HandBadge /> : null}
    </div>
  );
}

/**
 * Plays everyone's voice. Mounted at the app root, so the call stays audible
 * while you read text channels or other parts of River.
 */
export function CallAudio(): ReactElement | null {
  const call = useCommunity((x) => x.call);
  const communities = useCommunity((x) => x.communities);
  useCommunity((x) => x.callVersion);
  if (!call) return null;
  // Priority speaker (1.0.33): only people the community allows count.
  const allowed =
    communities.flatMap((c) => c.channels).find((ch) => ch.id === call.channelId)?.prioritySpeakers ?? [];
  const on = new Set(
    call
      .remotes()
      .filter((p) => p.priority)
      .map((p) => p.id),
  );
  return (
    <div className="call-audio" hidden>
      {call.remotes().map((peer) => (
        <PeerAudio
          key={peer.id}
          peer={peer}
          deafened={call.hearingOff}
          duck={priorityFactor(peer.id, call.speaking, on, allowed)}
        />
      ))}
    </div>
  );
}

function PeerAudio({
  peer,
  deafened,
  duck,
}: {
  peer: RemotePeer;
  deafened: boolean;
  duck: number;
}): ReactElement {
  const ref = useRef<HTMLAudioElement>(null);
  const chain = useRef<BoostChain | null>(null);
  const voiceSettings = useRiver((r) => r.settings?.voice);
  const phone = useRiver((r) => isPhone(r.info?.platform));
  const volume = voiceSettings?.userVolumes[peer.id] ?? 1;
  const outputVolume = voiceSettings?.outputVolume ?? (phone ? PHONE_OUTPUT_VOLUME : 1);
  const output = voiceSettings?.outputDeviceId ?? null;
  const track = peer.audio?.getAudioTracks()[0] ?? null;
  const gain = effectiveGain(volume, outputVolume, duck);
  // Re-run below when the audio engine starts or stops running (boost on, or back to the element).
  const [, setEngine] = useState(0);
  useEffect(() => onAudioStateChange(() => setEngine((n) => n + 1)), []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const attached = (el.srcObject as MediaStream | null)?.getAudioTracks()[0] ?? null;
    if (attached !== track) {
      el.srcObject = track ? new MediaStream([track]) : null;
      if (track) void el.play().catch(() => undefined);
    }
    // Above 100 % the voice goes through the boost (peer-audio.ts); the element stays attached
    // (muted) because Chromium only feeds a remote stream to Web Audio while one plays it.
    // While the audio engine is not running (suspended on iOS), the element plays it instead.
    if (track && !deafened && gain > 1.001 && boostReady()) {
      if (chain.current?.track !== track) {
        chain.current?.close();
        chain.current = boost(track, gain);
      } else chain.current.setGain(gain);
    } else {
      chain.current?.close();
      chain.current = null;
    }
    const boosted = chain.current !== null;
    el.volume = boosted ? 1 : Math.min(1, gain);
    el.muted = deafened || gain === 0 || boosted;
    setBoostOutput(output);
    const sink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
    if (sink.setSinkId && (sink.sinkId ?? '') !== (output ?? '')) {
      void sink.setSinkId(output ?? '').catch(() => undefined);
    }
  });
  useEffect(
    () => () => {
      chain.current?.close();
      chain.current = null;
    },
    [],
  );
  return <audio ref={ref} autoPlay data-peer={peer.id} />;
}

/**
 * Tiles are buttons: click, Enter or Space shows someone large; double-click
 * (or F) puts their video in fullscreen.
 */
function tileControls(label: string, speaking: boolean, focused: boolean, onClick: () => void) {
  const fullscreen = (el: HTMLElement): void => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  };
  return {
    role: 'button',
    tabIndex: 0,
    'aria-pressed': focused,
    'aria-label': `${label}${speaking ? ', speaking' : ''}. ${focused ? 'Shown large' : 'Show large'}; double-click for fullscreen.`,
    onClick,
    onDoubleClick: (e: MouseEvent<HTMLElement>) => fullscreen(e.currentTarget),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      } else if (e.key === 'f' || e.key === 'F') fullscreen(e.currentTarget);
    },
  } as const;
}

/** Three little bars that move while someone talks. */
function SpeakingWaves(): ReactElement {
  return (
    <span className="speaking-waves" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** How long a newly joined person is shown without "connecting…" while their link comes up. */
export const JOIN_GRACE_MS = 3000;

/** True during the first JOIN_GRACE_MS after `since` (never while reconnecting); re-renders when it ends. */
export function useJoinGrace(since: number | undefined, reconnecting: boolean): boolean {
  const until = since === undefined || reconnecting ? 0 : since + JOIN_GRACE_MS;
  /** The grace that has run out (its end time); the one for `until` is over once they match. */
  const [ended, setEnded] = useState(0);
  useEffect(() => {
    if (!until) return;
    const t = setTimeout(() => setEnded(until), Math.max(0, until - Date.now()));
    return () => clearTimeout(t);
  }, [until]);
  // A grace that was over before this tile appeared (an old join) never shows.
  const [shownAt] = useState(() => Date.now());
  return until > shownAt && ended !== until;
}
