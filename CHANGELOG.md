# Changelog

All notable changes to River are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and River uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/martex-dev/river/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/martex-dev/river/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/martex-dev/river/releases/tag/v0.0.1
