// Generates a new Ed25519 release-signing key pair.
//
//   node scripts/release/generate-signing-key.ts <output-dir>
//
// Writes <output-dir>/river-release-signing-key.pem (PRIVATE — keep offline,
// store in the RIVER_RELEASE_SIGNING_KEY GitHub secret) and prints the public
// key entry to add to packages/release/src/trusted-keys.ts.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { keyIdFromPublicKey, rawPublicKeyOf } from '../../packages/release/src/manifest.ts';

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node scripts/release/generate-signing-key.ts <output-dir>');
  process.exit(2);
}
const repoRoot = resolve(import.meta.dirname, '..', '..');
const target = resolve(outDir);
if (target.toLowerCase().startsWith(repoRoot.toLowerCase())) {
  console.error('Refusing to write a private key inside the repository.');
  process.exit(2);
}
mkdirSync(target, { recursive: true });
const keyPath = join(target, 'river-release-signing-key.pem');
if (existsSync(keyPath)) {
  console.error(`${keyPath} already exists; refusing to overwrite.`);
  process.exit(2);
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
const raw = rawPublicKeyOf(publicKey);

console.log(`Private key written to ${keyPath}`);
console.log('Add to packages/release/src/trusted-keys.ts:');
console.log(JSON.stringify({ keyId: keyIdFromPublicKey(raw), publicKey: raw.toString('base64') }, null, 2));
