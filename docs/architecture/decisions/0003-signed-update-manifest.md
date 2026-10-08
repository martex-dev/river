# 0003 — Ed25519-signed release manifest

**Status:** accepted (0.0.1)

**Context.** electron-updater checks a SHA-512 from `latest.yml`, which is
hosted next to the installer; it does not prove who built the release. Platform
code signing (Authenticode, Apple Developer ID) costs money the project does not
have yet, and does not cover Linux.

**Decision.** Each release ships `river-release-manifest.json` (all files with
SHA-256/SHA-512) and an Ed25519 signature over
`"river-release-manifest-v1\n" || manifest`. The public key is compiled into
the app; the updater installs nothing that is not listed in a valid manifest
for exactly that version. Downgrades are refused.

**Consequences.** Works identically on all platforms and costs nothing. The
private key is a high-value secret (GitHub secret + offline backup) and needs a
rotation procedure (docs/deployment/releasing.md). Platform signing can be added
later on top.
