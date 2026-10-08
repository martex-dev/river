import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { CommunityView, ScreenSource } from '../../../shared/ipc.ts';
import { useCommunity } from '../community/store.ts';
import type { RemotePeer } from '../community/voice.ts';
import { CommunitiesIcon, LockIcon } from '../components/Icons.tsx';
import { useRiver } from '../store.ts';

export function CommunitiesPage(): ReactElement {
  const s = useCommunity();
  const identity = useRiver((r) => r.identity);
  const account = useRiver((r) => r.account);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void s.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.state]);

  const community = s.communities.find((c) => c.id === s.selectedCommunity) ?? null;
  const channel = community?.channels.find((ch) => ch.id === s.selectedChannel) ?? null;

  if (!s.loaded) return <div className="page muted">Loading…</div>;
  if (s.communities.length === 0 || adding) {
    return (
      <Welcome
        onDone={() => setAdding(false)}
        canCancel={s.communities.length > 0}
        hasAccount={account.state === 'registered'}
      />
    );
  }

  return (
    <div className="community">
      <nav className="community__servers" aria-label="Your communities">
        {s.communities.map((c) => (
          <button
            key={c.id}
            className={`community__server ${c.id === community?.id ? 'is-active' : ''}`}
            title={c.name}
            onClick={() => s.select(c.id)}
          >
            {initials(c.name)}
          </button>
        ))}
        <button
          className="community__server community__server--add"
          title="Create or join"
          onClick={() => setAdding(true)}
        >
          +
        </button>
      </nav>

      {community && (
        <ChannelList community={community} selected={s.selectedChannel} me={identity?.riverId ?? ''} />
      )}

      <section className="community__main">
        {s.connection !== 'online' && (
          <div className="community__banner" role="status">
            {s.connection === 'connecting' ? 'Connecting to your River server…' : 'Offline — reconnecting…'}
          </div>
        )}
        {community && channel?.kind === 'text' && (
          <TextChannel community={community} channelId={channel.id} name={channel.name} />
        )}
        {community && channel?.kind === 'voice' && (
          <VoiceChannel
            community={community}
            channelId={channel.id}
            name={channel.name}
            me={identity?.riverId ?? ''}
          />
        )}
      </section>

      {community && <MemberList community={community} />}
    </div>
  );
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

function Welcome(props: { onDone(): void; canCancel: boolean; hasAccount: boolean }): ReactElement {
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useRiver((r) => r.navigate);

  const run = async (kind: 'create' | 'join', e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(kind);
    setError(null);
    const res =
      kind === 'create' ? await window.river.community.create(name) : await window.river.community.join(link);
    setBusy(null);
    if (!res.ok) return setError(res.message);
    await useCommunity.getState().load();
    useCommunity.getState().select(res.value.id);
    props.onDone();
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="eyebrow">Communities</div>
        <h1 className="page__title">Your private spaces</h1>
        <p className="page__lead">
          Text and voice channels, video and screen sharing — encrypted with a key only members have.
        </p>
      </header>
      {error && (
        <div className="glass card card--error" role="alert">
          {error}
        </div>
      )}
      <div className="home__grid">
        <form className="glass card" onSubmit={(e) => void run('join', e)}>
          <h2 className="card__title">Join with an invite link</h2>
          <p className="muted small">
            Paste the link someone sent you. River sets everything up — including your account.
          </p>
          <label className="textfield">
            <span className="field__label">Invite link</span>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…/join#c=…&k=…"
              spellCheck={false}
            />
          </label>
          <div className="button-row">
            <button className="btn btn--primary" disabled={busy !== null || link.trim() === ''}>
              {busy === 'join' ? 'Joining…' : 'Join community'}
            </button>
          </div>
        </form>
        <form className="glass card" onSubmit={(e) => void run('create', e)}>
          <h2 className="card__title">Create a community</h2>
          {props.hasAccount ? (
            <>
              <p className="muted small">
                You get a #general text channel and a Lounge voice channel to start.
              </p>
              <label className="textfield">
                <span className="field__label">Community name</span>
                <input
                  value={name}
                  maxLength={64}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. The Crew"
                />
              </label>
              <div className="button-row">
                <button className="btn btn--primary" disabled={busy !== null || name.trim() === ''}>
                  {busy === 'create' ? 'Creating…' : 'Create community'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small">
                Creating a community needs an account on a River server. Set your server and create an account
                first.
              </p>
              <div className="button-row">
                <button type="button" className="btn btn--ghost" onClick={() => navigate('settings')}>
                  Open Settings → Server
                </button>
              </div>
            </>
          )}
        </form>
      </div>
      {props.canCancel && (
        <button className="btn btn--link" onClick={props.onDone}>
          ← Back to my communities
        </button>
      )}
    </div>
  );
}

function ChannelList(props: { community: CommunityView; selected: string | null; me: string }): ReactElement {
  const { community } = props;
  const s = useCommunity();
  const [invite, setInvite] = useState<string | null>(null);
  const [newChannel, setNewChannel] = useState<'text' | 'voice' | null>(null);
  const [channelName, setChannelName] = useState('');
  const [copied, setCopied] = useState(false);
  const canManage = community.myRole === 'owner' || community.myRole === 'admin';
  const nameOf = (id: string): string => community.members.find((m) => m.riverId === id)?.name ?? 'Someone';

  const makeInvite = async (): Promise<void> => {
    const res = await window.river.community.invite(community.id);
    setInvite(res.ok ? res.value : `Error: ${res.message}`);
    setCopied(false);
  };

  const addChannel = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!newChannel) return;
    const res = await window.river.community.createChannel(community.id, newChannel, channelName);
    if (res.ok) {
      setNewChannel(null);
      setChannelName('');
    }
  };

  return (
    <aside className="community__channels" aria-label="Channels">
      <div className="community__title">
        <strong>{community.name}</strong>
        <span className="chip" title="Messages are encrypted with the community key">
          <LockIcon size={11} /> E2EE
        </span>
      </div>
      {canManage && (
        <button className="btn btn--ghost btn--small community__invite" onClick={() => void makeInvite()}>
          Invite people
        </button>
      )}
      {invite && (
        <div className="invite-box">
          <p className="muted small">
            Send this link privately. Anyone with it can join and read this community.
          </p>
          <code className="invite-box__link">{invite}</code>
          <div className="button-row">
            <button
              className="btn btn--primary btn--small"
              onClick={() => {
                void navigator.clipboard.writeText(invite).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
            <button className="btn btn--link" onClick={() => setInvite(null)}>
              Close
            </button>
          </div>
        </div>
      )}
      {(['text', 'voice'] as const).map((kind) => (
        <div key={kind} className="channel-group">
          <div className="channel-group__head">
            <span>{kind === 'text' ? 'Text channels' : 'Voice channels'}</span>
            {canManage && (
              <button
                className="channel-group__add"
                title={`Add ${kind} channel`}
                onClick={() => setNewChannel(kind)}
              >
                +
              </button>
            )}
          </div>
          {newChannel === kind && (
            <form onSubmit={(e) => void addChannel(e)} className="channel-new">
              <input
                autoFocus
                value={channelName}
                maxLength={64}
                placeholder="channel name"
                onChange={(e) => setChannelName(e.target.value)}
              />
            </form>
          )}
          {community.channels
            .filter((ch) => ch.kind === kind)
            .map((ch) => (
              <div key={ch.id}>
                <button
                  className={`channel ${ch.id === props.selected ? 'is-active' : ''}`}
                  onClick={() => s.selectChannel(ch.id)}
                >
                  <span className="channel__icon">{kind === 'text' ? '#' : '🔊'}</span>
                  {ch.name}
                </button>
                {kind === 'voice' &&
                  (community.voice[ch.id] ?? []).map((id) => (
                    <div key={id} className="channel__participant">
                      <span className="status-dot status-dot--active" /> {nameOf(id)}
                      {id === props.me ? ' (you)' : ''}
                    </div>
                  ))}
              </div>
            ))}
        </div>
      ))}
    </aside>
  );
}

function TextChannel(props: { community: CommunityView; channelId: string; name: string }): ReactElement {
  const messages = useCommunity((s) => s.messages[props.channelId]) ?? [];
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, props.channelId]);

  const send = async (): Promise<void> => {
    const value = text.trim();
    if (!value) return;
    setText('');
    const res = await window.river.community.send(props.channelId, value);
    if (!res.ok) {
      setError(res.message);
      setText(value);
    } else {
      setError(null);
      useCommunity.getState().handle({ t: 'message', message: res.value });
    }
  };

  return (
    <div className="chat">
      <header className="chat__head">
        <span className="channel__icon">#</span> <strong>{props.name}</strong>
      </header>
      <div className="chat__messages">
        {messages.length === 0 && <p className="muted chat__empty">No messages yet. Say hello 👋</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const grouped =
            prev && prev.sender === m.sender && Date.parse(m.sentAt) - Date.parse(prev.sentAt) < 5 * 60_000;
          return (
            <div key={m.id} className={`msg ${grouped ? 'msg--grouped' : ''} ${m.mine ? 'msg--mine' : ''}`}>
              {!grouped && (
                <div className="msg__meta">
                  <span className="msg__avatar">{initials(m.senderName)}</span>
                  <strong>{m.senderName}</strong>
                  <time className="muted small">
                    {new Date(m.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </div>
              )}
              <div className="msg__text">{m.text}</div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {error && <p className="field__error chat__error">{error}</p>}
      <form
        className="chat__composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          rows={1}
          value={text}
          maxLength={4000}
          placeholder={`Message #${props.name}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn btn--primary" disabled={text.trim() === ''}>
          Send
        </button>
      </form>
    </div>
  );
}

function VoiceChannel(props: {
  community: CommunityView;
  channelId: string;
  name: string;
  me: string;
}): ReactElement {
  const s = useCommunity();
  useCommunity((x) => x.callVersion);
  const call = s.call;
  const inThisCall = call !== null && call.channelId === props.channelId;
  const participants = props.community.voice[props.channelId] ?? [];
  const nameOf = (id: string): string =>
    props.community.members.find((m) => m.riverId === id)?.name ?? 'Someone';
  const [picker, setPicker] = useState<ScreenSource[] | null>(null);

  const remotes = inThisCall ? call.remotes() : [];

  return (
    <div className="voice">
      <header className="chat__head">
        <span className="channel__icon">🔊</span> <strong>{props.name}</strong>
        <span className="muted small">
          {' '}
          · {participants.length} in channel · calls are encrypted between devices
        </span>
      </header>

      {!inThisCall ? (
        <div className="voice__lobby">
          <div className="voice__lobby-icon">
            <CommunitiesIcon size={40} />
          </div>
          <p className="muted">
            {participants.length
              ? `${participants.map(nameOf).join(', ')} ${participants.length === 1 ? 'is' : 'are'} here.`
              : 'Nobody is here yet.'}
          </p>
          <button className="btn btn--primary" onClick={() => void s.joinVoice(props.channelId, props.me)}>
            Join voice
          </button>
          {s.callError && <p className="field__error">{s.callError}</p>}
        </div>
      ) : (
        <>
          <div className="voice__grid">
            <Tile
              label={`${nameOf(props.me)} (you)`}
              muted={call.muted}
              camera={call.localTrack('camera')}
              screen={call.localTrack('screen')}
              self
            />
            {remotes.map((r) => (
              <RemoteTile key={r.id} peer={r} label={nameOf(r.id)} />
            ))}
          </div>
          <div className="voice__controls">
            <button
              className={`btn ${call.muted ? 'btn--danger' : 'btn--ghost'}`}
              onClick={() => call.setMuted(!call.muted)}
            >
              {call.muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => void call.setCamera(!call.localTrack('camera')).catch(() => undefined)}
            >
              {call.localTrack('camera') ? 'Camera off' : 'Camera on'}
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => {
                if (call.localTrack('screen')) void call.setScreen(false);
                else void window.river.voice.screenSources().then(setPicker);
              }}
            >
              {call.localTrack('screen') ? 'Stop sharing' : 'Share screen'}
            </button>
            <button className="btn btn--danger" onClick={() => void s.leaveVoice()}>
              Leave
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
                      .then(() => call.setScreen(true).catch(() => undefined));
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

function Video({
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
  label: string;
  muted?: boolean;
  camera: MediaStreamTrack | null;
  screen: MediaStreamTrack | null;
  self?: boolean;
}): ReactElement {
  return (
    <div className={`tile ${props.screen ? 'tile--screen' : ''}`}>
      {props.screen ? (
        <Video track={props.screen} />
      ) : props.camera ? (
        <Video track={props.camera} mirrored={props.self} />
      ) : (
        <div className="tile__avatar">{initials(props.label.replace(' (you)', ''))}</div>
      )}
      <span className="tile__label">
        {props.label}
        {props.muted ? ' · muted' : ''}
      </span>
    </div>
  );
}

function RemoteTile({ peer, label }: { peer: RemotePeer; label: string }): ReactElement {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioTrack = peer.audio?.getAudioTracks()[0] ?? null;
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const attached = (el.srcObject as MediaStream | null)?.getAudioTracks()[0] ?? null;
    if (attached === audioTrack) return;
    el.srcObject = audioTrack ? new MediaStream([audioTrack]) : null;
    if (audioTrack) void el.play().catch(() => undefined);
  });
  const connecting = peer.state !== 'connected';
  return (
    <div className={`tile ${peer.screenOn ? 'tile--screen' : ''}`}>
      <audio ref={audioRef} autoPlay />
      {peer.screenOn && peer.screen ? (
        <Video stream={peer.screen} />
      ) : peer.cameraOn && peer.camera ? (
        <Video stream={peer.camera} />
      ) : (
        <div className="tile__avatar">{initials(label)}</div>
      )}
      <span className="tile__label">
        {label}
        {peer.muted ? ' · muted' : ''}
        {connecting ? ` · ${peer.state === 'failed' ? 'could not connect' : 'connecting…'}` : ''}
      </span>
    </div>
  );
}

function MemberList({ community }: { community: CommunityView }): ReactElement {
  const order = { owner: 0, admin: 1, member: 2 } as const;
  const members = [...community.members].sort(
    (a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name),
  );
  return (
    <aside className="community__members" aria-label="Members">
      <div className="channel-group__head">
        <span>Members — {members.length}</span>
      </div>
      {members.map((m) => (
        <div key={m.riverId} className="member">
          <span className="msg__avatar">{initials(m.name)}</span>
          <span className="member__name">{m.name}</span>
          {m.role !== 'member' && <span className="member__role">{m.role}</span>}
        </div>
      ))}
    </aside>
  );
}
