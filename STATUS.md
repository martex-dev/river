# River Status

_Last updated: 2026-10-08 · Current version: **0.0.1** · Stage 1 · Next: **0.0.2**_

## Complete

| Area              | What works                                                                                                                                                    | Tests                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Repository        | Monorepo (npm workspaces), AGPL-3.0, all governance docs                                                                                                      | —                                                   |
| Release signing   | Ed25519 manifest format, sign/verify, pinned trust list, domain separation                                                                                    | `packages/release/test` (15)                        |
| Desktop shell     | Electron + React, nine sections, River design language, reduced motion                                                                                        | `apps/desktop/test/renderer.test.tsx`, e2e          |
| Desktop hardening | `river://` scheme with CSP, sandbox, context isolation, navigation/pop-up/permission blocking, trusted-sender IPC with zod validation                         | `url-policy.test.ts`, e2e                           |
| Auto-update       | electron-updater + River verification, channels (stable/beta/nightly), no downgrades, install-on-quit only after verification, manual mode for unsigned macOS | `update-service.test.ts`, `verify-download.test.ts` |
| Settings          | Validated, atomic, self-healing settings store                                                                                                                | `settings-store.test.ts`                            |
| CI/CD             | CI (lint, format, typecheck, unit, e2e on 3 OSes, audit), CodeQL, Dependabot, tag-driven signed release pipeline                                              | —                                                   |

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

## Next

See [TODO.md](TODO.md). Next milestone: **0.0.2 — River server skeleton**.
