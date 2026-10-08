// Sets the River version everywhere it is recorded.
//
//   node scripts/release/set-version.ts 0.0.2
//   node scripts/release/set-version.ts --check v0.0.2   (CI: tag must match)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { channelOfVersion } from '../../packages/release/src/channels.ts';

const root = resolve(import.meta.dirname, '..', '..');
const VERSIONED = ['package.json', 'apps/desktop/package.json', 'apps/server/package.json'];

function read(path: string): { version: string } & Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

const args = process.argv.slice(2);
if (args[0] === '--check') {
  const tag = args[1] ?? '';
  const expected = tag.replace(/^v/, '');
  const mismatched = VERSIONED.filter((p) => read(p).version !== expected);
  if (mismatched.length > 0) {
    console.error(`Tag ${tag} does not match version in: ${mismatched.join(', ')}`);
    process.exit(1);
  }
  console.log(`Version ${expected} (${channelOfVersion(expected)}) matches tag ${tag}`);
  process.exit(0);
}

const version = args[0];
if (!version) {
  console.error('usage: node scripts/release/set-version.ts <version> | --check <tag>');
  process.exit(2);
}
channelOfVersion(version); // validates semver + supported prerelease tag

for (const p of VERSIONED) {
  const json = read(p);
  json.version = version;
  writeFileSync(resolve(root, p), JSON.stringify(json, null, 2) + '\n');
}
console.log(`Set version ${version} in ${VERSIONED.join(', ')}. Run "npm install" to refresh package-lock.json.`);
