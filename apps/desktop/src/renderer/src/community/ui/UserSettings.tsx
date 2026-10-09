import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useRiver } from '../../store.ts';
import { SOUND_GROUPS, play, type SoundGroup, type SoundName } from '../sound.ts';
import { useCommunity, type UserTab } from '../store.ts';
import { Avatar, Modal, Toggle, XIcon } from './common.tsx';

export function UserSettings(props: { tab?: UserTab }): ReactElement {
  const s = useCommunity();
  const navigate = useRiver((r) => r.navigate);
  const [tab, setTab] = useState<UserTab>(props.tab ?? 'profile');
  const close = (): void => s.setModal(null);
  const tabs: Array<[UserTab, string]> = [
    ['profile', 'My profile'],
    ['voice', 'Voice & video'],
    ['notifications', 'Notifications'],
    ['appearance', 'Appearance'],
  ];
  return (
    <Modal onClose={close} full>
      <div className="settings-layout">
        <nav className="settings-layout__nav" aria-label="User settings">
          <div className="settings-layout__heading">User settings</div>
          {tabs.map(([id, label]) => (
            <button
              key={id}
              className={`settings-tab ${tab === id ? 'is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
          <hr />
          <button
            className="settings-tab"
            onClick={() => {
              close();
              navigate('settings');
            }}
          >
            Updates, server & privacy →
          </button>
        </nav>
        <section className="settings-layout__body">
          <button className="settings-layout__close icon-btn" aria-label="Close settings" onClick={close}>
            <XIcon />
          </button>
          {tab === 'profile' && <Profile />}
          {tab === 'voice' && <VoiceSettings />}
          {tab === 'notifications' && <NotificationSettings />}
          {tab === 'appearance' && <AppearanceSettings />}
        </section>
      </div>
    </Modal>
  );
}

/** Crops an image to a centred square and encodes it small enough for a sealed profile. */
async function toAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      128,
      128,
    );
    let data = canvas.toDataURL('image/webp', 0.85);
    if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', 0.85);
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Profile(): ReactElement {
  const s = useCommunity();
  const identity = useRiver((r) => r.identity);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name: string; avatar: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void window.river.community.profile().then((p) => {
      setName(p.name);
      setAvatar(p.avatar);
      setSaved(p);
    });
  }, []);
  const dirty = saved !== null && (name !== saved.name || avatar !== saved.avatar);
  const save = async (): Promise<void> => {
    const res = await window.river.community.action({
      a: 'setProfile',
      ...(name !== saved?.name ? { name: name.trim() } : {}),
      ...(avatar !== saved?.avatar ? { avatar } : {}),
    });
    if (!res.ok) return s.notify(res.message, 'error');
    setSaved({ name: name.trim(), avatar });
    const updated = await window.river.identity.get();
    if (updated) await useRiver.getState().identityCreated(updated);
    s.notify('Profile saved');
  };
  return (
    <div className="settings-page">
      <h2>My profile</h2>
      <div className="profile-editor">
        <div className="profile-editor__avatar">
          <Avatar id={identity?.riverId ?? 'me'} name={name || '?'} avatar={avatar} size={96} />
          <div className="button-row">
            <button className="btn btn--ghost btn--small" onClick={() => fileRef.current?.click()}>
              Change avatar
            </button>
            {avatar && (
              <button className="btn btn--link" onClick={() => setAvatar(null)}>
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.size > 15 * 1024 * 1024) return s.notify('That image is too large.', 'error');
              void toAvatar(file)
                .then(setAvatar)
                .catch(() => s.notify('River could not read that image.', 'error'));
            }}
          />
        </div>
        <div className="profile-editor__fields">
          <label className="textfield">
            <span className="field__label">Display name</span>
            <input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="muted small">
            Your name and avatar are encrypted separately for each community you are in; the server only
            stores ciphertext.
          </p>
          <div className="field__label">River ID</div>
          <code className="mono small">{identity?.riverId}</code>
        </div>
      </div>
      {dirty && (
        <div className="save-bar">
          <span>Careful — you have unsaved changes!</span>
          <button
            className="btn btn--link"
            onClick={() => {
              setName(saved.name);
              setAvatar(saved.avatar);
            }}
          >
            Reset
          </button>
          <button
            className="btn btn--primary btn--small"
            disabled={name.trim() === ''}
            onClick={() => void save()}
          >
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}

const keyLabel = (code: string): string =>
  code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('Backquote', '` (backtick)')
    .replace(/([a-z])([A-Z])/g, '$1 $2');

function VoiceSettings(): ReactElement {
  const settings = useRiver((r) => r.settings);
  const update = useRiver((r) => r.updateSettings);
  const call = useCommunity((x) => x.call);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [level, setLevel] = useState<number | null>(null);
  const voice = settings?.voice;

  useEffect(() => {
    const load = (): void => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then(setDevices)
        .catch(() => setDevices([]));
    };
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => navigator.mediaDevices.removeEventListener('devicechange', load);
  }, []);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      setCapturing(false);
      if (e.code !== 'Escape') void update({ voice: { pushToTalkKey: e.code } });
    };
    window.addEventListener('keydown', onKey, { once: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [capturing, update]);

  // Microphone test: show the input level live.
  useEffect(() => {
    if (level === null) return;
    let stop = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: voice?.inputDeviceId ? { deviceId: { exact: voice.inputDeviceId } } : true,
        });
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(512);
        const tick = (): void => {
          if (stop) return;
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
          requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setLevel(null);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level === null, voice?.inputDeviceId]);

  if (!voice) return <div className="settings-page" />;
  const inputs = devices.filter((d) => d.kind === 'audioinput');
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  const apply = (patch: Partial<typeof voice>): void => {
    void update({ voice: patch });
    if (call) {
      void call.updateOptions({
        ...(patch.inputDeviceId !== undefined ? { inputDeviceId: patch.inputDeviceId } : {}),
        ...(patch.noiseSuppression !== undefined ? { noiseSuppression: patch.noiseSuppression } : {}),
        ...(patch.echoCancellation !== undefined ? { echoCancellation: patch.echoCancellation } : {}),
        ...(patch.inputMode !== undefined ? { pushToTalk: patch.inputMode === 'push-to-talk' } : {}),
      });
    }
  };

  return (
    <div className="settings-page">
      <h2>Voice & video</h2>
      <div className="two-col">
        <label className="textfield">
          <span className="field__label">Input device</span>
          <select
            value={voice.inputDeviceId ?? ''}
            onChange={(e) => apply({ inputDeviceId: e.target.value || null })}
          >
            <option value="">Default</option>
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Microphone'}
              </option>
            ))}
          </select>
        </label>
        <label className="textfield">
          <span className="field__label">Output device</span>
          <select
            value={voice.outputDeviceId ?? ''}
            onChange={(e) => apply({ outputDeviceId: e.target.value || null })}
          >
            <option value="">Default</option>
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Speakers'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mic-test">
        <button className="btn btn--ghost btn--small" onClick={() => setLevel(level === null ? 0 : null)}>
          {level === null ? "Let's check" : 'Stop testing'}
        </button>
        <div className="meter" aria-label="Microphone level">
          <div className="meter__fill" style={{ width: `${Math.round((level ?? 0) * 100)}%` }} />
        </div>
      </div>
      <div className="field__label">Input mode</div>
      <div className="radio-cards">
        <label className={`radio-card ${voice.inputMode === 'voice' ? 'is-active' : ''}`}>
          <input
            type="radio"
            checked={voice.inputMode === 'voice'}
            onChange={() => apply({ inputMode: 'voice' })}
          />
          Voice activity
        </label>
        <label className={`radio-card ${voice.inputMode === 'push-to-talk' ? 'is-active' : ''}`}>
          <input
            type="radio"
            checked={voice.inputMode === 'push-to-talk'}
            onChange={() => apply({ inputMode: 'push-to-talk' })}
          />
          Push to talk
        </label>
      </div>
      {voice.inputMode === 'push-to-talk' && (
        <div className="ptt">
          <span className="field__label">Shortcut</span>
          <button className={`keycap ${capturing ? 'is-capturing' : ''}`} onClick={() => setCapturing(true)}>
            {capturing ? 'Press a key…' : keyLabel(voice.pushToTalkKey)}
          </button>
          <p className="muted small">Push to talk works while the River window is focused.</p>
        </div>
      )}
      <div className="perm-group__title">Voice processing</div>
      <Toggle
        label="Noise suppression"
        help="Filters background noise like fans and keyboards."
        checked={voice.noiseSuppression}
        onChange={(v) => apply({ noiseSuppression: v })}
      />
      <Toggle
        label="Echo cancellation"
        help="Stops others hearing themselves through your speakers."
        checked={voice.echoCancellation}
        onChange={(v) => apply({ echoCancellation: v })}
      />
      <div className="perm-group__title">Keyboard shortcuts</div>
      <p className="muted small">
        Ctrl+Shift+M toggles mute · Ctrl+Shift+D toggles deafen (while River is focused).
      </p>
    </div>
  );
}

function NotificationSettings(): ReactElement {
  const settings = useRiver((r) => r.settings);
  const update = useRiver((r) => r.updateSettings);
  const n = settings?.notifications;
  if (!n) return <div className="settings-page" />;
  return (
    <div className="settings-page">
      <h2>Notifications</h2>
      <Toggle
        label="Desktop notifications"
        help="Shown when River is in the background."
        checked={n.desktop}
        onChange={(v) => void update({ notifications: { desktop: v } })}
      />
      <div className="field__label">Notify me about</div>
      <div className="radio-cards">
        <label className={`radio-card ${n.mode === 'all' ? 'is-active' : ''}`}>
          <input
            type="radio"
            checked={n.mode === 'all'}
            onChange={() => void update({ notifications: { mode: 'all' } })}
          />
          All messages
        </label>
        <label className={`radio-card ${n.mode === 'mentions' ? 'is-active' : ''}`}>
          <input
            type="radio"
            checked={n.mode === 'mentions'}
            onChange={() => void update({ notifications: { mode: 'mentions' } })}
          />
          Only @mentions
        </label>
      </div>
      <div className="field__label">What notifications show</div>
      <div className="radio-cards">
        {(
          [
            ['none', 'Nothing private', '“New message”'],
            ['sender', 'Sender & channel', '“Alice · #general”'],
            ['full', 'Sender & message', 'The message text too'],
          ] as const
        ).map(([value, label, help]) => (
          <label key={value} className={`radio-card ${n.preview === value ? 'is-active' : ''}`}>
            <input
              type="radio"
              checked={n.preview === value}
              onChange={() => void update({ notifications: { preview: value } })}
            />
            <span>
              {label}
              <span className="muted small"> — {help}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="muted small">
        Notification text is shown by your operating system and may be visible on your lock screen.
      </p>
      <Toggle
        label="Sounds"
        help="Short sounds for messages, voice, calls, friends and the interface."
        checked={n.sounds}
        onChange={(v) => {
          void update({ notifications: { sounds: v } }).then(() => {
            if (v) play('success', true);
          });
        }}
      />
      {n.sounds && (
        <>
          <label className="slider-field">
            <span className="field__label">Sound volume — {Math.round(n.soundVolume * 100)}%</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(n.soundVolume * 100)}
              onChange={(e) => void update({ notifications: { soundVolume: Number(e.target.value) / 100 } })}
              onPointerUp={() => play('message', true)}
              onKeyUp={() => play('message', true)}
            />
          </label>
          <div className="sound-groups">
            {SOUND_GROUPS.map((group) => (
              <div key={group} className="sound-group">
                <Toggle
                  label={SOUND_GROUP_INFO[group].label}
                  help={SOUND_GROUP_INFO[group].help}
                  checked={n.soundGroups[group]}
                  onChange={(v) =>
                    void update({ notifications: { soundGroups: { ...n.soundGroups, [group]: v } } })
                  }
                />
                <div className="sound-group__previews">
                  {SOUND_GROUP_INFO[group].previews.map(([sound, label]) => (
                    <button
                      key={sound}
                      className="chip chip--button"
                      aria-label={`Play the ${label} sound`}
                      onClick={() => play(sound, true)}
                    >
                      ▶ {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const SOUND_GROUP_INFO: Record<
  SoundGroup,
  { label: string; help: string; previews: Array<[SoundName, string]> }
> = {
  messages: {
    label: 'Messages',
    help: 'Sending, receiving, mentions, direct messages and reactions.',
    previews: [
      ['send', 'Send'],
      ['message', 'Message'],
      ['mention', 'Mention'],
      ['dm', 'Direct message'],
      ['reaction', 'Reaction'],
    ],
  },
  voice: {
    label: 'Voice channels',
    help: 'Joining, leaving, mute, deafen and screen sharing.',
    previews: [
      ['selfJoin', 'You join'],
      ['join', 'Someone joins'],
      ['leave', 'Someone leaves'],
      ['mute', 'Mute'],
      ['deafen', 'Deafen'],
      ['streamStart', 'Go live'],
    ],
  },
  calls: {
    label: 'Calls',
    help: 'Ringing, connected and call ended.',
    previews: [
      ['ring', 'Ringing'],
      ['callConnected', 'Connected'],
      ['callEnded', 'Ended'],
    ],
  },
  social: {
    label: 'Friends and communities',
    help: 'Friend requests, new friends and joining a community.',
    previews: [
      ['friendRequest', 'Friend request'],
      ['friendAdded', 'New friend'],
      ['communityJoin', 'Joined a community'],
    ],
  },
  interface: {
    label: 'Interface',
    help: 'Copied, saved and something went wrong.',
    previews: [
      ['success', 'Done'],
      ['error', 'Error'],
    ],
  },
};

function AppearanceSettings(): ReactElement {
  const settings = useRiver((r) => r.settings);
  const update = useRiver((r) => r.updateSettings);
  const motion = settings?.appearance.motion ?? 'system';
  return (
    <div className="settings-page">
      <h2>Appearance</h2>
      <div className="field__label">Animations</div>
      <div className="radio-cards">
        {(
          [
            ['system', 'Follow my system'],
            ['full', 'Always animate'],
            ['reduced', 'Reduce motion'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className={`radio-card ${motion === value ? 'is-active' : ''}`}>
            <input
              type="radio"
              checked={motion === value}
              onChange={() => void update({ appearance: { motion: value } })}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}
