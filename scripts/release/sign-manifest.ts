// Builds and signs the River release manifest for a directory of release files.
//
//   RIVER_RELEASE_SIGNING_KEY="<pem>" node scripts/release/sign-manifest.ts <dir> <version> <git-commit>
//
// Writes river-release-manifest.json, its .sig, and SHA256SUMS into <dir>, then
// re-verifies the result against the keys pinned in the app so a wrong or
// rotated-out secret fails the release instead of shipping unverifiable updates.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MANIFEST_FILENAME,
  SIGNATURE_FILENAME,
  TRUSTED_RELEASE_KEYS,
  channelOfVersion,
  releaseManifestSchema,
  sha256Hex,
  sha512Base64,
  signManifest,
  verifyManifest,
  type ReleaseManifest,
} from '../../packages/release/src/index.ts';

const [dir, version, gitCommit] = process.argv.slice(2);
if (!dir || !version || !gitCommit) {
  console.error('usage: node scripts/release/sign-manifest.ts <dir> <version> <git-commit>');
  process.exit(2);
}
const pem = process.env.RIVER_RELEASE_SIGNING_KEY;
if (!pem) {
  console.error('RIVER_RELEASE_SIGNING_KEY is not set');
  process.exit(2);
}

const skip = new Set([MANIFEST_FILENAME, SIGNATURE_FILENAME, 'SHA256SUMS']);
const names = readdirSync(dir)
  .filter((n) => !skip.has(n) && statSync(join(dir, n)).isFile())
  .sort();
if (names.length === 0) {
  console.error(`No release files found in ${dir}`);
  process.exit(1);
}

const files = names.map((name) => {
  const data = readFileSync(join(dir, name));
  return { name, size: data.length, sha256: sha256Hex(data), sha512: sha512Base64(data) };
});

const manifest: ReleaseManifest = releaseManifestSchema.parse({
  schema: 1,
  product: 'river-desktop',
  version,
  channel: channelOfVersion(version),
  gitCommit,
  createdAt: new Date().toISOString(),
  files,
});

const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
const signature = signManifest(manifestBytes, pem);
const signatureBytes = Buffer.from(JSON.stringify(signature, null, 2) + '\n', 'utf8');

// Fail closed: the signature must verify against what shipped clients trust.
verifyManifest(manifestBytes, signatureBytes, TRUSTED_RELEASE_KEYS);

writeFileSync(join(dir, MANIFEST_FILENAME), manifestBytes);
writeFileSync(join(dir, SIGNATURE_FILENAME), signatureBytes);
writeFileSync(
  join(dir, 'SHA256SUMS'),
  files.map((f) => `${f.sha256}  ${f.name}`).join('\n') + '\n',
);

console.log(`Signed ${files.length} files for River ${version} with key ${signature.keyId}`);
