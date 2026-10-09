/**
 * Which sounds exist, their groups, and whether one should play with the
 * user's settings. No audio here, so it can be tested anywhere.
 */
export type SoundName =
  | 'message'
  | 'mention'
  | 'join'
  | 'leave'
  | 'selfJoin'
  | 'selfLeave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'streamStart'
  | 'streamStop'
  | 'disconnected'
  | 'ring'
  | 'ringback'
  | 'send'
  | 'dm'
  | 'reaction'
  | 'callConnected'
  | 'callEnded'
  | 'communityJoin'
  | 'friendRequest'
  | 'friendAdded'
  | 'success'
  | 'error';

/** Sounds come in groups you can switch off separately (Settings → Notifications). */
export type SoundGroup = 'messages' | 'voice' | 'calls' | 'social' | 'interface';
export const SOUND_GROUPS: readonly SoundGroup[] = ['messages', 'voice', 'calls', 'social', 'interface'];

export const SOUND_GROUP: Record<SoundName, SoundGroup> = {
  message: 'messages',
  mention: 'messages',
  send: 'messages',
  dm: 'messages',
  reaction: 'messages',
  join: 'voice',
  leave: 'voice',
  selfJoin: 'voice',
  selfLeave: 'voice',
  mute: 'voice',
  unmute: 'voice',
  deafen: 'voice',
  undeafen: 'voice',
  streamStart: 'voice',
  streamStop: 'voice',
  disconnected: 'voice',
  ring: 'calls',
  ringback: 'calls',
  callConnected: 'calls',
  callEnded: 'calls',
  communityJoin: 'social',
  friendRequest: 'social',
  friendAdded: 'social',
  success: 'interface',
  error: 'interface',
};

export interface SoundConfig {
  sounds: boolean;
  /** 0–1. */
  soundVolume: number;
  soundGroups: Record<SoundGroup, boolean>;
}

/** Whether `name` would be heard with these settings. */
export function audible(name: SoundName, config: SoundConfig | undefined): boolean {
  if (!config) return true;
  return config.sounds && config.soundVolume > 0 && config.soundGroups[SOUND_GROUP[name]] !== false;
}
