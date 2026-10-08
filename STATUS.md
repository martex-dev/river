# River Status

_Last updated: 2026-10-09 · Current version: **0.1.0** · Stage 1 · Next: **0.1.1**_

## Complete

| Area              | What works                                                                                                                                                                     | Tests                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Repository        | Monorepo (npm workspaces), AGPL-3.0, all governance docs                                                                                                                       | —                                                                                              |
| Release signing   | Ed25519 manifest format, sign/verify, pinned trust list, domain separation                                                                                                     | `packages/release/test` (15)                                                                   |
| Desktop shell     | Electron + React, nine sections, River design language, reduced motion                                                                                                         | `apps/desktop/test/renderer.test.tsx`, e2e                                                     |
| Desktop hardening | `river://` scheme with CSP, sandbox, context isolation, navigation/pop-up/permission blocking, trusted-sender IPC with zod validation                                          | `url-policy.test.ts`, e2e                                                                      |
| Auto-update       | electron-updater + River verification, channels (stable/beta/nightly), no downgrades, install-on-quit only after verification, manual mode for unsigned macOS                  | `update-service.test.ts`, `verify-download.test.ts`                                            |
| Settings          | Validated, atomic, self-healing settings store                                                                                                                                 | `settings-store.test.ts`                                                                       |
| Server            | Fastify `/v1/health` + `/v1/version`, security headers, rate limit, IP-free logging, SQLite/PostgreSQL, transactional migrations, Docker image                                 | `apps/server/test` (config, database incl. Postgres in CI, app)                                |
| Server setting    | Desktop Settings → Server with URL validation and compatibility check; Security Center shows configured server                                                                 | `server-check.test.ts`, `e2e/server.spec.ts`                                                   |
| Local storage     | SQLCipher database; key wrapped by DPAPI / Keychain / Secret Service, or sealed with an Argon2id passphrase; transactional migrations with backups; lock/unlock UI             | `storage.test.ts` (incl. libsodium vs OpenSSL Argon2id agreement), `e2e/storage.spec.ts`       |
| Identity          | libsignal identity key, River ID, fingerprint, Bytewords verification words, safety numbers; onboarding; Security Center identity card; private key never crosses IPC          | `packages/crypto/test`, `identity-service.test.ts`, `e2e/identity.spec.ts`                     |
| Accounts          | Registration with identity + device key proof, identity-signed device list, challenge–response sessions (hashed tokens), server-tamper detection, Settings → Server account UI | `apps/server/test/accounts.test.ts`, `tests/integration/account.test.ts`, `e2e/server.spec.ts` |
| CI/CD             | CI (lint, format, typecheck, unit, e2e on 3 OSes, audit), CodeQL, Dependabot, tag-driven signed release pipeline                                                               | —                                                                                              |

## Partially complete

- **Update rollback**: a failed or unverifiable update is never installed and the
  current version keeps running. Automatic rollback _after_ a successfully
  installed update that then fails to start is not implemented (TODO).
- **macOS updates**: notify-and-download only until an Apple Developer ID exists.

## Broken / failing

- Nothing known.

## Security risks open

- Release signing key lives in a GitHub Actions secret (plus an offline backup
  held by the maintainer). Planned hardening before 1.0.0.
- No Authenticode / Apple notarization (user-facing warnings on first install).
- No independent audit.
- Dependabot alert #1 (`sprintf-js`, moderate) is in build tooling only
  (electron-builder → global-agent); no fixed version exists upstream. Not shipped to users.

## Next

See [TODO.md](TODO.md). Next milestone: **0.1.1 — Encrypted profiles**. Public use needs a decision on server hosting (see ROADMAP open decisions); until then people self-host or use a local server.
