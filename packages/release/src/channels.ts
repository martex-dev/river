import semver from 'semver';

/**
 * User-facing release channels.
 *
 * Releases map onto electron-builder's channel names through the semver
 * prerelease tag: `1.2.3` → stable (`latest`), `1.2.3-beta.N` → beta,
 * `1.2.3-alpha.N` → nightly (`alpha`). electron-builder only understands the
 * latest/beta/alpha hierarchy, so nightly builds use the `alpha` tag.
 */
export const RELEASE_CHANNELS = ['stable', 'beta', 'nightly'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

export const UPDATER_CHANNEL_NAME: Record<ReleaseChannel, 'latest' | 'beta' | 'alpha'> = {
  stable: 'latest',
  beta: 'beta',
  nightly: 'alpha',
};

/** How "unstable" a channel is; a client accepts releases at or below its own rank. */
const CHANNEL_RANK: Record<ReleaseChannel, number> = { stable: 0, beta: 1, nightly: 2 };

export function isReleaseChannel(value: unknown): value is ReleaseChannel {
  return typeof value === 'string' && (RELEASE_CHANNELS as readonly string[]).includes(value);
}

/** Returns the channel a version belongs to, or throws if the version is not a valid River release version. */
export function channelOfVersion(version: string): ReleaseChannel {
  const parsed = semver.parse(version);
  if (!parsed) throw new Error(`Not a valid semantic version: ${version}`);
  const [tag] = parsed.prerelease;
  if (tag === undefined) return 'stable';
  if (tag === 'beta') return 'beta';
  if (tag === 'alpha') return 'nightly';
  throw new Error(`Unsupported prerelease tag "${String(tag)}" in ${version}; use -beta.N or -alpha.N`);
}

/** True when a client on `clientChannel` may install a release published on `releaseChannel`. */
export function channelAccepts(clientChannel: ReleaseChannel, releaseChannel: ReleaseChannel): boolean {
  return CHANNEL_RANK[releaseChannel] <= CHANNEL_RANK[clientChannel];
}

/** Strictly-newer check used to refuse downgrades and replays of old releases. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = semver.parse(candidate);
  const b = semver.parse(current);
  if (!a || !b) return false;
  return semver.gt(a, b);
}
