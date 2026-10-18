import { isPhone } from '../../../shared/platform.ts';
import type { ReactElement } from 'react';
import type { ConversationView } from '../../../shared/dm.ts';
import { useCommunity } from '../community/store.ts';
import type { VoiceCall } from '../community/voice.ts';
import { pointOnVideo, SpeakerButton, Video } from '../community/ui/Voice.tsx';
import {
  Avatar,
  CameraIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  PhoneOffIcon,
  ScreenIcon,
} from '../community/ui/common.tsx';
import { useRiver } from '../store.ts';
import { acceptDmCall, declineDmCall, endDmCall, useDmCall } from './call.ts';
import { callName, useGroupCall } from './group-call.ts';
import { useDm } from './store.ts';
import type { ScreenSource } from '../../../shared/ipc.ts';
import { useEffect, useState } from 'react';
import { callClock } from './call-clock.ts';

/** The running time of a call, ticking every second. */
function CallTimer(props: { since: number }): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="call-timer">{callClock((now - props.since) / 1000)}</span>;
}

/** Two colours from a name, so each person's call looks a little different (as on the phone screen). */
const CALL_COLOURS: Array<[string, string]> = [
  ['#1e3c72', '#2a5298'],
  ['#42275a', '#734b6d'],
  ['#0f3443', '#2e8b6f'],
  ['#3a1c71', '#b45a6a'],
  ['#134e5e', '#4e8c62'],
  ['#232526', '#414345'],
  ['#614385', '#516395'],
  ['#1f4037', '#3f8f78'],
];

export function callColours(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
  return CALL_COLOURS[((h % CALL_COLOURS.length) + CALL_COLOURS.length) % CALL_COLOURS.length]!;
}

/**
 * An incoming 1:1 call (2.11.1): on a phone it fills the screen like a phone call (Telegram,
 * Instagram, the phone's own) — the caller's picture large, "Ringing…", big Decline and Answer;
 * on a computer the same as a card.
 */
export function IncomingCall(): ReactElement | null {
  const incoming = useDmCall((s) => s.incoming);
  const conv = useDm((d) => d.conversations.find((c) => c.riverId === incoming?.peer));
  const group = useDm((d) => d.conversations.find((c) => c.riverId === incoming?.group?.id));
  const phone = useRiver((r) => isPhone(r.info?.platform));
  if (!incoming) return null;
  // A group call (2.18): the group's name, who rang, and how many people the group has.
  const g = incoming.group;
  const caller = conv?.name ?? group?.members.find((m) => m.riverId === incoming.peer)?.name ?? 'Someone';
  const name = g ? (group?.name ?? g.name) : (conv?.name ?? 'Someone');
  const [from, to] = callColours(name);
  return (
    <div
      className={`incoming-call ${phone ? 'incoming-call--full' : ''}`}
      role="alertdialog"
      aria-label={g ? `Incoming group call in ${name}` : `Incoming call from ${name}`}
      style={{ '--call-from': from, '--call-to': to } as React.CSSProperties}
    >
      {!g && conv?.avatar && (
        <img className="incoming-call__photo" src={conv.avatar} alt="" aria-hidden="true" />
      )}
      <div className="incoming-call__card">
        <span className="incoming-call__kind">
          {g
            ? `Group ${incoming.video ? 'video ' : ''}call · ${g.people} people`
            : `River ${incoming.video ? 'video' : 'voice'} call`}
        </span>
        <div className="incoming-call__avatar">
          <span className="incoming-call__ring" aria-hidden="true" />
          <span className="incoming-call__ring incoming-call__ring--late" aria-hidden="true" />
          <Avatar
            id={g ? g.id : incoming.peer}
            name={name}
            avatar={g ? null : conv?.avatar}
            size={phone ? 128 : 96}
          />
        </div>
        <strong className="incoming-call__name">{name}</strong>
        <span className="incoming-call__status">
          {g ? `${caller} is calling… · end-to-end encrypted` : 'Ringing… · end-to-end encrypted'}
        </span>
        <div className="incoming-call__actions">
          <div className="incoming-call__action">
            <button
              className="call-action call-action--decline"
              aria-label="Decline"
              title="Decline"
              onClick={declineDmCall}
            >
              <PhoneOffIcon size={30} />
            </button>
            <span aria-hidden="true">Decline</span>
          </div>
          {incoming.video && (
            <div className="incoming-call__action">
              <button
                className="call-action call-action--answer call-action--nudge"
                aria-label="Accept with video"
                title="Answer with video"
                onClick={() => void acceptDmCall(true)}
              >
                <CameraIcon size={30} />
              </button>
              <span aria-hidden="true">Video</span>
            </div>
          )}
          <div className="incoming-call__action">
            <button
              className={`call-action call-action--answer ${incoming.video ? '' : 'call-action--nudge'}`}
              aria-label="Accept"
              title={incoming.video ? 'Answer with voice only' : 'Answer'}
              onClick={() => void acceptDmCall(false)}
            >
              <PhoneIcon size={30} />
            </button>
            <span aria-hidden="true">{incoming.video ? 'Voice' : 'Answer'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A small pill while a call runs and its conversation is not on screen. */
/**
 * Android (2.10): while a call is on, leaving River keeps the call in a small window, showing
 * the call (River opens the conversation so the window shows the call, not another page).
 */
export function CallPip(): null {
  const peer = useDmCall((s) => s.active?.peer ?? null);
  // A group or call-link call too (2.18).
  const group = useGroupCall((s) => (s.active ? (s.active.groupId ?? s.active.callId) : null));
  const on = !!peer || !!group;
  useEffect(() => {
    window.river.voice.setPip(on);
    return () => window.river.voice.setPip(false);
  }, [on]);
  useEffect(
    () =>
      window.river.app.onPip((on) => {
        document.documentElement.dataset.pip = on ? 'on' : 'off';
        // The conversation of the call opens, so the small window shows the call.
        const p = useDmCall.getState().active?.peer ?? useGroupCall.getState().active?.groupId;
        if (on && p) {
          useDm.getState().select(p);
          useRiver.getState().navigate('messages');
        }
      }),
    [],
  );
  return null;
}

export function CallPill(): ReactElement | null {
  const active = useDmCall((s) => s.active);
  const section = useRiver((r) => r.section);
  const selected = useDm((d) => d.selected);
  const name = useDm((d) => d.conversations.find((c) => c.riverId === active?.peer)?.name);
  if (!active) return <GroupCallPill />;
  if (section === 'messages' && selected === active.peer) return null;
  return (
    <button
      className="call-pill"
      onClick={() => {
        useRiver.getState().navigate('messages');
        useDm.getState().select(active.peer);
      }}
    >
      <span className="call-pill__dot" /> {active.state === 'ringing' ? 'Calling' : 'In call with'}{' '}
      {name ?? '…'}
      {active.connectedAt && (
        <>
          {' · '}
          <CallTimer since={active.connectedAt} />
        </>
      )}
    </button>
  );
}

/** The pill for a group call (2.18) whose group is not on screen (a call-link call is always shown). */
function GroupCallPill(): ReactElement | null {
  const active = useGroupCall((s) => s.active);
  const section = useRiver((r) => r.section);
  const selected = useDm((d) => d.selected);
  useDm((d) => d.conversations);
  if (!active?.groupId || (section === 'messages' && selected === active.groupId)) return null;
  const groupId = active.groupId;
  return (
    <button
      className="call-pill"
      onClick={() => {
        useRiver.getState().navigate('messages');
        useDm.getState().select(groupId);
      }}
    >
      <span className="call-pill__dot" /> In a call in {callName(active)}
      {active.connectedAt && (
        <>
          {' · '}
          <CallTimer since={active.connectedAt} />
        </>
      )}
    </button>
  );
}

export function DmCallPanel({ conversation: c }: { conversation: ConversationView }): ReactElement | null {
  const active = useDmCall((s) => s.active);
  const call = useCommunity((x) => x.call);
  // Only this conversation's own call (not a voice channel, not a call that is still being set up).
  if (!active || active.peer !== c.riverId || !call || call.channelId !== `dm:${c.riverId}`) return null;
  // Keyed by call: the screen picker and the minimized view start fresh with every call.
  return <CallPanel key={active.callId} conversation={c} call={call} />;
}

function CallPanel({
  conversation: c,
  call,
}: {
  conversation: ConversationView;
  call: VoiceCall;
}): ReactElement | null {
  const active = useDmCall((s) => s.active);
  const s = useCommunity();
  useCommunity((x) => x.callVersion);
  const me = useRiver((r) => r.identity);
  const phone = useRiver((r) => isPhone(r.info?.platform));
  const [picker, setPicker] = useState<ScreenSource[] | null>(null);
  // Phones (2.10.5): the call fills the screen like a phone call; ⌄ shrinks it into the chat.
  const [minimized, setMinimized] = useState(false);
  const full = phone && !minimized;
  if (!active) return null;
  const remote = call.remotes()[0];
  // Says "Connected" only while sound can flow: directly, or their voice arriving through the
  // server (not merely the relay being on).
  const status =
    active.state === 'ringing'
      ? 'Ringing…'
      : active.state === 'connecting'
        ? 'Connecting…'
        : remote?.state === 'connected'
          ? 'Connected · encrypted directly between your devices'
          : remote?.relayed && remote.relayFlowing
            ? 'Connected · through your server, end-to-end encrypted'
            : 'Reconnecting…';
  return (
    <div className={`dm-call ${full ? 'dm-call--full' : ''}`}>
      {full && (
        <div className="dm-call__top">
          <button
            className="dm-call__min"
            aria-label="Back to the conversation"
            title="Back to the conversation"
            onClick={() => setMinimized(true)}
          >
            ⌄
          </button>
          <strong className="dm-call__name">{c.name}</strong>
        </div>
      )}
      <div className="dm-call__stage">
        <div
          className={`tile ${call.speaking.has(me?.riverId ?? '') ? 'is-speaking' : ''} ${call.localTrack('screen') || call.localTrack('camera') ? '' : 'tile--avatar'}`}
        >
          {call.localTrack('screen') ? (
            <Video track={call.localTrack('screen')} />
          ) : call.localTrack('camera') ? (
            <Video track={call.localTrack('camera')} mirrored />
          ) : (
            <Avatar id={me?.riverId ?? 'me'} name={me?.displayName ?? 'You'} size={72} />
          )}
          <span className="tile__label">
            {!call.transmitting && <MicOffIcon size={14} />}
            {me?.displayName ?? 'You'} (you)
          </span>
        </div>
        <div
          data-remote=""
          className={`tile ${remote && call.speaking.has(c.riverId) ? 'is-speaking' : ''} ${remote?.screenOn ? 'tile--screen' : ''}`}
          // Remote assistance: click their shared screen to point at something (they see a ring).
          onClick={(e) => {
            if (!remote?.screenOn) return;
            const at = pointOnVideo(e);
            if (at) call.pointAt(c.riverId, at.x, at.y);
          }}
          title={remote?.screenOn ? 'Click to point at something on their screen' : undefined}
        >
          {remote?.screenOn && remote.screen ? (
            <Video stream={remote.screen} />
          ) : remote?.cameraOn && remote.camera ? (
            <Video stream={remote.camera} />
          ) : (
            <div className={active.state === 'ringing' ? 'dm-call__ringing' : ''}>
              <Avatar
                id={c.riverId}
                name={c.name}
                avatar={c.avatar}
                size={full ? 128 : 72}
                speaking={call.speaking.has(c.riverId)}
              />
            </div>
          )}
          <span className="tile__label">
            {remote?.muted && <MicOffIcon size={14} />}
            {c.name}
          </span>
        </div>
      </div>
      <div className="dm-call__status muted small">
        {active.connectedAt && (
          <>
            <CallTimer since={active.connectedAt} />
            {' · '}
          </>
        )}
        {status}
        {phone && minimized && (
          <>
            {' · '}
            <button className="btn btn--link" onClick={() => setMinimized(false)}>
              Full screen
            </button>
          </>
        )}
      </div>
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
        {!phone && document.pictureInPictureEnabled && (remote?.cameraOn || remote?.screenOn) && (
          <button
            className="round-btn"
            aria-label="Picture in picture"
            title="Keep their video in a small window on top"
            onClick={() => {
              if (document.pictureInPictureElement)
                void document.exitPictureInPicture().catch(() => undefined);
              else
                void document
                  .querySelector<HTMLVideoElement>('.dm-call [data-remote] video')
                  ?.requestPictureInPicture()
                  .catch(() => s.notify('Picture in picture is not available here.', 'error'));
            }}
          >
            ⧉
          </button>
        )}
        {/* Video calls start on the loudspeaker, voice calls at the ear, as on any phone. */}
        {phone && <SpeakerButton initial={active.video} call={call} />}
        <TheirVolume peer={c.riverId} name={c.name} />
        {/* Phones have no screen picker yet. */}
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
          aria-label="Hang up"
          title="Hang up"
          onClick={() => void endDmCall()}
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

/** How loud the other person sounds, 0–200 % (above 100 % River boosts without distortion). */
function TheirVolume(props: { peer: string; name: string }): ReactElement {
  const volume = useRiver((r) => r.settings?.voice.userVolumes[props.peer] ?? 1);
  const voice = useRiver((r) => r.settings?.voice);
  const update = useRiver((r) => r.updateSettings);
  return (
    <label className="dm-call__volume" title={`Volume for ${props.name}`}>
      <span className="sr-only">Volume for {props.name}</span>
      <input
        type="range"
        className="slider"
        min={0}
        max={200}
        step={5}
        value={Math.round(volume * 100)}
        aria-valuetext={`${Math.round(volume * 100)}%`}
        onChange={(e) =>
          void update({
            voice: { userVolumes: { ...voice?.userVolumes, [props.peer]: Number(e.target.value) / 100 } },
          })
        }
      />
      <span className="small muted">{Math.round(volume * 100)}%</span>
    </label>
  );
}
