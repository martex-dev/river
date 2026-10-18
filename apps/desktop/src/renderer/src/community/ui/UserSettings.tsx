import { tr } from '../../i18n.ts';
import { AvatarCropDialog, keepAnimated } from './AvatarCrop.tsx';
import {
  DEFAULT_KEYBINDS,
  KEYBIND_ACTIONS,
  KEYBIND_LABELS,
  clashOf,
  comboLabel,
  comboOf,
  usable,
  withDefaults,
  type KeybindAction,
} from '../../../../shared/keybinds.ts';
import { levelOf } from '../voice-gate.ts';
import { isPhone } from '../../../../shared/platform.ts';
import { PHONE_OUTPUT_VOLUME } from '../peer-audio.ts';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useRiver } from '../../store.ts';
import { SOUND_GROUPS, play, type SoundGroup, type SoundName } from '../sound.ts';
import { useCommunity } from '../store.ts';
import { Avatar, Toggle, hex } from './common.tsx';

interface ProfileDraft {
  name: string;
  avatar: string | null;
  bio: string;
  pronouns: string;
  banner: number | null;
}

const BANNER_COLORS = [0x4fe3d1, 0x5865f2, 0x3ee08f, 0xf0b232, 0xf47fff, 0xed4245, 0x9b59b6, 0x1f2937];

/**
 * Unsaved profile edits left behind when Settings closed without asking (2.11.2): answering a call,
 * an update's Details button. They come back the next time the profile opens, as long as the saved
 * profile did not change meanwhile. Leaving through Settings' own "Leave without saving?" drops them.
 */
let keptDraft: { riverId: string | null; draft: ProfileDraft; saved: ProfileDraft } | null = null;
const sameProfile = (a: ProfileDraft, b: ProfileDraft): boolean => JSON.stringify(a) === JSON.stringify(b);

export function Profile(): ReactElement {
  const s = useCommunity();
  const identity = useRiver((r) => r.identity);
  const [draft, setDraft] = useState<ProfileDraft>({
    name: '',
    avatar: null,
    bio: '',
    pronouns: '',
    banner: null,
  });
  const [saved, setSaved] = useState<ProfileDraft | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void window.river.community.profile().then((p) => {
      const kept = keptDraft;
      keptDraft = null;
      const me = useRiver.getState().identity?.riverId ?? null;
      setDraft(kept && kept.riverId === me && sameProfile(kept.saved, p) ? kept.draft : p);
      setSaved(p);
    });
  }, []);
  const [cropping, setCropping] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ProfileDraft>): void => setDraft((d) => ({ ...d, ...patch }));
  const dirty = saved !== null && !sameProfile(draft, saved);
  // Settings asks before closing or switching tabs while there are unsaved changes.
  useEffect(() => {
    useRiver.getState().setSettingsDirty(dirty);
  }, [dirty]);
  const latest = useRef({ draft, saved });
  useEffect(() => {
    latest.current = { draft, saved };
  });
  useEffect(
    () => () => {
      // Still marked unsaved: Settings closed without asking (Settings' own confirm clears the
      // mark first). Keep the edits instead of throwing them away.
      const last = latest.current;
      if (useRiver.getState().settingsDirty && last.saved && !sameProfile(last.draft, last.saved))
        keptDraft = {
          riverId: useRiver.getState().identity?.riverId ?? null,
          draft: last.draft,
          saved: last.saved,
        };
      useRiver.getState().setSettingsDirty(false);
    },
    [],
  );
  const save = async (): Promise<void> => {
    if (!saved || saving) return;
    const next = {
      ...draft,
      name: draft.name.trim(),
      bio: draft.bio.trim(),
      pronouns: draft.pronouns.trim(),
    };
    setSaving(true);
    try {
      const res = await window.river.community.action({
        a: 'setProfile',
        // An empty name is allowed (it is optional): River shows you as it does without one.
        ...(next.name !== saved.name ? { name: next.name } : {}),
        ...(next.avatar !== saved.avatar ? { avatar: next.avatar } : {}),
        ...(next.bio !== saved.bio ? { bio: next.bio } : {}),
        ...(next.pronouns !== saved.pronouns ? { pronouns: next.pronouns } : {}),
        ...(next.banner !== saved.banner ? { banner: next.banner } : {}),
      });
      if (!res.ok) return s.notify(res.message, 'error');
      setSaved(next);
      setDraft(next);
      const updated = await window.river.identity.get();
      if (updated) await useRiver.getState().identityCreated(updated);
      s.notify('Profile saved');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="settings-page">
      <h2>My profile</h2>
      <div className="profile-editor">
        <div className="profile-editor__avatar">
          <div className="profile-preview" aria-label="Preview of your profile card">
            <div
              className="profile-card__banner"
              style={draft.banner !== null ? { background: hex(draft.banner) } : undefined}
            />
            <div className="profile-preview__avatar">
              <Avatar
                id={identity?.riverId ?? 'me'}
                name={draft.name || '?'}
                avatar={draft.avatar}
                size={80}
              />
            </div>
            <div className="profile-preview__body">
              <strong>{draft.name || 'Your name'}</strong>
              {draft.pronouns && <span className="muted small">{draft.pronouns}</span>}
              {draft.bio && <p className="profile-preview__bio">{draft.bio}</p>}
            </div>
          </div>
          <div className="button-row">
            <button className="btn btn--ghost btn--small" onClick={() => fileRef.current?.click()}>
              Change avatar
            </button>
            {draft.avatar && (
              <button className="btn btn--link" onClick={() => set({ avatar: null })}>
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
              void keepAnimated(file).then((gif) => (gif ? set({ avatar: gif }) : setCropping(file)));
            }}
          />
          {cropping && (
            <AvatarCropDialog
              file={cropping}
              onClose={() => setCropping(null)}
              onDone={(avatar) => {
                setCropping(null);
                set({ avatar });
              }}
            />
          )}
        </div>
        <div className="profile-editor__fields">
          <label className="textfield">
            <span className="field__label">Display name (optional)</span>
            <input value={draft.name} maxLength={64} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="textfield">
            <span className="field__label">Pronouns</span>
            <input
              value={draft.pronouns}
              maxLength={40}
              placeholder="she/her, they/them…"
              onChange={(e) => set({ pronouns: e.target.value })}
            />
          </label>
          <label className="textfield">
            <span className="field__label">
              About me <span className="muted small">{190 - draft.bio.length}</span>
            </span>
            <textarea
              value={draft.bio}
              maxLength={190}
              rows={3}
              placeholder="A little about you"
              onChange={(e) => set({ bio: e.target.value })}
            />
          </label>
          <fieldset className="field">
            <legend className="field__label">Banner colour</legend>
            <div className="swatches">
              <button
                type="button"
                className={`swatch swatch--none ${draft.banner === null ? 'is-selected' : ''}`}
                aria-label="No banner colour"
                aria-pressed={draft.banner === null}
                onClick={() => set({ banner: null })}
              />
              {BANNER_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`swatch ${draft.banner === c ? 'is-selected' : ''}`}
                  style={{ background: hex(c) }}
                  aria-label={`Banner colour ${hex(c)}`}
                  aria-pressed={draft.banner === c}
                  onClick={() => set({ banner: c })}
                />
              ))}
            </div>
          </fieldset>
          <p className="muted small">
            Your profile is encrypted separately for each community you are in; the server only stores
            ciphertext. About me is also your bio on your social profile.
          </p>
          <div className="field__label">River ID</div>
          <code className="mono small">{identity?.riverId}</code>
        </div>
      </div>
      {dirty && (
        <div className="save-bar">
          <span>{tr('Careful — you have unsaved changes!')}</span>
          <button className="btn btn--link" disabled={saving} onClick={() => setDraft(saved)}>
            {tr('Reset')}
          </button>
          <button className="btn btn--primary btn--small" disabled={saving} onClick={() => void save()}>
            {saving ? tr('Saving…') : tr('Save changes')}
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

export function VoiceSettings(): ReactElement {
  const settings = useRiver((r) => r.settings);
  const update = useRiver((r) => r.updateSettings);
  const call = useCommunity((x) => x.call);
  const phone = useRiver((r) => isPhone(r.info?.platform));
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
        const opened = await navigator.mediaDevices.getUserMedia({
          audio: voice?.inputDeviceId ? { deviceId: { exact: voice.inputDeviceId } } : true,
        });
        // The test was stopped (or the device changed) while the microphone was opening:
        // the cleanup below already ran, so release this one here.
        if (stop) {
          opened.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = opened;
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
          setLevel(levelOf(Math.sqrt(sum / buf.length)));
          requestAnimationFrame(tick);
        };
        tick();
      } catch {
        if (!stop) setLevel(null);
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
        ...(patch.sensitivity !== undefined ? { sensitivity: patch.sensitivity } : {}),
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
        <div
          className="meter"
          role="meter"
          aria-label="Microphone level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((level ?? 0) * 100)}
        >
          <div
            className={`meter__fill ${voice.sensitivity !== null && (level ?? 0) >= voice.sensitivity ? 'is-open' : ''}`}
            style={{ width: `${Math.round((level ?? 0) * 100)}%` }}
          />
          {voice.inputMode === 'voice' && voice.sensitivity !== null && (
            <div className="meter__mark" style={{ left: `${Math.round(voice.sensitivity * 100)}%` }} />
          )}
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
      {voice.inputMode === 'voice' && (
        <div className="sensitivity">
          <Toggle
            label="Set input sensitivity automatically"
            help="River sends your voice all the time and filters noise. Turn off to choose how loud you must be."
            checked={voice.sensitivity === null}
            onChange={(auto) => apply({ sensitivity: auto ? null : 0.15 })}
          />
          {voice.sensitivity !== null && (
            <label className="sensitivity__slider">
              <span className="field__label">Input sensitivity</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(voice.sensitivity * 100)}
                aria-valuetext={`${Math.round(voice.sensitivity * 100)}%`}
                onChange={(e) => apply({ sensitivity: Number(e.target.value) / 100 })}
              />
              <span className="muted small">
                Your voice is sent while the meter is past the line (it turns green). Press Let&apos;s check
                to see it.
              </span>
            </label>
          )}
        </div>
      )}
      {voice.inputMode === 'push-to-talk' && (
        <div className="ptt">
          <span className="field__label">Shortcut</span>
          <button className={`keycap ${capturing ? 'is-capturing' : ''}`} onClick={() => setCapturing(true)}>
            {capturing ? 'Press a key…' : keyLabel(voice.pushToTalkKey)}
          </button>
          <p className="muted small">Push to talk works while the River window is focused.</p>
        </div>
      )}
      <label className="sensitivity__slider">
        <span className="field__label">
          Voice volume · {Math.round((voice.outputVolume ?? (phone ? PHONE_OUTPUT_VOLUME : 1)) * 100)}%
        </span>
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={Math.round((voice.outputVolume ?? (phone ? PHONE_OUTPUT_VOLUME : 1)) * 100)}
          aria-valuetext={`${Math.round((voice.outputVolume ?? (phone ? PHONE_OUTPUT_VOLUME : 1)) * 100)}%`}
          onChange={(e) => apply({ outputVolume: Number(e.target.value) / 100 })}
        />
        <span className="muted small">
          How loud everyone sounds in calls and voice channels. Above 100% River boosts the sound and keeps it
          from distorting.
          {voice.outputVolume !== null && (
            <>
              {' '}
              <button type="button" className="btn btn--link" onClick={() => apply({ outputVolume: null })}>
                {tr('Reset')}
              </button>
            </>
          )}
        </span>
      </label>
      <label className="sensitivity__slider">
        <span className="field__label">Soundboard volume</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(voice.soundboardVolume * 100)}
          aria-valuetext={
            voice.soundboardVolume === 0 ? 'Off' : `${Math.round(voice.soundboardVolume * 100)}%`
          }
          onChange={(e) => apply({ soundboardVolume: Number(e.target.value) / 100 })}
        />
        <span className="muted small">
          How loud other people&apos;s soundboard sounds play for you (0 turns them off).
        </span>
      </label>
      <label className="textfield">
        <span className="field__label">Leave voice when you're alone</span>
        <select
          value={voice.leaveAloneMinutes}
          onChange={(e) => apply({ leaveAloneMinutes: Number(e.target.value) })}
        >
          <option value={0}>Never</option>
          <option value={5}>After 5 minutes</option>
          <option value={15}>After 15 minutes</option>
          <option value={30}>After 30 minutes</option>
          <option value={60}>After an hour</option>
        </select>
      </label>
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
      <KeybindEditor />
    </div>
  );
}

export function NotificationSettings(): ReactElement {
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
      <Toggle
        label="Banners inside River"
        help="While River is open, a small banner shows new messages from other chats and channels. Tap it to open the chat. Muted chats stay quiet."
        checked={n.banners}
        onChange={(v) => void update({ notifications: { banners: v } })}
      />
      <Toggle
        label="Unread count on River’s icon"
        help="The number of unread messages and mentions on River’s taskbar or dock icon (and the iPhone’s app icon). Muted chats are not counted. On Android the launcher shows it from River’s notifications."
        checked={n.badge}
        onChange={(v) => void update({ notifications: { badge: v } })}
      />
      <Toggle
        label="Count archived chats"
        help="Unread messages in archived chats count on the Chats and Home badges and on River’s icon. Off: archived chats wait quietly in Archived. Message requests are never counted."
        checked={n.countArchived}
        onChange={(v) => void update({ notifications: { countArchived: v } })}
      />
      <Toggle
        label="Reactions to my messages"
        help="A sound and a small notice when someone reacts to something you wrote (while that channel is loaded)."
        checked={n.reactions}
        onChange={(v) => void update({ notifications: { reactions: v } })}
      />
      <fieldset className="field">
        <legend className="field__label">Notify me about</legend>
        <div className="radio-cards">
          <label className={`radio-card ${n.mode === 'all' ? 'is-active' : ''}`}>
            <input
              type="radio"
              name="notify-mode"
              value="all"
              checked={n.mode === 'all'}
              onChange={() => void update({ notifications: { mode: 'all' } })}
            />
            All messages
          </label>
          <label className={`radio-card ${n.mode === 'mentions' ? 'is-active' : ''}`}>
            <input
              type="radio"
              name="notify-mode"
              value="mentions"
              checked={n.mode === 'mentions'}
              onChange={() => void update({ notifications: { mode: 'mentions' } })}
            />
            Only @mentions
          </label>
        </div>
      </fieldset>
      {/* What notifications show: Settings → Notifications → Notification preview, below. */}
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
    help: 'Joining, leaving, mute, deafen, push-to-talk and screen sharing.',
    previews: [
      ['selfJoin', 'You join'],
      ['join', 'Someone joins'],
      ['leave', 'Someone leaves'],
      ['mute', 'Mute'],
      ['deafen', 'Deafen'],
      ['streamStart', 'Go live'],
      ['pttOn', 'Push-to-talk'],
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

/** Settings → Voice → Keyboard shortcuts (1.0.22): click a shortcut, press keys, done. */
function KeybindEditor(): ReactElement {
  const settings = useRiver((r) => r.settings);
  const update = useRiver((r) => r.updateSettings);
  const mac = useRiver((r) => r.info?.platform === 'darwin');
  const binds = withDefaults(settings?.voice.keybinds);
  const [capturing, setCapturing] = useState<KeybindAction | null>(null);
  const [problem, setProblem] = useState<{ action: KeybindAction; text: string } | null>(null);
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') return setCapturing(null);
      const combo = comboOf(e);
      if (!combo) return; // still holding modifiers
      setCapturing(null);
      if (!usable(combo)) {
        setProblem({
          action: capturing,
          text: 'Use Ctrl or Alt with a key (or an F key), so typing never sets it off.',
        });
        return;
      }
      const clash = clashOf(combo, binds, capturing);
      if (clash) {
        setProblem({ action: capturing, text: `${comboLabel(combo, mac)} is already used for ${clash}.` });
        return;
      }
      setProblem(null);
      void update({ voice: { keybinds: { ...binds, [capturing]: combo } } });
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capturing, binds, update, mac]);
  return (
    <div className="keybinds">
      {KEYBIND_ACTIONS.map((action) => (
        <div key={action} className="keybinds__row">
          <span>{KEYBIND_LABELS[action]}</span>
          <button
            className={`keycap ${capturing === action ? 'is-capturing' : ''}`}
            aria-label={`${KEYBIND_LABELS[action]}: ${comboLabel(binds[action], mac)}. Click to change.`}
            onClick={() => {
              setProblem(null);
              setCapturing(capturing === action ? null : action);
            }}
          >
            {capturing === action ? 'Press keys…' : comboLabel(binds[action], mac)}
          </button>
          {binds[action] && (
            <button
              className="btn btn--link btn--small"
              onClick={() => void update({ voice: { keybinds: { ...binds, [action]: '' } } })}
            >
              Clear
            </button>
          )}
          {problem?.action === action && <span className="field__error">{problem.text}</span>}
        </div>
      ))}
      <button
        className="btn btn--link btn--small"
        onClick={() => void update({ voice: { keybinds: { ...DEFAULT_KEYBINDS } } })}
      >
        Restore defaults
      </button>
      <p className="muted small">Shortcuts work while River is focused. Press Esc to stop changing one.</p>
    </div>
  );
}
