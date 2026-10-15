// Creates packages/protocol/vectors/formats-v1.json: cross-language vectors for the attachment
// format, the recovery phrase / backup file, and device-list signing.
//
// Attachment and backup vectors are built here with an INDEPENDENT implementation of the documented
// algorithms (fixed key / IV / nonce), so the library is checked against the spec, not against itself.
// XEdDSA signatures are randomised, so the device-list signature is produced once and then FROZEN.
// The file is never overwritten without --force (exclusive-create write), which is only for protocol v2.
//   node tests/scripts/generate-format-vectors.ts
import { createCipheriv, createHash, createHmac, hkdfSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { BYTEWORDS, publicKeyOf, sign } from '../../packages/crypto/src/index.ts';
import {
  deleteAccountMessage,
  deviceListMessage,
  registrationMessage,
  sessionMessage,
} from '../../packages/protocol/src/accounts.ts';
import { paddedSize } from '../../packages/crypto/src/attachment.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const bytes = (n: number, start = 0) => Uint8Array.from({ length: n }, (_, i) => (start + i * 3) & 0xff);
const out = fileURLToPath(new URL('../../packages/protocol/vectors/formats-v1.json', import.meta.url));

// ---- Attachments: AES-256-CBC + HMAC-SHA256, blob = IV || ciphertext || MAC --------------------
const attKey = bytes(64, 1);
const attIv = bytes(16, 200);
const attPlain = new TextEncoder().encode('hello river attachment');
const padded = Buffer.alloc(paddedSize(attPlain.length));
padded.set(attPlain);
const cipher = createCipheriv('aes-256-cbc', attKey.subarray(0, 32), attIv);
const attCt = Buffer.concat([cipher.update(padded), cipher.final()]);
const attMac = createHmac('sha256', attKey.subarray(32)).update(attIv).update(attCt).digest();
const attBlob = Buffer.concat([attIv, attCt, attMac]);
const attachment = {
  format:
    'AES-256-CBC (PKCS#7) over zero-padded plaintext; MAC = HMAC-SHA256(macKey, IV || ciphertext); blob = IV || ciphertext || MAC',
  key: hex(attKey),
  keySplit: 'bytes 0-31 AES key, bytes 32-63 HMAC key',
  iv: hex(attIv),
  plaintext: hex(attPlain),
  size: attPlain.length,
  blob: hex(attBlob),
  digest: hex(createHash('sha256').update(attBlob).digest()),
  paddedSizes: Object.fromEntries([1, 100, 541, 542, 1000, 10_000, 1_000_000].map((n) => [n, paddedSize(n)])),
};

// ---- Recovery phrase and backup file --------------------------------------------------------
const secret = bytes(16, 7);
const checksum = createHash('sha256').update(secret).digest().subarray(0, 2);
const phrase = [...secret, ...checksum].map((b) => BYTEWORDS[b]!);
const bkKey = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'river-backup-v1', 32));
const magic = Buffer.from('RIVERBK1', 'ascii');
const bkNonce = bytes(12, 90);
const bkData = { note: 'river backup vector', n: 1 };
const bk = createCipheriv('aes-256-gcm', bkKey, bkNonce);
bk.setAAD(magic);
const bkBody = Buffer.concat([bk.update(gzipSync(Buffer.from(JSON.stringify(bkData), 'utf8'))), bk.final()]);
const backup = {
  format:
    'RIVERBK1 || nonce(12) || AES-256-GCM(gzip(JSON)) || tag(16); key = HKDF-SHA256(secret, salt = empty, info = "river-backup-v1"); AAD = RIVERBK1',
  recoverySecret: hex(secret),
  phrase,
  phraseChecksumBytes: hex(checksum),
  backupKey: hex(bkKey),
  file: hex(Buffer.concat([magic, bkNonce, bkBody, bk.getAuthTag()])),
  data: bkData,
  wrongSecret: hex(bytes(16, 8)),
};

// ---- Device list signing --------------------------------------------------------------------
const signerPriv = Uint8Array.from({ length: 32 }, (_, i) => (3 * 31 + i * 7 + 1) & 0xff);
const signerPub = publicKeyOf(signerPriv);
const riverId = '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e4b71';
const deviceListText = JSON.stringify({
  version: 1,
  riverId,
  devices: [
    {
      deviceId: 1,
      authKey: b64(publicKeyOf(bytes(32, 11))),
      registrationId: 1234,
      addedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
});
const deviceListBytes = new TextEncoder().encode(deviceListText);
const challenge = bytes(32, 40);
const message = deviceListMessage(deviceListBytes);
const deviceList = {
  signerIdentityPublicKey: hex(signerPub),
  riverId,
  deviceListJson: deviceListText,
  deviceListBytes: hex(deviceListBytes),
  signedMessage: hex(message),
  signedMessageNote:
    'UTF-8 "river-device-list-v1\\n" || exact device-list bytes; the server stores and returns those exact bytes',
  signature: hex(sign(signerPriv, message)),
  challenge: hex(challenge),
  registrationMessage: hex(registrationMessage(challenge, deviceListBytes)),
  sessionMessage: hex(sessionMessage(challenge, riverId, 1)),
  deleteAccountMessage: hex(deleteAccountMessage(challenge, riverId, 1)),
};

const vectors = {
  protocol: 1,
  note: 'Cross-language vectors for formats and signing. Keys are test-only. Frozen for protocol v1.',
  attachment,
  backup,
  deviceList,
};
try {
  writeFileSync(out, JSON.stringify(vectors, null, 2) + '\n', {
    flag: process.argv[2] === '--force' ? 'w' : 'wx',
  });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  process.stderr.write('formats-v1.json is frozen. Pass --force only for a new protocol major version.\n');
  process.exit(1);
}
process.stdout.write(`wrote ${out}\n`);
