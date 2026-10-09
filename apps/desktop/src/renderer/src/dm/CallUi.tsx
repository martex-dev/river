import type { ReactElement } from 'react';
import type { ConversationView } from '../../../shared/dm.ts';
import { useCommunity } from '../community/store.ts';
import { Video } from '../community/ui/Voice.tsx';
import {
  Avatar,
  CameraIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  ScreenIcon,
} from '../community/ui/common.tsx';
import { useRiver } from '../store.ts';
import { acceptDmCall, declineDmCall, endDmCall, useDmCall } from './call.ts';
import { useDm } from './store.ts';
import type { ScreenSource } from '../../../shared/ipc.ts';
import { useState } from 'react';

export function IncomingCall(): ReactElement | null {
  const incoming = useDmCall((s) => s.incoming);
  const conv = useDm((d) => d.conversations.find((c) => c.riverId === incoming?.peer));
  if (!incoming) return null;
  const name = conv?.name ?? 'Someone';
  return (
    <div className="incoming-call" role="alertdialog" aria-label={`Incoming call from ${name}`}>
      <div className="incoming-call__card">
        <div className="incoming-call__avatar">
          <Avatar id={incoming.peer} name={name} avatar={conv?.avatar} size={88} />
        </div>
        <strong>{name}</strong>
        <span className="muted">
          Incoming {incoming.video ? 'video' : 'voice'} call · end-to-end encrypted
        </span>
        <div className="incoming-call__actions">
          <button
            className="round-btn round-btn--danger"
            aria-label="Decline"
            title="Decline"
            onClick={declineDmCall}
          >
            <PhoneOffIcon />
          </button>
          <button
            className="round-btn round-btn--accept"
            aria-label="Accept"
            title="Accept with voice"
            onClick={() => void acceptDmCall(false)}
          >
            <MicIcon />
          </button>
          {incoming.video && (
            <button
              className="round-btn round-btn--accept"
              aria-label="Accept with video"
              title="Accept with video"
              onClick={() => void acceptDmCall(true)}
            >
              <CameraIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A small pill while a call runs and its conversation is not on screen. */
export function CallPill(): ReactElement | null {
  const active = useDmCall((s) => s.active);
  const section = useRiver((r) => r.section);
  const selected = useDm((d) => d.selected);
  const name = useDm((d) => d.conversations.find((c) => c.riverId === active?.peer)?.name);
  if (!active || (section === 'messages' && selected === active.peer)) return null;
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
    </button>
  );
}

export function DmCallPanel({ conversation: c }: { conversation: ConversationView }): ReactElement | null {
  const active = useDmCall((s) => s.active);
  const s = useCommunity();
  useCommunity((x) => x.callVersion);
  const me = useRiver((r) => r.identity);
  const [picker, setPicker] = useState<ScreenSource[] | null>(null);
  const call = s.call;
  if (!active || active.peer !== c.riverId || !call) return null;
  const remote = call.remotes()[0];
  const status =
    active.state === 'ringing'
      ? 'Ringing…'
      : active.state === 'connecting' || remote?.state !== 'connected'
        ? 'Connecting…'
        : 'Connected · encrypted directly between your devices';
  return (
    <div className="dm-call">
      <div className="dm-call__stage">
        <div className={`tile ${call.speaking.has(me?.riverId ?? '') ? 'is-speaking' : ''}`}>
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
          className={`tile ${remote && call.speaking.has(c.riverId) ? 'is-speaking' : ''} ${remote?.screenOn ? 'tile--screen' : ''}`}
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
                size={72}
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
      <div className="dm-call__status muted small">{status}</div>
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
