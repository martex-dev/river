# River Status

_Last updated: 2026-10-10 · Current version: **1.0.2** · Stage 1 complete · Next: Stage 2 (1.0.x stabilisation, 1.1 protocol freeze)_

## Complete

| Area                  | What works                                                                                                                                                                        | Tests                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Repository            | Monorepo (npm workspaces), AGPL-3.0, all governance docs                                                                                                                          | —                                                                                                                 |
| Release signing       | Ed25519 manifest format, sign/verify, pinned trust list, domain separation                                                                                                        | `packages/release/test` (15)                                                                                      |
| Desktop shell         | Electron + React, nine sections, River design language, reduced motion                                                                                                            | `apps/desktop/test/renderer.test.tsx`, e2e                                                                        |
| Desktop hardening     | `river://` scheme with CSP, sandbox, context isolation, navigation/pop-up/permission blocking, trusted-sender IPC with zod validation                                             | `url-policy.test.ts`, e2e                                                                                         |
| Auto-update           | electron-updater + River verification, channels (stable/beta/nightly), no downgrades, install-on-quit only after verification, manual mode for unsigned macOS                     | `update-service.test.ts`, `verify-download.test.ts`                                                               |
| Settings              | Validated, atomic, self-healing settings store                                                                                                                                    | `settings-store.test.ts`                                                                                          |
| Server                | Fastify `/v1/health` + `/v1/version`, security headers, rate limit, IP-free logging, SQLite/PostgreSQL, transactional migrations, Docker image                                    | `apps/server/test` (config, database incl. Postgres in CI, app)                                                   |
| Server setting        | Desktop Settings → Server with URL validation and compatibility check; Security Center shows configured server                                                                    | `server-check.test.ts`, `e2e/server.spec.ts`                                                                      |
| Local storage         | SQLCipher database; key wrapped by DPAPI / Keychain / Secret Service, or sealed with an Argon2id passphrase; transactional migrations with backups; lock/unlock UI                | `storage.test.ts` (incl. libsodium vs OpenSSL Argon2id agreement), `e2e/storage.spec.ts`                          |
| Identity              | libsignal identity key, River ID, fingerprint, Bytewords verification words, safety numbers; onboarding; Security Center identity card; private key never crosses IPC             | `packages/crypto/test`, `identity-service.test.ts`, `e2e/identity.spec.ts`                                        |
| Accounts              | Registration with identity + device key proof, identity-signed device list, challenge–response sessions (hashed tokens), server-tamper detection, Settings → Server account UI    | `apps/server/test/accounts.test.ts`, `tests/integration/account.test.ts`, `e2e/server.spec.ts`                    |
| Communities           | Create/invite/join, text channels, voice channels with video and screen sharing (WebRTC mesh), shared-key E2EE of all community content                                           | `apps/server/test/communities.test.ts`, `e2e/community.spec.ts` (two apps)                                        |
| Roles & moderation    | Roles/permissions with hierarchy, private channels, kick/ban, settings UIs, edits, pins, reactions (HMAC tags), mentions, typing, presence, notifications, voice controls, sounds | `communities.test.ts` (roles), `tests/integration/community.test.ts`, `e2e/community.spec.ts`                     |
| Attachments           | Encrypted files/images/video/audio in channels (Signal attachment format), inline media, save, drag & drop, paste, server blob store with cleanup                                 | `packages/crypto/test/attachment.test.ts`, `communities.test.ts`, `tests/integration/community.test.ts`, e2e      |
| Direct messages       | libsignal 1:1 (PQXDH + Double Ratchet), prekeys, mailbox, requests, blocks, receipts, typing, edits, reactions, files, safety numbers, 1:1 voice/video calls                      | `packages/crypto/test/session.test.ts`, `apps/server/test/messaging.test.ts`, `tests/integration/dm.test.ts`, e2e |
| Groups & key rotation | Group conversations (pairwise libsignal, ≤ 32), admins, requests; community key epochs rotated on removal and delivered over libsignal; key requests with join proof              | `tests/integration/dm.test.ts`, `tests/integration/epochs.test.ts`, `communities.test.ts`, e2e                    |
| Social                | Posts and 24-hour stories to friends or chosen people, comments/reactions relayed by the author, story views, profiles with bios                                                  | `tests/integration/dm.test.ts`, e2e                                                                               |
| Backup & recovery     | 18-word recovery phrase, encrypted backup file, restore on a fresh install with automatic re-introduction; TURN relay support for calls                                           | `packages/crypto/test/backup.test.ts`, `tests/integration/backup.test.ts`, `apps/server/test/messaging.test.ts`   |
| Categories & unread   | Encrypted channel categories, drag-and-drop ordering (one atomic layout request), collapsible categories, unread markers kept across restarts                                     | `communities.test.ts`, `layout.test.ts`, `tests/integration/community.test.ts`, e2e                               |
| Hardening             | Channel history paging, on-device search, Contacts/Files/Calls sections, abuse limits, upgrade tests from every release, WCAG AA audits, pre-1.0 security review                  | `upgrades.test.ts`, `messaging.test.ts`, `e2e/a11y.spec.ts`, e2e                                                  |
| CI/CD                 | CI (lint, format, typecheck, unit, e2e on 3 OSes, audit), CodeQL, Dependabot, tag-driven signed release pipeline                                                                  | —                                                                                                                 |

## Partially complete

- **Update rollback**: a failed or unverifiable update is never installed and the
  current version keeps running. Automatic rollback _after_ a successfully
  installed update that then fails to start is not implemented (TODO).
- **macOS updates**: notify-and-download only until an Apple Developer ID exists.

## Broken / failing

- Nothing known.

## Security risks open

- Direct messages do not hide the sender from the server yet (no sealed
  sender); the server sees who messages whom and when.
- Communities share one key per epoch: anyone with a valid invite link can
  join and read; removal rotates the key for future content only, and there is
  no per-message forward secrecy inside communities (CRYPTOGRAPHY.md §4a).
- Release signing key lives in a GitHub Actions secret (plus an offline backup
  held by the maintainer). Hardening plan: docs/security/release-signing.md
  (first steps need the maintainer).
- No Authenticode / Apple notarization (user-facing warnings on first install).
- No independent audit.
- Dependabot alert #1 (`sprintf-js`, moderate) is in build tooling only
  (electron-builder → global-agent); no fixed version exists upstream. Not shipped to users.

## Next

See [TODO.md](TODO.md). Stage 1 is complete with 1.0.0. Next: **1.0.x stabilisation**, then **1.1 — protocol freeze** and **1.2 — linked devices**. Public use needs a decision on a stable server address (see ROADMAP open decisions); until then people self-host or use the maintainer's tunnel.
