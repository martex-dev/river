# River Cryptography

River uses **only established cryptographic primitives and protocols**, from
well-reviewed libraries. River does not define ciphers, hashes, MACs, key
exchanges or ratchets. Where River composes primitives (e.g. the release
manifest signature), the construction is documented here and kept as simple as
possible.

## 1. Libraries

| Library                                                                                                                           | Used for                                                                                                                  | Platforms                                    |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [libsignal](https://github.com/signalapp/libsignal) (`@signalapp/libsignal-client`, `LibSignalClient` Swift, `libsignal-android`) | Identity keys, PQXDH session setup, Double Ratchet, safety-number fingerprints (Sender Keys, sealed sender: not used yet) | Desktop, server (cert issuing), iOS, Android |
| Node.js / Electron `crypto` (OpenSSL / BoringSSL)                                                                                 | Ed25519 (release signatures, device auth), AES-256-GCM, AES-256-CBC + HMAC-SHA256, HKDF-SHA256, SHA-256/512, CSPRNG       | Desktop, server                              |
| libsodium                                                                                                                         | Argon2id (passphrase-protected local key, backups) — Electron's BoringSSL has no Argon2                                   | Desktop, mobile                              |
| SQLCipher                                                                                                                         | Encrypted local database (AES-256, HMAC-SHA512, PBKDF2 on a random key)                                                   | Desktop, mobile                              |
| WebRTC (DTLS-SRTP) + insertable streams / SFrame-style frame encryption                                                           | Calls                                                                                                                     | All                                          |

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

| Key              | Type                                                          | Scope                              | Purpose                                                                                                     |
| ---------------- | ------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Identity key     | libsignal `IdentityKeyPair` (Curve25519, XEdDSA signatures)   | Account (shared by linked devices) | Long-term identity; fingerprints; signs prekeys and the device list — **implemented 0.0.4**                 |
| Device auth key  | libsignal Curve25519 (XEdDSA)                                 | Per device                         | Authenticates the device to the server (challenge–response). Never used for content — **implemented 0.1.0** |
| Signed prekey    | Curve25519                                                    | Per device, rotated ≤ 7 days       | PQXDH                                                                                                       |
| Kyber prekeys    | ML-KEM-1024 (libsignal)                                       | Per device                         | Post-quantum component of PQXDH                                                                             |
| One-time prekeys | Curve25519                                                    | Per device, batches of 100         | PQXDH                                                                                                       |
| Profile key      | 256-bit random                                                | Account                            | Encrypts profile fields; shared with contacts                                                               |
| Recovery secret  | 128-bit random, shown as 16 Bytewords + 2 checksum words (§7) | Account                            | Derives the backup key (HKDF-SHA256, `info` label `river-backup-v1`)                                        |

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

## 4. Messaging (1:1 implemented in 0.5.0; groups in 0.6.0, pairwise)

- 1:1 sessions (implemented, 0.5.0): libsignal PQXDH (X25519 + ML-KEM-1024
  prekeys) + Double Ratchet, one session per (local device, remote device)
  pair; each message is fanned out to every device of the recipient. Fan-out
  to the sender's own other devices arrives with multi-device linking.
  Prekey signatures are checked by the server and by libsignal; key bundles
  are checked against the identity-signed device list and, when known, the
  identity key sealed in a shared community profile. Identity keys are trusted
  on first use; changes are flagged, and block sending to verified contacts
  (see §4b for how a change on an incoming message is checked).
  Wire details: [docs/protocol/messaging.md](docs/protocol/messaging.md).
- **Sealed sender is not implemented.** The server sees which account sends a
  direct message to which (THREAT_MODEL.md §5). libsignal's sealed sender
  (server-issued sender certificates) remains planned.
- Groups (implemented, 0.6.0): **pairwise** — each group message is encrypted
  separately under the 1:1 libsignal session with every other member (fine for
  the 32-person limit), so a removed member simply stops being encrypted to and
  every message keeps Double Ratchet forward secrecy. libsignal Sender Keys
  (one ciphertext per message, distribution over 1:1 sessions, new key on every
  membership change) remain a later optimisation for larger groups. Wire
  details: [docs/protocol/messaging.md](docs/protocol/messaging.md#groups).
- Content padding to fixed buckets before encryption to blur length.

### 4a. Communities today (implemented, 0.2.0 / 0.3.0)

Communities currently use **one shared 32-byte community key** (CSPRNG) rather
than per-member sender keys:

- Every human-readable value is sealed with AES-256-GCM under the community key
  (random 96-bit nonce) with associated data
  `river-community-v1|<communityId>|<purpose>`, where purpose is `meta`,
  `profile`, `channel:<id>`, `category:<id>`, `role:<id>`, `message:<channelId>`,
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
  profile with it and sends it inside libsignal messages to the remaining
  members whose sealed profile opens with a key it held before (2.11; a member
  the server lists without ever holding a key gets nothing). Since 2.11 the
  key travels with a **proof**: the new key sealed (AES-256-GCM, purpose
  `epoch:<n>`) under the key of the epoch before it. New content is sealed with
  the newest key; members keep older keys to read history (a value is opened
  with whichever key sealed it). A key is accepted only for an epoch the server
  has reached and only with a proof sealed under the newest key the receiver
  holds below that epoch — so only someone who held that genuine key can hand
  out the next one (keys without a proof: see §4b). Members who missed a
  rotation, or joined with an older invite, request the key and say which epoch
  they hold; members answer only people whose sealed profile opens with a
  genuine community key and names an identity key, with every missing key in
  order, each sealed under the one before. Invite links carry the epoch (`&e=`)
  and a check value sealed with their key.
- **A rotation that reaches nobody (2.11)**: the server remembers when and by
  whom an epoch was claimed until another member reports having its key. If
  nobody does within ten minutes it asks for a rotation again (at most three
  times). A member still missing the key after asking for it replaces it from
  the newest key it holds. Meanwhile the app says so: "Securing this community
  after a member left… messages here are still protected with the previous
  key". Pending members (rules not accepted) are never picked to rotate; a
  refused claim lets the next candidate take over.
- **Limits, stated plainly**: anyone who holds a valid invite link can join and
  read the community; rotation protects content created _after_ someone is
  removed, not what they could already read, and there is no per-message forward
  secrecy inside a community. Until the rotating member's message reaches
  everyone, a member may still seal a few messages with the previous key.
  Rotation needs members on 0.5.0+ (it travels over direct-message sessions).
  The server decides who is a member: a member who was removed but whom the
  server keeps listing still receives the next key from the rotator and can
  produce a valid proof for the epoch right after the one they held. Membership
  signed by the community's managers would be needed to close that.
- **Associated data v2 (2.11, receiving only for now)**: messages may be sealed
  with `river-community-v2|<communityId>|message:<channelId>|<messageId>|<senderRiverId>`
  and profiles with `river-community-v2|<communityId>|profile|<riverId>`, which
  stops the server re-attributing a message to another sender, replaying it
  under a new ID, or giving one member's profile to another. Receivers open v2
  first, then v1. Senders keep sealing v1 until every supported River opens v2
  (`SEAL_V2_DEFAULT` in `sealed.ts`; see §4b). Values sealed v1 stay readable
  forever and keep v1's weaker binding. An edit of a v2 message stays v2; the
  server can still show an earlier version of the same message (edits are not
  ordered cryptographically).

## 4b. Trust checks against the server (2.11) and the compatibility plan

The server routes everything, so it is treated as an adversary (THREAT_MODEL
A3) wherever a check is possible without new primitives:

- **Changed identity keys on incoming messages.** A PreKey message under a key
  other than the one stored for that contact is accepted only if the server's
  current bundle for them carries that same key, their device list is signed by
  it and lists the sending device with the registration ID the message claims,
  and no shared community profile names a different key. Otherwise the message
  is dropped and the stored key stays. Verification is never cleared silently:
  the verified key itself is recorded, so a contact whose key changed after
  verification shows "changed since verified" and gets nothing until the user
  compares the new safety number (marking needs the number that was shown).
  Without verification and without a shared community a server can still
  substitute a key — trust on first use cannot prevent that — but the change
  is shown.
- **Copies from this account's own devices** (sent messages, edits, the friends
  list, groups) are accepted only from another device in the account's
  identity-signed device list, and libsignal accepts only the account's own
  identity key for them.
- **Device lists** of contacts are fetched and verified again at least daily,
  and sooner when a message comes from a device the cached list lacks. Newest
  seen versions (per identity key) are included in backups.
- **Call signals**: replays refused (§8). **Attachments**: the in-memory cache
  is keyed by blob ID, digest and key.
- **Usernames and deleted accounts** (server): a username someone gave up stays
  theirs to take back for 30 days; a deleted account leaves a tombstone (River
  ID, identity key) so its River ID can be registered again only with the same
  key.

**Mixed versions.** Desktop, Android and iPhone update at different times, so
every change is readable by the previous releases and accepts what they send:

| Change                   | 2.11 sends                                                                 | 2.11 accepts                                                                                                                                                                                                                                                      | Later release                                                                  |
| ------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Community key proof      | `ckey` with `wrap`/`prev` (ignored by older Rivers); `ckeyReq` with `have` | proven keys; unproven keys (older Rivers) only from a member whose sealed profile opened with a key held before, naming the identity key that member's messages use, and only if the sender's current profile opens with the offered key (`ACCEPT_UNPROVEN_KEYS`) | **2.13**: stop accepting unproven keys (`ACCEPT_UNPROVEN_KEYS = false`)        |
| Associated data v2       | v1 (`SEAL_V2_DEFAULT = false`)                                             | v2 and v1                                                                                                                                                                                                                                                         | **2.12**: send v2 (`SEAL_V2_DEFAULT = true`); v1 stays readable for old values |
| Rotation adoption report | `POST …/epoch/adopted` (older servers: ignored)                            | —                                                                                                                                                                                                                                                                 | none                                                                           |
| Verification marks       | the verified key (33 bytes)                                                | the verified key, and the one-byte mark of older versions (treated as "the stored key was verified")                                                                                                                                                              | none                                                                           |

What stays possible during the transition: a member who held a genuine key at
some point (including someone removed whom the server keeps listing) can, with
the server, hand an unproven key to others until 2.13; v1-sealed messages and
profiles can still be re-attributed or swapped until senders switch to v2 (and,
for values sealed v1 before then, afterwards too).

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

## 7. Backups and recovery (implemented, 0.8.0)

- No server master key exists. River cannot recover an account without the
  user's recovery phrase and a backup file.
- Recovery secret: 16 random bytes, shown as 16 Bytewords + 2 checksum words
  (first two bytes of its SHA-256).
- Encrypted backup = `"RIVERBK1"` ‖ nonce ‖ AES-256-GCM(gzip(JSON)) under
  `HKDF-SHA256(recovery_secret, info="river-backup-v1")`, with the magic as
  associated data. It contains identity and device keys, account, community
  keys (all epochs), contacts' identity keys and verification marks, groups,
  message history and posts — not libsignal sessions or prekeys, which are
  regenerated after a restore (contacts get a fresh session automatically).
- Device-to-device transfer (Stage 2) uses a libsignal session established by
  scanning a QR code.

## 8. Calls (implemented: mesh 0.2.0, resilience 1.0.16, relay 1.0.17)

- Media goes directly between participants (WebRTC mesh, DTLS-SRTP). Call
  setup (SDP with DTLS fingerprints, ICE candidates) travels as sealed signals:
  in communities sealed with the community key, in direct calls inside
  libsignal messages. The server relays signals but cannot read them.
- **Server relay (1.0.17).** When two members cannot connect directly (strict
  NAT, blocked UDP, no TURN server), their apps send voice through the River
  server over the existing WebSocket. Audio is Opus-encoded and each frame is
  sealed with AES-256-GCM under a random per-call **sender key**; the frame is
  `[4-byte sequence][12-byte random IV][ciphertext+tag]` with the sender's River
  ID and the sequence as associated data, and receivers accept each sequence
  once, in order. Sender keys are given only to the people relayed with, inside
  sealed signals. The server forwards frames only between members of the same
  voice channel, caps size and rate, and never stores them. It cannot decrypt,
  alter, reorder or replay frames; it sees who relays to whom, when, and frame
  sizes. While a person is muted, their app sends one sealed frame of
  silence about once a second (2.11.3), so the other side knows they are still
  there; the server could already tell muted from talking by the frame rate.
  Camera and screen sharing still need a direct connection.
- **Identity-bound call setup.** Every community call signal is also signed
  with the sender's identity key (XEdDSA) over
  `"river-call-signal-v1" ‖ community ‖ channel ‖ sender ‖ recipient ‖ time ‖ payload`.
  For people River already holds an identity key for in libsignal (anyone you
  have exchanged direct messages with — the key your safety numbers verify),
  a valid signature no older than ten minutes is required: a server colluding
  with a member who holds the community key can no longer forge call setup from
  them, and stripping the signature is refused. Replays inside the ten minutes
  are refused too since 2.11: each accepted signature is remembered (in memory)
  until it would be stale anyway; a restarted app does not remember earlier
  ones. While that person's key is a change the user has not looked at yet (or
  it replaced a key they verified), their signals are refused. For people River
  has no libsignal key for yet, call setup rests on the community key alone,
  as before; River does not use the identity key in a community profile for
  this, because a profile is not bound to the person it describes.

## 9. What River will never do

- Invent or modify a cipher, hash, MAC, KDF, signature scheme or key exchange.
- Keep a copy of users' private keys on the server, escrowed or otherwise.
- Use "military-grade" or similar marketing language.
