import { PrivateKey, PublicKey } from '@signalapp/libsignal-client';

/**
 * Signatures for River protocol messages: libsignal Curve25519 keys with
 * XEdDSA (the scheme Signal uses for signed prekeys). One implementation for
 * desktop, server, iOS and Android.
 */
export interface KeyPair {
  /** 33-byte serialised public key. */
  publicKey: Uint8Array;
  /** 32-byte serialised private key. */
  privateKey: Uint8Array;
}

export function generateKeyPair(): KeyPair {
  const priv = PrivateKey.generate();
  return { publicKey: priv.getPublicKey().serialize(), privateKey: priv.serialize() };
}

export function sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  return PrivateKey.deserialize(new Uint8Array(privateKey)).sign(new Uint8Array(message));
}

/** Never throws: malformed keys or signatures simply fail verification. */
export function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    if (signature.length !== 64) return false;
    return PublicKey.deserialize(new Uint8Array(publicKey)).verify(
      new Uint8Array(message),
      new Uint8Array(signature),
    );
  } catch {
    return false;
  }
}

export function publicKeyOf(privateKey: Uint8Array): Uint8Array {
  return PrivateKey.deserialize(new Uint8Array(privateKey)).getPublicKey().serialize();
}
