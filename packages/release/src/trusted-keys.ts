import type { TrustedKey } from './manifest.ts';

/**
 * Ed25519 public keys allowed to sign River releases. Compiled into every
 * client; an update is installed only if its manifest verifies against one of
 * these. See CRYPTOGRAPHY.md §2 for the rotation procedure.
 */
export const TRUSTED_RELEASE_KEYS: readonly TrustedKey[] = [
  {
    keyId: '626db4cbb389fc32',
    publicKey: 'awJFLU+WqTOuAKBUmoE51xHQj+jxQUsK5X+gebtIfzw=',
    comment: 'River release key #1, introduced in 0.0.1',
  },
];
