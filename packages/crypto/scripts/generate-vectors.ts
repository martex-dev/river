// Regenerates packages/protocol/vectors/identity-v1.json.
// Deterministic fields come from fixed private keys; signatures (XEdDSA is
// randomised) are produced once and then FROZEN: the vector test only verifies them.
// Run only when the protocol major version changes:  node packages/crypto/scripts/generate-vectors.ts
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  formatFingerprint,
  formatSafetyNumber,
  identityFingerprint,
  publicKeyOf,
  safetyNumber,
  sign,
  verificationWords,
} from '../src/index.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const out = fileURLToPath(new URL('../../protocol/vectors/identity-v1.json', import.meta.url));
if (existsSync(out) && process.argv[2] !== '--force') {
  process.stderr.write('identity-v1.json is frozen. Pass --force only for a new protocol major version.\n');
  process.exit(1);
}

const seed = (n: number) => Uint8Array.from({ length: 32 }, (_, i) => (n * 31 + i * 7 + 1) & 0xff);
const identities = [
  { riverId: '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e4b71', privateKey: seed(1) },
  { riverId: '9a1d7e52-2c3f-4b88-8d0e-71f4a5c6b923', privateKey: seed(2) },
];
const withKeys = identities.map((i) => {
  const publicKey = publicKeyOf(i.privateKey);
  const fp = identityFingerprint(publicKey);
  return {
    riverId: i.riverId,
    privateKey: hex(i.privateKey),
    publicKey: hex(publicKey),
    fingerprint: hex(fp),
    fingerprintFormatted: formatFingerprint(fp),
    words: verificationWords(fp),
  };
});
const [a, b] = identities.map((i, n) => ({ riverId: i.riverId, publicKey: publicKeyOf(i.privateKey), n }));
const sn = safetyNumber(a!, b!);
const snReverse = safetyNumber(b!, a!);
const message = new TextEncoder().encode('river protocol v1 signature vector');
const vectors = {
  protocol: 1,
  note: 'Cross-language test vectors. Every River client must reproduce these exactly. Keys are test-only.',
  identities: withKeys,
  safetyNumber: {
    between: [a!.riverId, b!.riverId],
    digits: sn.digits,
    formatted: formatSafetyNumber(sn.digits),
    // Digits are identical from both sides; the scannable (QR) form puts the local party first.
    scannableFromFirst: hex(sn.scannable),
    scannableFromSecond: hex(snReverse.scannable),
  },
  signature: {
    scheme: 'XEdDSA over libsignal Curve25519 keys',
    signer: 0,
    message: hex(message),
    signature: hex(sign(identities[0]!.privateKey, message)),
  },
};
writeFileSync(out, JSON.stringify(vectors, null, 2) + '\n');
process.stdout.write(`wrote ${out} (${readFileSync(out).length} bytes)\n`);
