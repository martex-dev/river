# Changelog

All notable changes to River are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and River uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

**Roles, permissions, moderation and a full community experience.**

### Added

- **Roles and permissions**: an @everyone role plus custom roles with names,
  colours and ordering; 18 permissions (view, send, react, mention @everyone,
  manage messages, pin, connect, speak, video & screen share, mute and move
  members, manage channels/roles/community, kick, ban, invites, administrator).
  The server enforces every permission and the role hierarchy (you can only
  manage roles and members below your highest role; nobody can act on the owner).
- **Private and read-only channels** through per-channel permission overrides
  (allow / inherit / deny per role).
- **Moderation**: kick, ban and unban (banned people cannot rejoin), server
  mute and disconnect in voice, leave community, delete community (owner).
- **Community settings**: overview (name, description), roles editor, member
  management with role assignment, ban list. **Channel settings**: rename,
  topic, order, delete, permissions. Create text or voice channels, optionally private.
- **Messages**: edit (Up arrow edits your last message), delete, reply,
  pin and a pinned-messages panel, emoji reactions (the server sees only an
  HMAC tag, never the emoji), @mentions with autocomplete and highlighting,
  simple formatting (bold, italic, underline, strike, code, quotes), date
  dividers, typing indicators, jump to present.
- **Presence and unread**: online/offline member list grouped by role,
  unread and mention badges on channels and communities.
- **Desktop notifications** for messages or only mentions while River is in the
  background; what they reveal follows Settings → Notifications (default: nothing private).
- **Voice**: click a channel to join; mute, deafen, push to talk (while River
  is focused), Ctrl+Shift+M / Ctrl+Shift+D, speaking indicators, LIVE badges,
  per-person volume, input/output device selection, noise suppression and echo
  cancellation toggles, microphone test, click a tile to spotlight it. The call
  keeps playing while you read text channels.
- **Profile**: display name and avatar (cropped and resized on your device,
  encrypted per community).
- Original synthesised **sound effects** (messages, mentions, join/leave,
  mute/deafen, streaming) and interface **animations**; both respect
  Settings (sounds toggle, reduced motion).

### Changed

- Members may create invite links by default (the owner can turn this off for
  @everyone). Non-members asking about a community now get "not found".
- Leaving or being removed from a community deletes its key from this device.

### Security

- New realtime events and fields are optional, so 0.2.x apps keep working
  against an upgraded server while they auto-update.

## [0.2.2] - 2026-10-09

### Fixed

- **Copy link** for community invites now copies to the clipboard. River's
  permission lock-down had blocked clipboard writes; it now allows writing
  (never reading) the clipboard for River's own interface.

## [0.2.1] - 2026-10-09

### Fixed

- The screen-share picker explains when no screen or window can be captured
  (for example Linux on Wayland without PipeWire) instead of showing an empty list.

## [0.2.0] - 2026-10-09

**Communities.** Create a private community, invite people with a link, chat in
text channels and meet in voice channels with video and screen sharing.

### Added

- **Communities** with text and voice channels, owners/admins/members, member
  list, and live updates.
- **Invite links** — one paste joins the community *and* creates the account on
  that server automatically. Links expire after 7 days or 100 uses.
- **End-to-end encrypted community content**: community, channel and member
  names, messages and call setup are encrypted on your device with the community
  key (AES-256-GCM, bound to community and channel). The key travels only in the
  invite link's `#fragment`, which never reaches the server.
- **Voice channels with video and screen sharing**: direct, peer-to-peer WebRTC
  calls (DTLS-SRTP), mute, camera, screen/window picker with high-quality screen
  sharing, connection status per person.
- Server: communities, channels, invites (stored hashed), encrypted messages,
  realtime WebSocket, encrypted signalling relay, `/join` landing page.
- Guide: [host a community tonight](docs/deployment/host-a-community.md) with a
  free Cloudflare tunnel. `npm run server` starts the server.
- Two-app end-to-end test: create, invite, join, chat both ways, call, camera.

### Known limitations

- Shared community key: anyone with an invite link can read the community, and
  there is no forward secrecy or removal of members yet. Per-member libsignal
  keys are planned.
- Calls are a full mesh (best for up to ~10 people); no relay (TURN/SFU) yet.
- Direct messages, social feed and files are still to come.

## [0.1.0] - 2026-10-09

**Accounts.** Create an account on a River server with nothing but your
cryptographic identity — no phone number, e-mail or name.

### Added

- **Account registration** in Settings → Server. River proves to the server
  that it holds your identity key and a new key for this device, and registers
  a **device list signed by your identity key**.
- **Device sessions** by challenge–response with the device key; the session
  token is kept only in memory and the server stores only its hash.
- **Server-tamper detection**: every time River connects it checks that the
  server's copy of your account is signed by your own identity. If not, River
  stops talking to that server and shows a security warning.
- Server: accounts, devices, sessions and one-time challenges (SQLite and
  PostgreSQL), stricter rate limits on authentication routes, `RIVER_REGISTRATION`
  (open/closed) and `RIVER_SESSION_TTL_HOURS`. No IP addresses, names or
  last-seen times are stored; dates are kept to the day.
- Security Center: server and devices rows reflect your account; top bar shows
  the connection.
- Protocol specification: [docs/protocol/accounts.md](docs/protocol/accounts.md).
- Integration test suite (`tests/integration`) running the desktop account code
  against the real server, including a malicious-server scenario.

### Changed

- Server Docker image is now based on Debian slim (libsignal needs glibc).

## [0.0.4] - 2026-10-08

You now have a River identity: a key pair created on your computer, with a
fingerprint your contacts will be able to verify.

### Added

- **First-run onboarding**: create your identity — no phone number, no e-mail.
  Choose an optional display name (kept on this computer for now).
- **Cryptographic identity** built on **libsignal** (Curve25519 identity key,
  the same construction Signal uses), a random River ID and registration ID.
  The private key is stored only in the encrypted local database and never
  leaves River's main process.
- **Identity fingerprint** (128-bit, hex) and **verification words** (Bytewords),
  shown in onboarding and in a new *Your identity* card in the Security Center.
- `@river/crypto` package: identity creation, fingerprints, verification words
  and libsignal safety numbers (used for contact verification from 0.3).
- `THIRD_PARTY_NOTICES.md`.

### Changed

- Home greets you by name and shows the next milestones.
- Security Center marks Identity as active once created.

## [0.0.3] - 2026-10-08

River now has an encrypted place on your computer to keep things — the
foundation for conversations, keys and media in the coming releases.

### Added

- **Encrypted local database** (SQLCipher, AES-256). River never writes its
  local data in readable form.
- The database key is 32 random bytes protected by your operating system:
  **Windows DPAPI**, **macOS Keychain** or the **Linux Secret Service**
  (GNOME Keyring / KWallet).
- **Passphrase protection** where no real keyring exists (for example Linux
  without a Secret Service): River asks you to choose a passphrase on first
  start and to unlock on later starts. The key is sealed with Argon2id
  (64 MiB, 3 passes, libsodium) and AES-256-GCM. Repeated wrong guesses are slowed down.
- **Local data migrations**: upgrades are applied in one transaction, with an
  encrypted backup copy before any destructive change; data written by a newer
  River is never touched by an older one.
- Security Center shows encrypted storage as active and how its key is protected.

### Changed

- Installers now contain only their own platform's native libraries.
- The updater no longer considers web-installer packages.

## [0.0.2] - 2026-10-08

The River server arrives, and the desktop app can connect to one. Still no
accounts or messages — this release lays the ground they will run on.

### Added

- **River server** (`apps/server`): Fastify HTTP service with `/v1/health` and
  `/v1/version`, strict security headers, request size limits, per-client rate
  limiting (in-memory only), and uniform JSON errors that never leak internals.
- **Privacy-preserving logging**: the server logs method, route template,
  status and duration — never IP addresses, headers, query strings or bodies.
  Tested in unit tests and against the container in CI.
- **Database layer** for SQLite (default) and PostgreSQL with forward-only,
  transactional migrations (a failing migration leaves no partial changes).
- **Docker image** (non-root, read-only filesystem, health check) and a
  docker-compose example; [self-hosting guide](docs/deployment/self-hosting.md).
- **Settings → Server** in the desktop app: enter a server address (HTTPS
  required, except for a server on your own computer) and test the connection.
  The test is one anonymous request for the server's version.
- `@river/protocol` package with the protocol version and validated API schemas.

### Changed

- Settings files from 0.0.1 are upgraded automatically; nothing is lost.
- The Security Center shows which server River is set to use.

### Fixed

- Paths containing backslashes or encoded separators are refused on every OS
  (Linux previously treated them as ordinary file names).

## [0.0.1] - 2026-10-08

The foundation release. River does not send messages yet — this version
establishes the desktop app, its design and, most importantly, the signed
automatic-update path that every later release will arrive through.

### Added

- Desktop app for Windows, macOS and Linux with River's own interface: Home,
  Messages, Communities, Social, Calls, Files, Contacts, Security and Settings.
  Sections that are not built yet say so clearly and show when they arrive.
- **Signed automatic updates** from GitHub Releases. Every update is checked
  against an Ed25519-signed release manifest whose key is built into River
  before it can be installed. Downgrades are refused.
- **Release channels**: Stable, Beta and Nightly, selectable in Settings → Updates.
- **Security Center** showing only what is actually active in this version.
- Settings for update behaviour, motion (reduced-motion support) and
  notification privacy (previews hidden by default).
- Hardened desktop shell: sandboxed interface served from a private `river://`
  scheme with a strict Content-Security-Policy, blocked navigation and pop-ups,
  all permissions denied by default, validated IPC.
- Installers: Windows (NSIS), macOS (DMG/ZIP, Intel and Apple silicon), Linux
  (AppImage, deb, rpm), with `SHA256SUMS`, a CycloneDX SBOM and a signed manifest.
- Architecture, threat model, cryptography, privacy and roadmap documentation.
- CI: lint, typecheck, unit and end-to-end tests on all three desktop platforms,
  CodeQL, Dependabot, dependency audit.

### Known limitations

- macOS builds are not notarized: first launch needs right-click → Open, and
  updates are offered as a download instead of installing silently.
- Windows builds are not Authenticode-signed: SmartScreen shows a warning on
  first install.

[Unreleased]: https://github.com/martex-dev/river/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/martex-dev/river/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/martex-dev/river/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/martex-dev/river/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/martex-dev/river/compare/v0.0.4...v0.1.0
[0.0.4]: https://github.com/martex-dev/river/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/martex-dev/river/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/martex-dev/river/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/martex-dev/river/releases/tag/v0.0.1
