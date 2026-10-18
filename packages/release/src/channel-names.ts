/**
 * The release channel names alone, without the version parsing in channels.ts: the settings
 * schema needs them in River's window, which should not carry a semantic-version parser.
 */
export const RELEASE_CHANNELS = ['stable', 'beta', 'nightly'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];
