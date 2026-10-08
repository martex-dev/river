# Changelog

All notable changes to River are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and River uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/martex-dev/river/compare/v0.0.4...HEAD
[0.0.4]: https://github.com/martex-dev/river/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/martex-dev/river/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/martex-dev/river/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/martex-dev/river/releases/tag/v0.0.1
