import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BackupError,
  generateRecoverySecret,
  openBackup,
  parseRecoveryPhrase,
  recoveryPhrase,
  sealBackup,
} from '../src/backup.ts';

describe('recovery phrase and backups', () => {
  it('turns a secret into 18 words and back, forgiving case and spacing', () => {
    const secret = generateRecoverySecret();
    const words = recoveryPhrase(secret);
    expect(words).toHaveLength(18);
    const messy = `  ${words.join('  ').toUpperCase()}\n`;
    expect(Buffer.from(parseRecoveryPhrase(messy))).toEqual(Buffer.from(secret));
  });

  it('catches wrong, missing, swapped and unknown words', () => {
    const words = recoveryPhrase(generateRecoverySecret());
    expect(() => parseRecoveryPhrase(words.slice(0, 17).join(' '))).toThrow(/18 words/);
    expect(() => parseRecoveryPhrase([...words.slice(0, 17), 'banana'].join(' '))).toThrow(
      /not a recovery word/,
    );
    const swapped = [...words];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    if (swapped[0] !== words[0]) expect(() => parseRecoveryPhrase(swapped.join(' '))).toThrow(BackupError);
  });

  it('seals data that only the right phrase opens, and detects tampering', () => {
    const secret = generateRecoverySecret();
    const data = {
      identity: { name: 'Alice' },
      messages: Array.from({ length: 50 }, (_, i) => `message ${i}`),
    };
    const file = sealBackup(secret, data);
    expect(Buffer.from(file).toString('latin1')).not.toContain('Alice');
    expect(openBackup(secret, file)).toEqual(data);
    expect(() => openBackup(generateRecoverySecret(), file)).toThrow(/does not open/);
    const bad = Buffer.from(file);
    bad[bad.length - 20]! ^= 1;
    expect(() => openBackup(secret, bad)).toThrow(BackupError);
    expect(() => openBackup(secret, randomBytes(100))).toThrow(/not a River backup/);
  });
});
