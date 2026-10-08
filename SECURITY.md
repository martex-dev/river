# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub:
**[Report a vulnerability](https://github.com/martex-dev/river/security/advisories/new)**
(Security tab → Report a vulnerability).

Please include what you found, how to reproduce it, the River version, and your
operating system. We aim to acknowledge reports within 7 days and to agree on a
disclosure timeline with you. Credit is given in the release notes unless you
prefer otherwise.

## Supported versions

Only the latest release on each channel receives fixes. River updates itself,
so staying current requires no action.

| Version               | Supported        |
| --------------------- | ---------------- |
| Latest stable         | ✅               |
| Latest beta / nightly | ✅ (best effort) |
| Anything older        | ❌ — update      |

## Scope

In scope: the desktop app, the River server, the release and update pipeline,
and the cryptographic design described in [CRYPTOGRAPHY.md](CRYPTOGRAPHY.md).

Out of scope (see [THREAT_MODEL.md §4](THREAT_MODEL.md#4-non-goals--out-of-scope)):
malware already running on an unlocked device, attacks requiring a compromised
operating system, and network-level anonymity.

## Security practices

- Established cryptography only (libsignal, Ed25519, AES, HKDF, Argon2id, WebRTC).
- Releases are built in GitHub Actions; every release manifest is signed with an
  Ed25519 key whose public half is compiled into River. Clients refuse updates
  that do not verify.
- GitHub Actions are pinned to commit SHAs; Dependabot, CodeQL and secret
  scanning run on the repository; each release ships a CycloneDX SBOM and SHA256SUMS.
- The renderer is sandboxed with a strict Content-Security-Policy; private keys
  live only in the main process.

## Audit status

River has **not** had an independent security audit. Internal security reviews
are performed before 1.0.0 and 2.0.0 (and documented in `docs/security/`), but
they are not a substitute for an independent professional audit.
