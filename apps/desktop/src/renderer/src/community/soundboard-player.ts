import type { SoundView } from '../../../shared/community-actions.ts';
import { useRiver } from '../store.ts';

/** Soundboard playback on this device (1.0.22). */
const players = new Map<string, HTMLAudioElement>();

/** Plays a sound on this device only (preview, or someone else's sound arriving). */
export function playLocally(sound: SoundView, volume: number): void {
  if (volume <= 0) return;
  let el = players.get(sound.id);
  if (!el || el.src !== sound.audio) {
    el = new Audio(sound.audio);
    players.set(sound.id, el);
  }
  const output = useRiver.getState().settings?.voice.outputDeviceId ?? '';
  const sink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
  if (sink.setSinkId && (sink.sinkId ?? '') !== output) void sink.setSinkId(output).catch(() => undefined);
  el.volume = Math.max(0, Math.min(1, volume));
  el.currentTime = 0;
  void el.play().catch(() => undefined);
}
