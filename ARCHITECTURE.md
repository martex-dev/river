# River Architecture

> Status: living document. Sections marked **(planned)** describe the design that
> upcoming milestones implement; everything else describes code that exists today.
> See [STATUS.md](STATUS.md) for what is actually built.

## 1. Executive summary

River is one application — not six glued together — that combines private
messaging, large groups and channels, communities with roles, a social layer
(profiles, posts, stories), encrypted files, voice/video calls and, in Stage 2,
consent-based remote assistance.

Three rules shape every decision:

1. **The server is untrusted for content.** It routes, stores and rate-limits
   ciphertext. It never holds private keys and cannot read messages, media,
   files, posts shared to private audiences, or call media.
2. **Established cryptography only.** River uses libsignal (X3DH/PQXDH, Double
   Ratchet, Sender Keys, sealed sender), Ed25519, AES-256, HKDF, Argon2id and
   WebRTC/SRTP. River designs _application_ structure around them and never
   invents primitives or key-exchange protocols.
3. **Local-first.** Search, thumbnails, drafts, media organization and
   encryption happen on the device. The server never receives plaintext merely
   to offer convenience.

```
┌──────────────────────────── River client (desktop / mobile) ────────────────────────────┐
│  UI (React renderer / SwiftUI / Compose)                                                │
│     │  typed, validated IPC — UI never sees private keys                                │
│  Core (Electron main / native core)                                                     │
│     ├─ Identity & devices   ├─ libsignal sessions   ├─ Encrypted local DB (SQLCipher)   │
│     ├─ Sync engine          ├─ Attachment crypto    ├─ Local search index               │
│     └─ Updater (signed)     └─ WebRTC calls         └─ Remote-assist host (Stage 2)     │
└──────────────┬───────────────────────────────────────────────┬──────────────────────────┘
               │ HTTPS + WSS (TLS 1.3)                         │ DTLS-SRTP / TURN
┌──────────────▼───────────────────────┐          ┌────────────▼────────────┐
│ River server (Fastify + ws)          │          │ TURN (coturn) / SFU     │
│  accounts · device registry · prekeys│          │ (LiveKit, E2EE frames)  │
│  ciphertext mailbox · community ACLs │          └─────────────────────────┘
│  blob store (encrypted attachments)  │
│  DB: SQLite (single node) / Postgres │
└──────────────────────────────────────┘
```

## 2. Technology evaluation and choices

| Area             | Options evaluated                                                       | Choice                                                                                                                 | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop shell    | Electron, Tauri, Qt, Flutter desktop                                    | **Electron + React + TypeScript**                                                                                      | Bundled Chromium gives WebRTC, screen capture and identical rendering on all three OSes; first-class native modules (libsignal, SQLCipher); mature auto-update (`electron-updater`) and packaging (`electron-builder`) for NSIS/DMG/AppImage/deb/rpm. Tauri is lighter but relies on three different system webviews (WebRTC and screen-capture behaviour diverges, notably WebKitGTK) and its Rust toolchain would split the codebase. We pay the memory cost knowingly and mitigate with strict process hardening. |
| Messaging crypto | libsignal, Olm/Megolm (vodozemac), MLS (OpenMLS), custom Double Ratchet | **libsignal** (official Signal library, AGPL-3.0)                                                                      | Most-reviewed implementation of PQXDH + Double Ratchet + Sender Keys + sealed sender. Official bindings for **Node, Swift and Java/Kotlin** — exactly River's three client platforms. MLS (RFC 9420) is tracked for very large communities (§9).                                                                                                                                                                                                                                                                     |
| Other crypto     | libsodium, @noble/*, Node `crypto`/WebCrypto                            | **Node `crypto` / platform crypto** for Ed25519, AES-GCM, HKDF, SHA-2; **Argon2id** (via libsodium) for passphrase KDF | Uses OpenSSL/BoringSSL already shipped with Node/Electron; no extra native dependency.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Local database   | SQLite, SQLCipher, LevelDB, IndexedDB                                   | **SQLCipher** via `better-sqlite3-multiple-ciphers`                                                                    | Full-database encryption, synchronous and fast, SQL migrations, FTS5 full-text search for local message search. Database key wrapped by OS keystore (DPAPI / Keychain / libsecret) through Electron `safeStorage`.                                                                                                                                                                                                                                                                                                   |
| Backend language | Rust, Go, Elixir, TypeScript                                            | **TypeScript (Node 24) + Fastify**                                                                                     | Shares protocol schemas and validation with the desktop client, one language for contributors, strong ecosystem. Hot paths are I/O-bound (routing ciphertext). If profiling shows otherwise, the mailbox service can be split out later behind the same protocol.                                                                                                                                                                                                                                                    |
| Server database  | PostgreSQL, SQLite, MongoDB                                             | **Kysely** query builder over **SQLite** (default, single-node self-hosting) and **PostgreSQL** (scale)                | One codebase, typed queries, real migrations, two deployment sizes.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Realtime         | WebSocket, gRPC streaming, MQTT, SSE                                    | **WebSocket (WSS)**                                                                                                    | Works through proxies, available on all client platforms, simple framing.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Wire format      | JSON, Protobuf, CBOR                                                    | **JSON (validated with zod)** for the outer API; **Protobuf** for encrypted message _content_                          | Outer API stays debuggable; inner content needs compact, versioned, cross-language schemas (Swift/Kotlin codegen in Stage 2).                                                                                                                                                                                                                                                                                                                                                                                        |
| Voice/video      | WebRTC, custom RTP                                                      | **WebRTC** (DTLS-SRTP); **coturn** for TURN; **LiveKit** SFU with insertable-streams E2EE for group calls              | Industry standard; no homemade media encryption.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Mobile           | React Native, Flutter, Kotlin Multiplatform, native                     | **Native: SwiftUI (iOS) + Jetpack Compose (Android)**                                                                  | Best access to Keychain/Secure Enclave, Keystore, CallKit/ConnectionService, background execution and push; libsignal has official Swift and Java bindings. Shared logic lives in the protocol spec + test vectors, not in a shared runtime.                                                                                                                                                                                                                                                                         |
| Auto-update      | electron-updater, Squirrel, custom                                      | **electron-updater (GitHub provider) + River Ed25519 release signatures**                                              | Handles differential download and per-OS installation; River adds an independent signature check so a compromised release page alone cannot push code.                                                                                                                                                                                                                                                                                                                                                               |
| Packaging        | electron-builder, Electron Forge                                        | **electron-builder**                                                                                                   | NSIS, DMG+ZIP, AppImage, deb, rpm and update metadata from one config.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| CI/CD            | GitHub Actions, others                                                  | **GitHub Actions**                                                                                                     | The repository lives on GitHub; free for public repositories; native release integration.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Monorepo tooling | npm workspaces, pnpm, Nx, Turborepo                                     | **npm workspaces**                                                                                                     | Zero extra tooling for contributors; enough for this size.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## 3. Repository structure

```
river/
├─ apps/
│  ├─ desktop/            Electron app (main / preload / renderer)
│  ├─ server/             River server (Fastify, ws, Kysely)          (0.0.2)
│  ├─ ios/                Native iOS client                            (Stage 2)
│  └─ android/            Native Android client                        (Stage 2)
├─ packages/
│  ├─ release/            Release-manifest format, Ed25519 sign/verify
│  ├─ protocol/           API + realtime schemas, protocol version     (0.0.2)
│  ├─ crypto/             libsignal wrappers, fingerprints, KDFs       (0.0.4)
│  └─ shared/             Small shared utilities
├─ docs/                  architecture/ security/ protocol/ desktop/ mobile/
│                         backend/ deployment/ contributing/
├─ scripts/               release + maintenance scripts
├─ tests/                 cross-package and end-to-end suites
└─ .github/workflows/     ci, codeql, release
```

## 4. Client architecture (desktop)

Electron runs three kinds of process; River treats them as separate trust zones.

| Process      | Privileges                          | Holds                                                                   |
| ------------ | ----------------------------------- | ----------------------------------------------------------------------- |
| **Main**     | Node.js, filesystem, native modules | Private keys, libsignal stores, SQLCipher DB, network sessions, updater |
| **Preload**  | Bridge only (`contextBridge`)       | A narrow, typed API (`window.river`)                                    |
| **Renderer** | Sandboxed Chromium, no Node         | UI state, decrypted content _for display only_                          |

Hardening (implemented in 0.0.1): `contextIsolation`, `sandbox`, no
`nodeIntegration`, strict Content-Security-Policy, all navigation and
`window.open` blocked, permission requests denied by default (calls will grant
camera/mic per-request), every IPC payload validated with zod in main.

Renderer stack: React 19, Zustand for state, hand-written CSS design tokens
(the River design language, see [docs/desktop/design-language.md](docs/desktop/design-language.md)).

## 5. Server architecture (planned, 0.0.2+)

Single deployable Node service with modules:

- **accounts** — River ID, username, signed device list, auth challenges.
- **keys** — signed prekeys, one-time prekeys, Kyber prekeys per device.
- **mailbox** — per-device queues of opaque envelopes; deleted on acknowledgement
  or after a retention limit (default 30 days).
- **groups/communities** — membership and role ACLs needed to route and to
  enforce "who may post". Channel _content_ is end-to-end encrypted.
- **blobs** — encrypted attachments by random ID; the server never sees keys.
- **realtime** — authenticated WebSocket per device for push of envelopes,
  typing/receipts (themselves E2EE payloads), presence (opt-in).

Logs contain no message metadata beyond what is needed to operate (see
[PRIVACY.md](PRIVACY.md)); IP addresses are not persisted by River.

## 6. Protocol overview (planned)

- Transport: TLS 1.3 HTTPS + WSS. Clients pin nothing by default (operators may
  self-host), but every _content_ guarantee comes from E2EE, not TLS.
- Envelope: `{ to: deviceAddress, type, ciphertext, serverTimestamp }`;
  `ciphertext` is a libsignal message (sealed sender once 0.3.x lands).
- Content: protobuf `Content { dataMessage | receipt | typing | sync | call }`.
- Protocol versioning: `X-River-Protocol` header and a `/v1/version` endpoint;
  clients refuse to talk to servers below their minimum protocol version.

Detailed spec: [docs/protocol/](docs/protocol/README.md).

## 7. Identity and devices

See [CRYPTOGRAPHY.md](CRYPTOGRAPHY.md) §3. Summary:

- **River ID** — random 128-bit identifier (UUID) chosen at registration.
- **Username** — optional, unique, changeable handle (`@river_name`).
- **Account identity key** — libsignal Curve25519 key pair, generated on the
  first device, shared with linked devices over an encrypted provisioning
  channel. Its fingerprint is what contacts verify.
- **Device** — each device has a device ID, its own prekeys and its own
  Ed25519 _device authentication key_. The account's device list is **signed by
  the identity key**, so the server cannot silently add a device to someone's
  account.
- No phone number, e-mail or real name is required.

## 8. Data model and databases

**Server (planned):** `accounts`, `devices`, `device_list_versions`,
`prekeys`, `kyber_prekeys`, `signed_prekeys`, `envelopes`, `blobs`,
`groups`, `group_members`, `communities`, `channels`, `roles`,
`role_assignments`, `invites`, `bans`, `auth_sessions`. No message plaintext,
no contact lists, no social graph beyond what routing/ACLs need (community
membership is necessarily visible to the server; 1:1 contacts are not).

**Client (planned, 0.0.3):** SQLCipher database with `identity`, `sessions`,
`prekeys`, `sender_keys`, `conversations`, `messages`, `attachments`,
`contacts`, `profiles`, `settings`, plus an FTS5 index for local search.

**Migrations** — both sides use forward-only numbered migrations recorded in a
`schema_migrations` table. The client copies the database file before any
migration marked destructive and restores it on failure. Upgrade paths
0.0.1 → latest are exercised in CI with fixture databases from older versions.

## 9. Groups, channels and communities (planned)

- **Small/medium groups (≤ 1000)** — libsignal Sender Keys. Each member
  distributes a sender key to every member device over pairwise sessions;
  removal triggers rotation.
- **Communities** — a community is a set of channels plus roles/permissions.
  Private channels are encrypted with per-channel sender keys distributed to
  members allowed to read. The server enforces roles for _routing and posting_
  (it must know membership to deliver) but cannot read content.
- **Broadcast channels / very large audiences** — encrypted with a channel key
  distributed to subscribers. For public channels anyone can join, encryption
  protects content from the _server operator_, not from the public; River says
  so in the UI.
- **MLS (RFC 9420)** is being evaluated for 1.x to make key updates in very
  large communities efficient.

## 10. Media, files and calls (planned)

- **Attachments** — encrypted client-side (AES-256-CBC + HMAC-SHA256,
  encrypt-then-MAC, Signal attachment format), uploaded as opaque blobs; key
  and digest travel inside the E2EE message. Thumbnails are generated locally.
- **River Files** — the personal vault stores file metadata in the local DB and
  encrypted blobs on the server; folder structure is itself encrypted.
- **Calls** — WebRTC. 1:1: peer-to-peer DTLS-SRTP, TURN fallback, signalling
  via E2EE messages, call fingerprints bound to the identity keys. Group: LiveKit
  SFU with insertable-streams frame encryption; keys distributed over River
  E2EE, so the SFU forwards frames it cannot decrypt.

## 11. Remote assistance (Stage 2, planned)

Built on the same WebRTC stack. Consent model is enforced in the _host's_ client:

1. Host explicitly accepts each session (or shares a one-time code, valid 10 min,
   single use).
2. Host chooses permissions: view only / control / clipboard / file transfer.
3. A topmost, non-dismissable **REMOTE SESSION ACTIVE** banner shows who is
   connected, plus a one-click **End session** and a global hotkey.
4. Input injection only while the session is active and the permission granted;
   no background service, no persistence, no unattended access, no ability to
   bypass OS prompts (macOS Accessibility/Screen Recording permissions are
   requested visibly).
5. Every session is logged locally in the host's session history.

## 12. Update architecture (implemented in 0.0.1)

```
GitHub Release vX.Y.Z
 ├─ installers (.exe / .dmg+.zip / .AppImage / .deb / .rpm)
 ├─ latest.yml / latest-mac.yml / latest-linux.yml  (electron-builder update metadata)
 ├─ SHA256SUMS
 ├─ river-release-manifest.json             (all files + sha256/sha512)
 └─ river-release-manifest.json.sig         (Ed25519, key pinned in the app)
```

1. `electron-updater` checks GitHub for the user's channel
   (stable → latest non-prerelease; beta → newest `-beta.N` or stable;
   nightly → newest `-alpha.N`, beta or stable).
2. Only versions strictly newer than the running version are accepted.
3. The installer is downloaded (differentially where possible) and checked
   against the electron-builder SHA-512.
4. **River's own check:** the client downloads the signed manifest for that exact
   version, verifies the Ed25519 signature against keys compiled into the app,
   checks the version matches, and checks the downloaded file's SHA-512 is listed.
5. Only then is the installer allowed to run (on restart or on user request).
   Any failure leaves the current version untouched and is shown in Settings →
   Updates.

Platform notes: Windows (NSIS) and Linux (AppImage/deb/rpm) install
automatically. macOS automatic installation requires an Apple Developer ID
signature, which the project does not yet have; until then macOS builds are
ad-hoc signed and the app notifies and opens the download instead of
installing silently. See [docs/deployment/updates.md](docs/deployment/updates.md).

## 13. Mobile architecture (Stage 2, planned)

- iOS: SwiftUI app + Notification Service Extension (decrypts push payload
  locally); libsignal-swift; Keychain with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`;
  Secure Enclave wraps the database key; Face ID/Touch ID app lock; CallKit.
- Android: Jetpack Compose; libsignal-android; Android Keystore (StrongBox when
  present) wraps the DB key; BiometricPrompt; FCM _and_ UnifiedPush; foreground
  service for calls only; ConnectionService.
- Pushes carry **no content** — only a wake-up hint; the app fetches and decrypts.
- Both clients implement the same protocol and pass the shared test vectors in
  `packages/protocol/test-vectors`.

## 14. GitHub and CI architecture

| Workflow      | Trigger          | Does                                                                                                                                                            |
| ------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`      | push, PR         | install, lint, typecheck, unit tests, build, Electron end-to-end smoke test, production dependency audit                                                        |
| `codeql.yml`  | push, PR, weekly | CodeQL static analysis                                                                                                                                          |
| `release.yml` | tag `v*`         | verify tag = version, test, build on Windows/macOS/Linux, SHA256SUMS, CycloneDX SBOM, sign manifest, publish GitHub Release (prerelease for `-beta`/`-nightly`) |
| Dependabot    | weekly           | npm and Actions updates                                                                                                                                         |

Third-party Actions are pinned to commit SHAs.
