import { describe, expect, it } from 'vitest';
import { channelAccepts, channelOfVersion, isNewerVersion, isReleaseChannel } from '../src/index.ts';

describe('release channels', () => {
  it('maps versions to channels', () => {
    expect(channelOfVersion('0.0.1')).toBe('stable');
    expect(channelOfVersion('1.4.0-beta.2')).toBe('beta');
    expect(channelOfVersion('2.0.0-alpha.20261008')).toBe('nightly');
    expect(() => channelOfVersion('1.0.0-rc.1')).toThrow(/Unsupported prerelease/);
    expect(() => channelOfVersion('banana')).toThrow(/semantic version/);
  });

  it('only lets clients opt in to less stable channels', () => {
    expect(channelAccepts('stable', 'stable')).toBe(true);
    expect(channelAccepts('stable', 'beta')).toBe(false);
    expect(channelAccepts('stable', 'nightly')).toBe(false);
    expect(channelAccepts('beta', 'stable')).toBe(true);
    expect(channelAccepts('beta', 'nightly')).toBe(false);
    expect(channelAccepts('nightly', 'beta')).toBe(true);
  });

  it('refuses equal or older versions', () => {
    expect(isNewerVersion('0.0.2', '0.0.1')).toBe(true);
    expect(isNewerVersion('0.0.1', '0.0.1')).toBe(false);
    expect(isNewerVersion('0.0.1', '0.0.2')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.0-beta.3')).toBe(true);
    expect(isNewerVersion('garbage', '0.0.1')).toBe(false);
  });

  it('validates channel names', () => {
    expect(isReleaseChannel('beta')).toBe(true);
    expect(isReleaseChannel('latest')).toBe(false);
    expect(isReleaseChannel(3)).toBe(false);
  });
});
