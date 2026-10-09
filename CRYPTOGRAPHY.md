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

## 3. Identity (identity key: implemented in 0.0.4; device keys and device list: 0.1.0)

| Key              | Type                                                        | Scope                              | Purpose                                                                                                     |
| ---------------- | ----------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Identity key     | libsignal `IdentityKeyPair` (Curve25519, XEdDSA signatures) | Account (shared by linked devices) | Long-term identity; fingerprints; signs prekeys and the device list — **implemented 0.0.4**                 |
| Device auth key  | libsignal Curve25519 (XEdDSA)                               | Per device                         | Authenticates the device to the server (challenge–response). Never used for content — **implemented 0.1.0** |
| Signed prekey    | Curve25519                                                  | Per device, rotated ≤ 7 days       | PQXDH                                                                                                       |
| Kyber prekeys    | ML-KEM-1024 (libsignal)                                     | Per device                         | Post-quantum component of PQXDH                                                                             |
| One-time prekeys | Curve25519                                                  | Per device, batches of 100         | PQXDH                                                                                                       |
| Profile key      | 256-bit random                                              | Account                            | Encrypts profile fields; shared with contacts                                                               |
| Recovery secret  | 256-bit random, shown as 24 BIP-39 words                    | Account                            | Derives backup key and recovery auth key (HKDF-SHA256 with distinct `info` labels)                          |

**Signatures.** All River protocol signatures are libsignal XEdDSA over a
distinct ASCII context followed by the payload (`river-device-list-v1`,
`river-register-v1`, `river-session-v1`); see
[docs/protocol/accounts.md](docs/protocol/accounts.md). Using libsignal for
signing (instead of a separate Ed25519 library) keeps one reviewed
implementation on desktop, server, iOS and Android.

**Device list signing.** The account's device list
`{ accountId, version, devices: [{ deviceId, authKey, registrationId, addedAt }] }`
is signed by the identity key. Clients cache the highest version seen and reject
lists with lower versions, unknown signatures or devices they were not told
about. This prevents the server from silently adding an eavesdropping device.

**Fingerprints shown to users.**

- _Safety number_: libsignal `Fingerprint` (60 digits, 12 groups of 5),
  computed from both parties' identity keys and River IDs; QR code uses the
  libsignal scannable fingerprint format.
- _Identity fingerprint_: SHA-256 of the libsignal-serialised identity public
  key (33 bytes), first 16 bytes, shown as 8 groups of 4 hex characters
  (e.g. `AB73 29FA 91C2 77D4 …`).
- _Verification words_: the same 16 bytes as **Bytewords** (Blockchain Commons
  BCR-2020-012, BSD-2-Clause-Patent): one four-letter word per byte, unique by
  first and last letter, designed for reading aloud. The PGP word list was
  considered but not used because its copyright status is disputed.
- River ID: random UUIDv4 generated on the device. Registration ID: random 14-bit
  value (libsignal). The private key is stored only in the SQLCipher database
  and never crosses the main/renderer boundary (tested).

## 4. Messaging (1:1 implemented in 0.5.0; groups planned)

- 1:1 sessions (implemented, 0.5.0): libsignal PQXDH (X25519 + ML-KEM-1024
  prekeys) + Double Ratchet, one session per (local device, remote device)
  pair; each message is fanned out to every device of the recipient. Fan-out
  to the sender's own other devices arrives with multi-device linking.
  Prekey signatures are checked by the server and by libsignal; key bundles
  are checked against the identity-signed device list and, when known, the
  identity key sealed in a shared community profile. Identity keys are trusted
  on first use; changes are flagged, and block sending to verified contacts.
  Wire details: [docs/protocol/messaging.md](docs/protocol/messaging.md).
- Sealed sender (0.3.x): sender certificates issued by the server, signed with a
  server key whose public part is pinned per-server on first use.
- Groups: libsignal Sender Keys; distribution messages travel over 1:1
  sessions; membership change → new sender key.
- Content padding to fixed buckets before encryption to blur length.

### 4a. Communities today (implemented, 0.2.0 / 0.3.0)

Communities currently use **one shared 32-byte community key** (CSPRNG) rather
than per-member sender keys:

- Every human-readable value is sealed with AES-256-GCM under the community key
  (random 96-bit nonce) with associated data
  `river-community-v1|<communityId>|<purpose>`, where purpose is `meta`,
  `profile`, `channel:<id>`, `role:<id>`, `message:<channelId>`,
  `reaction:<messageId>` or `signal:<channelId>`. The AAD stops the server moving
  ciphertext between communities, channels or fields.
- The key travels only in the invite link's URL fragment (`#c=…&k=…`), which
  browsers and River never send to a server. Joining verifies the key opens the
  community metadata before it is stored.
- **Reactions**: the server groups identical reactions by a tag
  `HMAC-SHA256(HKDF-SHA256(communityKey, info="river-reaction-tag-v1|<communityId>"), messageId‖"|"‖emoji)`
  truncated to 128 bits; the emoji itself is sealed. Clients show a reaction
  only when its decrypted emoji reproduces its tag.
- **What the server learns** (needed to enforce permissions and relay): who is
  a member, channel kinds and order, role permission bits, **role colours**,
  role positions and who holds which role, channel permission overwrites,
  bans, message timing/size/sender, edit and pin state, reaction counts per tag,
  typing and online presence, voice participants and their mute/deafen/streaming
  flags. It never sees names, topics, profiles, avatars, message text or emoji.
- **Key epochs (0.6.0)**: when someone leaves or is removed, the server flags
  the community and the highest-ranked online member's client claims the next
  epoch with a compare-and-set, generates a fresh 32-byte key, seals its own
  profile with it and sends it to every remaining member inside libsignal
  messages. New content is sealed with the newest key; members keep older keys
  to read history (a value is opened with whichever key sealed it). A key is
  accepted only for an epoch the server has reached and only if it opens the
  sender's current profile. Members who missed a rotation, or joined with an
  older invite, request the key; members answer only people whose sealed
  profile opens with a genuine community key — so a fake member injected by
  the server, who never held an invite key, receives nothing. Invite links carry
  the epoch (`&e=`) and a check value sealed with their key.
- **Limits, stated plainly**: anyone who holds a valid invite link can join and
  read the community; rotation protects content created _after_ someone is
  removed, not what they could already read, and there is no per-message forward
  secrecy inside a community. Until the rotating member's message reaches
  everyone, a member may still seal a few messages with the previous key.
  Rotation needs members on 0.5.0+ (it travels over direct-message sessions).

## 5. Attachments and files (implemented, 0.4.0)

Signal attachment format (`packages/crypto/src/attachment.ts`): a fresh random
64-byte key per file (32 AES-256-CBC + 32 HMAC-SHA256), random IV, plaintext
zero-padded to a size bucket (≥ 541 bytes, then 5 % steps) to blur the size,
PKCS#7, encrypt-then-MAC over IV ‖ ciphertext, and the SHA-256 digest of the
blob. The pointer (blob ID, key, digest, true size, name, type, image
dimensions, a ≤ 3 KB blurred preview) travels only inside the end-to-end
encrypted message. Downloads check the digest and MAC in constant time before
decrypting. Blobs have random 128-bit IDs; the server learns their padded size,
uploader and which message they belong to, nothing else. Received files are
never opened automatically — only images, audio and video of a short allow-list
of types are shown inline; everything else is saved only when the user chooses.

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
