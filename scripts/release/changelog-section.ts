// Prints the CHANGELOG.md section for a version (used as GitHub Release notes).
//   node scripts/release/changelog-section.ts 0.0.1
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = process.argv[2];
if (!version) {
  console.error('usage: node scripts/release/changelog-section.ts <version>');
  process.exit(2);
}
const changelog = readFileSync(resolve(import.meta.dirname, '..', '..', 'CHANGELOG.md'), 'utf8');
const lines = changelog.split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`CHANGELOG.md has no "## [${version}]" section`);
  process.exit(1);
}
const rest = lines.slice(start + 1);
const end = rest.findIndex((l) => l.startsWith('## ['));
const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();

console.log(body);
console.log(
  [
    '',
    '---',
    '',
    '**Install:** download the file for your system below — Windows: `River-Setup-*.exe` · macOS: `River-*-arm64.dmg` (Apple silicon) or `River-*-x64.dmg` (Intel) · Linux: `.AppImage`, `.deb` or `.rpm`. See [INSTALL.md](https://github.com/martex-dev/river/blob/main/INSTALL.md).',
    '',
    '**Verify:** `SHA256SUMS` lists every file. `river-release-manifest.json` is signed (`.sig`, Ed25519) with the key pinned in River; installed copies check it automatically before updating.',
  ].join('\n'),
);
