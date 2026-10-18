import { create } from 'zustand';
import type { RingingGroup } from '../../../shared/dm.ts';
import { isPhone } from '../../../shared/platform.ts';
import { play } from '../community/sound.ts';
import { useRiver } from '../store.ts';

/**
 * What 1:1 calls (call.ts) and group calls (group-call.ts, 2.18) share: the ringing call, the
 * ringtone, call IDs and their relay rooms.
 */

interface DmCallState {
  /** The call ringing here; `group`: a group call (2.18), rung by `peer` in that group. */
  incoming: { peer: string; callId: string; video: boolean; group?: RingingGroup } | null;
  active: {
    peer: string;
    callId: string;
    video: boolean;
    state: 'ringing' | 'connecting' | 'connected';
    /** When the call first connected (ms), for the call timer. */
    connectedAt?: number;
  } | null;
}

export const useDmCall = create<DmCallState>(() => ({ incoming: null, active: null }));

let toneTimer: number | undefined;

/**
 * Android rings for an incoming call with the phone's own ringtone (2.11.3: also while River is
 * in front), so it follows the phone's ringer mode — silent, vibrate, Do Not Disturb — and never
 * rings twice. River's interface rings by itself only on computers and iPhones.
 */
function phoneRingsInstead(): boolean {
  return useRiver.getState().info?.platform === 'android';
}

/** Plays the ringtone (incoming) or the ringback (calling) until stopRingTone. */
export function ringTone(sound: 'ring' | 'ringback'): void {
  stopRingTone();
  const tick = (): void => {
    if (sound === 'ring' && phoneRingsInstead()) return;
    play(sound);
  };
  tick();
  toneTimer = window.setInterval(tick, sound === 'ring' ? 2200 : 3000);
}

export function stopRingTone(): void {
  window.clearInterval(toneTimer);
  toneTimer = undefined;
}

/** Phones: the call audio River set (call mode, loudspeaker, headset) goes back to normal. */
export function resetPhoneAudio(): void {
  if (isPhone(useRiver.getState().info?.platform))
    void window.river.voice.setSpeaker(null).catch(() => undefined);
}

/** A new call's secret ID: 128 random bits. */
export function newCallId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The private relay room for a call: a hash of its secret ID, so the server never learns the ID. */
export async function callRoomOf(callId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`river-call-room:${callId}`));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** A 1:1 call (`dm:`) or a group call (`gcall:`, 2.18): not a community voice channel. */
export function isPrivateCall(channelId: string): boolean {
  return channelId.startsWith('dm:') || channelId.startsWith('gcall:');
}
