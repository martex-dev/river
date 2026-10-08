import { safeStorage } from 'electron';
import type { OsKeystore } from './key-file.ts';

/**
 * Electron safeStorage: Windows DPAPI, macOS Keychain, Linux Secret Service
 * (GNOME Keyring / KWallet). On Linux without a Secret Service Electron falls
 * back to a hard-coded password ("basic_text"), which is not real protection —
 * River treats that as "no keystore" and asks for a passphrase instead.
 */
export const electronKeystore: OsKeystore = {
  usable() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux') {
      const backend = safeStorage.getSelectedStorageBackend();
      return backend !== 'basic_text' && backend !== 'unknown';
    }
    return true;
  },
  name() {
    if (process.platform === 'win32') return 'Windows DPAPI';
    if (process.platform === 'darwin') return 'macOS Keychain';
    return `Secret Service (${safeStorage.getSelectedStorageBackend()})`;
  },
  wrap(plaintext) {
    return safeStorage.encryptString(plaintext.toString('base64'));
  },
  unwrap(wrapped) {
    return Buffer.from(safeStorage.decryptString(wrapped), 'base64');
  },
};
