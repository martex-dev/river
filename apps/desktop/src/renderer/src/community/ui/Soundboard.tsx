import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import { SOUND_DATA_URL, SOUND_MAX_BYTES, type SoundView } from '../../../../shared/community-actions.ts';
import type { CommunityView } from '../../../../shared/ipc.ts';
import { useRiver } from '../../store.ts';
import { useCommunity } from '../store.ts';
import { EmojiPicker, Popover, can } from './common.tsx';
import { playLocally } from '../soundboard-player.ts';

/** Longest clip, in seconds. */
export const SOUND_MAX_SECONDS = 5.5;

/** The voice bar's soundboard: click a sound to play it to everyone in the channel. */
export function SoundboardButton({
  community,
  channelId,
}: {
  community: CommunityView;
  channelId: string;
}): ReactElement {
  const s = useCommunity();
  const sounds = useCommunity((x) => x.sounds[community.id]);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [cooling, setCooling] = useState(false);
  const volume = useRiver((r) => r.settings?.voice.soundboardVolume ?? 0.6);
  const channel = community.channels.find((c) => c.id === channelId);
  const mayPlay = !!channel && can(channel.permissions, Permission.SPEAK);
  useEffect(() => {
    if (open && !sounds) void s.loadSounds(community.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, community.id]);
  const playSound = (sound: SoundView): void => {
    if (cooling) return;
    void s.run({ a: 'playSound', soundId: sound.id });
    setCooling(true);
    window.setTimeout(() => setCooling(false), 2500);
  };
  return (
    <>
      <button
        className={`round-btn ${open ? 'round-btn--on' : ''}`}
        aria-label="Soundboard"
        title={mayPlay ? 'Soundboard' : 'You cannot speak in this channel'}
        disabled={!mayPlay}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { x: r.left - 120, y: r.top - 8 });
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 18 }}>
          🎵
        </span>
      </button>
      {open && (
        <Popover x={open.x} y={open.y} onClose={() => setOpen(null)} className="soundboard">
          <div className="soundboard__head">
            <strong>Soundboard</strong>
            <span className="muted small">Click to play for everyone · right-click to preview</span>
          </div>
          {sounds === undefined && <p className="muted small">Loading…</p>}
          {sounds?.length === 0 && (
            <p className="muted small">
              No sounds yet.
              {can(community.permissions, Permission.MANAGE_EXPRESSIONS) && (
                <>
                  {' '}
                  <button
                    className="btn btn--link btn--small"
                    onClick={() => {
                      setOpen(null);
                      s.setModal({ kind: 'community-settings', communityId: community.id, tab: 'sounds' });
                    }}
                  >
                    Add some
                  </button>
                </>
              )}
            </p>
          )}
          <div className="soundboard__grid">
            {sounds?.map((sound) => (
              <button
                key={sound.id}
                className="soundboard__sound"
                disabled={cooling}
                title={`${sound.name} — right-click to hear it yourself`}
                onClick={() => playSound(sound)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  playLocally(sound, Math.max(volume, 0.3));
                }}
              >
                <span aria-hidden="true">{sound.emoji ?? '🔊'}</span>
                <span className="soundboard__name">{sound.name}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(file);
  });
}

async function durationOf(file: File): Promise<number> {
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    return buffer.duration;
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

/** A name from a file name: "air horn.mp3" → "air horn". */
export function soundNameFrom(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .slice(0, 32) || 'sound'
  );
}

/** Community settings → Soundboard (1.0.22). */
export function SoundSettings({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const sounds = useCommunity((x) => x.sounds[community.id]);
  const volume = useRiver((r) => r.settings?.voice.soundboardVolume ?? 0.6);
  const manage = can(community.permissions, Permission.MANAGE_EXPRESSIONS);
  const entranceSounds = useRiver((r) => r.settings?.voice.entranceSounds);
  const entrance = entranceSounds?.[community.id] ?? null;
  const setEntrance = (soundId: string | null): void => {
    const { [community.id]: _old, ...rest } = entranceSounds ?? {};
    void useRiver
      .getState()
      .updateSettings({ voice: { entranceSounds: soundId ? { ...rest, [community.id]: soundId } : rest } });
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; emoji: string | null; audio: string } | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number; for: 'pending' | string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void s.loadSounds(community.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community.id]);
  const reload = (): void => void s.loadSounds(community.id);

  const choose = async (file: File): Promise<void> => {
    if (file.size > SOUND_MAX_BYTES)
      return s.notify(`Sounds can be up to ${Math.round(SOUND_MAX_BYTES / 1024)} KB.`, 'error');
    try {
      const seconds = await durationOf(file);
      if (seconds > SOUND_MAX_SECONDS)
        return s.notify(`Sounds can be up to ${SOUND_MAX_SECONDS} seconds long.`, 'error');
      const audio = await readAsDataUrl(file);
      if (!SOUND_DATA_URL.test(audio)) return s.notify('Use an MP3, OGG, WAV or WebM file.', 'error');
      setPending({ name: soundNameFrom(file.name), emoji: null, audio });
    } catch {
      s.notify('River could not read that sound.', 'error');
    }
  };
  const add = async (): Promise<void> => {
    if (!pending || !pending.name.trim()) return;
    setBusy(true);
    const res = await s.run({
      a: 'addSound',
      communityId: community.id,
      name: pending.name.trim(),
      emoji: pending.emoji,
      audio: pending.audio,
    });
    setBusy(false);
    if (res) {
      setPending(null);
      reload();
    }
  };
  return (
    <div className="settings-page">
      <h2>Soundboard</h2>
      <p className="muted small">
        Short sounds anyone who may speak can play in voice channels; pick one as your entrance sound. Sounds
        are end-to-end encrypted. Up to 48, each up to {SOUND_MAX_SECONDS} seconds.
      </p>
      {manage && (
        <div className="emoji-upload">
          <button className="btn btn--primary btn--small" onClick={() => fileRef.current?.click()}>
            Upload sound
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/mpeg,audio/ogg,audio/wav,audio/webm,.mp3,.ogg,.wav,.webm"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void choose(file);
            }}
          />
          {pending && (
            <div className="emoji-upload__pending">
              <button
                className="role-icon-field__pick"
                aria-label="Choose an emoji for this sound"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setPicker({ x: r.left, y: r.bottom + 6, for: 'pending' });
                }}
              >
                {pending.emoji ?? '＋'}
              </button>
              <label className="textfield">
                <span className="field__label">Name</span>
                <input
                  autoFocus
                  value={pending.name}
                  maxLength={32}
                  onChange={(e) => setPending({ ...pending, name: e.target.value })}
                />
              </label>
              <button
                className="btn btn--ghost btn--small"
                onClick={() =>
                  playLocally({ id: 'pending', name: pending.name, emoji: null, audio: pending.audio }, 0.8)
                }
              >
                ▶ Preview
              </button>
              <button
                className="btn btn--primary btn--small"
                disabled={!pending.name.trim() || busy}
                onClick={() => void add()}
              >
                Add
              </button>
              <button className="btn btn--link" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
      {picker && (
        <Popover x={picker.x} y={picker.y} onClose={() => setPicker(null)}>
          <EmojiPicker
            onPick={(emoji) => {
              setPicker(null);
              if (emoji.startsWith('<')) return;
              if (picker.for === 'pending' && pending) setPending({ ...pending, emoji });
              else
                void s
                  .run({ a: 'updateSound', communityId: community.id, soundId: picker.for, emoji })
                  .then((r) => r !== null && reload());
            }}
          />
        </Popover>
      )}
      {sounds === undefined && <p className="muted">Loading…</p>}
      {sounds?.length === 0 && <p className="muted">No sounds yet.</p>}
      <ul className="emoji-list sound-list">
        {sounds?.map((sound) => (
          <li key={sound.id} className="emoji-list__item">
            <button
              className="role-icon-field__pick"
              disabled={!manage}
              aria-label={`Emoji for ${sound.name}`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setPicker({ x: r.left, y: r.bottom + 6, for: sound.id });
              }}
            >
              {sound.emoji ?? '🔊'}
            </button>
            {renaming && renaming.id === sound.id ? (
              <form
                className="emoji-list__rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!renaming.name.trim()) return;
                  void s
                    .run({
                      a: 'updateSound',
                      communityId: community.id,
                      soundId: sound.id,
                      name: renaming.name.trim(),
                    })
                    .then((r) => {
                      if (r !== null) {
                        setRenaming(null);
                        reload();
                      }
                    });
                }}
              >
                <input
                  autoFocus
                  aria-label={`New name for ${sound.name}`}
                  value={renaming.name}
                  maxLength={32}
                  onChange={(e) => setRenaming({ id: sound.id, name: e.target.value })}
                  onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                />
                <button className="btn btn--small" disabled={!renaming.name.trim()}>
                  Save
                </button>
              </form>
            ) : manage ? (
              <button
                className="btn btn--link"
                title="Rename"
                onClick={() => setRenaming({ id: sound.id, name: sound.name })}
              >
                {sound.name}
              </button>
            ) : (
              <span>{sound.name}</span>
            )}
            <button
              className="btn btn--ghost btn--small"
              aria-label={`Preview ${sound.name}`}
              onClick={() => playLocally(sound, Math.max(volume, 0.3))}
            >
              ▶
            </button>
            <button
              className={`btn btn--small ${entrance === sound.id ? 'btn--primary' : 'btn--ghost'}`}
              aria-pressed={entrance === sound.id}
              title="Plays for everyone when you join a voice channel here"
              onClick={() => setEntrance(entrance === sound.id ? null : sound.id)}
            >
              {entrance === sound.id ? 'Your entrance sound' : 'Use as entrance'}
            </button>
            {manage && (
              <button
                className="btn btn--link btn--danger"
                aria-label={`Remove ${sound.name}`}
                onClick={() => void s.run({ a: 'deleteSound', soundId: sound.id }).then(() => reload())}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
