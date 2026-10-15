import { hkdfSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AttachmentIntegrityError,
  BackupError,
  decryptAttachment,
  openBackup,
  paddedSize,
  parseRecoveryPhrase,
  recoveryPhrase,
  verify,
} from '../../packages/crypto/src/index.ts';
import {
  deleteAccountMessage,
  deviceListMessage,
  parseDeviceList,
  registrationMessage,
  sessionMessage,
} from '../../packages/protocol/src/accounts.ts';

// The same file is the contract for the iOS and Android clients (docs/protocol/stability.md).
const v = JSON.parse(
  readFileSync(new URL('../../packages/protocol/vectors/formats-v1.json', import.meta.url), 'utf8'),
);
const bytes = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'));

describe('protocol v1 format vectors (formats-v1.json)', () => {
  describe('attachments', () => {
    const pointer = {
      key: bytes(v.attachment.key),
      digest: bytes(v.attachment.digest),
      size: v.attachment.size,
    };

    it('decrypts the independently built blob', () => {
      const plain = decryptAttachment(bytes(v.attachment.blob), pointer);
      expect(Buffer.from(plain).toString('hex')).toBe(v.attachment.plaintext);
    });

    it('reproduces every padded size bucket', () => {
      for (const [size, padded] of Object.entries(v.attachment.paddedSizes)) {
        expect(paddedSize(Number(size))).toBe(padded);
      }
    });

    it('rejects a flipped bit, a wrong digest and a wrong key', () => {
      const blob = bytes(v.attachment.blob);
      const flipped = blob.slice();
      flipped[20] = flipped[20]! ^ 1;
      expect(() => decryptAttachment(flipped, pointer)).toThrow(AttachmentIntegrityError);
      expect(() => decryptAttachment(blob, { ...pointer, digest: new Uint8Array(32) })).toThrow(
        AttachmentIntegrityError,
      );
      const key = pointer.key.slice();
      key[40] = key[40]! ^ 1;
      expect(() => decryptAttachment(blob, { ...pointer, key })).toThrow(AttachmentIntegrityError);
    });
  });

  describe('recovery phrase and backup', () => {
    it('turns the secret into the phrase and back', () => {
      expect(recoveryPhrase(bytes(v.backup.recoverySecret))).toEqual(v.backup.phrase);
      expect(Buffer.from(parseRecoveryPhrase(v.backup.phrase.join(' '))).toString('hex')).toBe(
        v.backup.recoverySecret,
      );
    });

    it('rejects a phrase with a swapped word', () => {
      const words = [...v.backup.phrase];
      [words[0], words[1]] = [words[1], words[0]];
      expect(() => parseRecoveryPhrase(words.join(' '))).toThrow(BackupError);
    });

    it('derives the backup key with HKDF-SHA256 and the documented info string', () => {
      const key = Buffer.from(
        hkdfSync('sha256', bytes(v.backup.recoverySecret), Buffer.alloc(0), 'river-backup-v1', 32),
      );
      expect(key.toString('hex')).toBe(v.backup.backupKey);
    });

    it('opens the independently built backup file', () => {
      expect(openBackup(bytes(v.backup.recoverySecret), bytes(v.backup.file))).toEqual(v.backup.data);
    });

    it('does not open with the wrong secret or a damaged file', () => {
      expect(() => openBackup(bytes(v.backup.wrongSecret), bytes(v.backup.file))).toThrow(BackupError);
      const damaged = bytes(v.backup.file);
      damaged[30] = damaged[30]! ^ 1;
      expect(() => openBackup(bytes(v.backup.recoverySecret), damaged)).toThrow(BackupError);
    });
  });

  describe('device list signing', () => {
    const d = v.deviceList;
    const listBytes = bytes(d.deviceListBytes);
    const challenge = bytes(d.challenge);

    it('builds the signed messages byte for byte', () => {
      expect(Buffer.from(listBytes).toString('utf8')).toBe(d.deviceListJson);
      expect(Buffer.from(deviceListMessage(listBytes)).toString('hex')).toBe(d.signedMessage);
      expect(Buffer.from(registrationMessage(challenge, listBytes)).toString('hex')).toBe(
        d.registrationMessage,
      );
      expect(Buffer.from(sessionMessage(challenge, d.riverId, 1)).toString('hex')).toBe(d.sessionMessage);
      expect(Buffer.from(deleteAccountMessage(challenge, d.riverId, 1)).toString('hex')).toBe(
        d.deleteAccountMessage,
      );
    });

    it('verifies the frozen signature and parses the list', () => {
      expect(verify(bytes(d.signerIdentityPublicKey), bytes(d.signedMessage), bytes(d.signature))).toBe(true);
      expect(parseDeviceList(listBytes).riverId).toBe(d.riverId);
    });

    it('rejects a changed list, a changed context and a signature for another purpose', () => {
      const changed = listBytes.slice();
      changed[10] = changed[10]! ^ 1;
      expect(verify(bytes(d.signerIdentityPublicKey), deviceListMessage(changed), bytes(d.signature))).toBe(
        false,
      );
      // The registration and session messages are different domains; the device-list signature must not fit them.
      expect(verify(bytes(d.signerIdentityPublicKey), bytes(d.registrationMessage), bytes(d.signature))).toBe(
        false,
      );
      expect(verify(bytes(d.signerIdentityPublicKey), bytes(d.sessionMessage), bytes(d.signature))).toBe(
        false,
      );
    });
  });
});
