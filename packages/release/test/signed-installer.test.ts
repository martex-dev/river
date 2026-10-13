import { describe, expect, it } from 'vitest';
import { updateLatestYml } from '../src/signed-installer.ts';

const LATEST = `version: 1.0.43
files:
  - url: River-Setup-1.0.43.exe
    sha512: OLDHASH==
    size: 100
  - url: Other.exe
    sha512: OTHER==
    size: 5
path: River-Setup-1.0.43.exe
sha512: OLDHASH==
releaseDate: '2026-10-13T00:00:00.000Z'
`;

describe('updateLatestYml (signed Windows installer)', () => {
  it('rewrites the checksum and size of the signed installer only', () => {
    expect(updateLatestYml(LATEST, 'River-Setup-1.0.43.exe', 'NEWHASH==', 120)).toBe(`version: 1.0.43
files:
  - url: River-Setup-1.0.43.exe
    sha512: NEWHASH==
    size: 120
  - url: Other.exe
    sha512: OTHER==
    size: 5
path: River-Setup-1.0.43.exe
sha512: NEWHASH==
releaseDate: '2026-10-13T00:00:00.000Z'
`);
  });

  it('accepts quoted names and refuses a file latest.yml does not list', () => {
    const quoted = LATEST.replace('- url: River-Setup-1.0.43.exe', "- url: 'River-Setup-1.0.43.exe'");
    expect(updateLatestYml(quoted, 'River-Setup-1.0.43.exe', 'N==', 1)).toContain('    sha512: N==');
    expect(() => updateLatestYml(LATEST, 'Missing.exe', 'N==', 1)).toThrow(/does not list Missing\.exe/);
  });
});
