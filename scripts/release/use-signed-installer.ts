// Puts the Windows installer signed by SignPath in place of the unsigned one,
// then refreshes what the auto-updater checks: latest.yml and the .blockmap.
//
//   node scripts/release/use-signed-installer.ts <signed-dir> <release-dir>
//
// Runs in the Windows build job, before the release files are collected, so the
// River release manifest and SHA256SUMS are made from the signed file.
import { copyFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { sha512Base64 } from '../../packages/release/src/index.ts';
import { updateLatestYml } from '../../packages/release/src/signed-installer.ts';

const [signedDir, releaseDir] = process.argv.slice(2);
if (!signedDir || !releaseDir) {
  console.error('usage: node scripts/release/use-signed-installer.ts <signed-dir> <release-dir>');
  process.exit(2);
}

const signed = readdirSync(signedDir).filter((f) => f.endsWith('.exe'));
if (signed.length !== 1) {
  console.error(`expected exactly one signed installer in ${signedDir}, found ${signed.length}`);
  process.exit(1);
}
const name = signed[0]!;
const target = join(releaseDir, name);
statSync(target); // the signed file must replace an installer this build made
copyFileSync(join(signedDir, name), target);

// electron-builder's own block map writer, so differential updates keep working.
const require = createRequire(import.meta.url);
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js') as {
  buildBlockMap(file: string, compression: 'gzip', out: string): Promise<{ size: number; sha512: string }>;
};
const info = await buildBlockMap(target, 'gzip', `${target}.blockmap`);
const bytes = readFileSync(target);
if (info.sha512 !== sha512Base64(bytes) || info.size !== bytes.length) {
  console.error('the block map does not describe the signed installer');
  process.exit(1);
}

const latest = join(releaseDir, 'latest.yml');
writeFileSync(latest, updateLatestYml(readFileSync(latest, 'utf8'), name, info.sha512, info.size));
console.log(`signed installer in place: ${name} (${info.size} bytes)`);
