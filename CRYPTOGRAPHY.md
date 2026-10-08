# River Cryptography

River uses **only established cryptographic primitives and protocols**, from
well-reviewed libraries. River does not define ciphers, hashes, MACs, key
exchanges or ratchets. Where River composes primitives (e.g. the release
manifest signature), the construction is documented here and kept as simple as
possible.

## 1. Libraries

| Library                                                                                                                           | Used for                                                                                                            | Platforms                                    |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [libsignal](https://github.com/signalapp/libsignal) (`@signalapp/libsignal-client`, `LibSignalClient` Swift, `libsignal-android`) | Identity keys, PQXDH session setup, Double Ratchet, Sender Keys, sealed sender, safety-number fingerprints          | Desktop, server (cert issuing), iOS, Android |
| Node.js / Electron `crypto` (OpenSSL / BoringSSL)                                                                                 | Ed25519 (release signatures, device auth), AES-256-GCM, AES-256-CBC + HMAC-SHA256, HKDF-SHA256, SHA-256/512, CSPRNG | Desktop, server                              |
| libsodium                                                                                                                         | Argon2id (passphrase-protected local key, backups) — Electron's BoringSSL has no Argon2                             | Desktop, mobile                              |
| SQLCipher                                                                                                                         | Encrypted local database (AES-256, HMAC-SHA512, PBKDF2 on a random key)                                             | Desktop, mobile                              |
| WebRTC (DTLS-SRTP) + insertable streams / SFrame-style frame encryption                                                           | Calls                                                                                                               | All                                          |

## 2. Release signing (implemented, 0.0.1)

- Algorithm: **Ed25519** (RFC 8032).
- Signed message: `"river-release-manifest-v1\n" || manifest_bytes`. The
  ASCII prefix is a domain-separation context so a release signature can never
  be confused with any other River signature.
- The manifest is JSON listing every release file with size, SHA-256 and SHA-512.
  The signature covers the _exact bytes_ of the file, so no JSON
  canonicalisation is needed; the verifier checks the signature before parsing.
- Signature file: `{ "algorithm": "ed25519", "keyId": "<first 16 hex of SHA-256(raw public key)>", "signature": "<base64>" }`.
- Clients ship a list of trusted public keys (`apps/desktop/src/main/updater/trusted-keys.ts`).
  Key rotation: a new key is added to the list in release N, used from release
  N+1; the old key is removed once supported upgrade paths no longer need it.

## 3. Identity (planned, 0.0.4 – 0.1.0)

| Key              | Type                                                        | Scope                              | Purpose                                                                             |
| ---------------- | ----------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| Identity key     | libsignal `IdentityKeyPair` (Curve25519, XEdDSA signatures) | Account (shared by linked devices) | Long-term identity; fingerprints; signs prekeys and the device list                 |
| Device auth key  | Ed25519                                                     | Per device                         | Authenticates the device to the server (challenge–response). Never used for content |
| Signed prekey    | Curve25519                                                  | Per device, rotated ≤ 7 days       | PQXDH                                                                               |
| Kyber prekeys    | ML-KEM-1024 (libsignal)                                     | Per device                         | Post-quantum component of PQXDH                                                     |
| One-time prekeys | Curve25519                                                  | Per device, batches of 100         | PQXDH                                                                               |
| Profile key      | 256-bit random                                              | Account                            | Encrypts profile fields; shared with contacts                                       |
| Recovery secret  | 256-bit random, shown as 24 BIP-39 words                    | Account                            | Derives backup key and recovery auth key (HKDF-SHA256 with distinct `info` labels)  |

**Device list signing.** The account's device list
`{ accountId, version, devices: [{ deviceId, authKey, registrationId, addedAt }] }`
is signed by the identity key. Clients cache the highest version seen and reject
lists with lower versions, unknown signatures or devices they were not told
about. This prevents the server from silently adding an eavesdropping device.

**Fingerprints shown to users.**

- _Safety number_: libsignal `Fingerprint` (60 digits, 12 groups of 5),
  computed from both parties' identity keys and River IDs; QR code uses the
  libsignal scannable fingerprint format.
- _Identity fingerprint_: SHA-256 of the identity public key, first 16 bytes,
  shown as 8 groups of 4 hex characters (e.g. `AB73 29FA 91C2 77D4 …`).
- _Verification words_: the same 16 bytes mapped through the PGP word list
  (even/odd byte lists) — an established, public-domain encoding designed for
  reading aloud.

## 4. Messaging (planned, 0.2.x – 0.4.x)

- 1:1 sessions: libsignal PQXDH + Double Ratchet, one session per
  (local device, remote device) pair; each message is fanned out to every
  device of the recipient and every other device of the sender.
- Sealed sender (0.3.x): sender certificates issued by the server, signed with a
  server key whose public part is pinned per-server on first use.
- Groups: libsignal Sender Keys; distribution messages travel over 1:1
  sessions; membership change → new sender key.
- Content padding to fixed buckets before encryption to blur length.

## 5. Attachments and files (planned, 0.5.x)

Signal attachment format: random 64-byte key (32 AES-256-CBC + 32 HMAC-SHA256),
random IV, PKCS#7, encrypt-then-MAC, SHA-256 digest of the ciphertext included
in the pointer message. Blobs are addressed by random IDs.

## 6. Local storage (implemented, 0.0.3)

- Database: SQLCipher 4 format (AES-256-CBC pages, HMAC-SHA512) via
  `better-sqlite3-multiple-ciphers`, opened with a **raw 32-byte random key**
  (`PRAGMA key = "x'…'"`, no password KDF since the key is already uniform).
  `secure_delete` is on.
- Key file `data/database.key`, one of:
  - `os-keystore`: the key wrapped by Electron `safeStorage` — Windows DPAPI,
    macOS Keychain, Linux Secret Service. On Linux, Electron's `basic_text`
    fallback (a hard-coded password) is **not** accepted as protection.
  - `passphrase`: KEK = Argon2id(passphrase NFKC, 16-byte random salt,
    64 MiB, 3 passes, 1 lane) via libsodium `crypto_pwhash`; the database key is
    sealed with AES-256-GCM (96-bit random nonce, AAD `river-db-key-v1`).
    A unit test checks libsodium's output equals OpenSSL's Argon2id.
- A damaged key file is never overwritten; a database without a key file is
  moved aside, not deleted.
- Planned: media cache encrypted with per-file AES-256-GCM keys stored in the DB.

## 7. Backups and recovery (planned, 0.1.4)

- No server master key exists. River cannot recover an account without the
  user's recovery phrase or another linked device.
- Encrypted backup = AES-256-GCM under `HKDF(recovery_secret, info="river-backup-v1")`.
- Device-to-device transfer (Stage 2) uses a libsignal session established by
  scanning a QR code.

## 8. Calls (planned, 0.8.x)

- 1:1: WebRTC DTLS-SRTP; DTLS fingerprints are exchanged inside E2EE signalling,
  binding the media channel to verified identities.
- Group: frame-level encryption (insertable streams) with per-call keys sent
  over River E2EE; the SFU cannot decrypt.

## 9. What River will never do

- Invent or modify a cipher, hash, MAC, KDF, signature scheme or key exchange.
- Keep a copy of users' private keys on the server, escrowed or otherwise.
- Use "military-grade" or similar marketing language.
