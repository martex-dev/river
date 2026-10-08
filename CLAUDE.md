# River — instructions for AI coding agents

River is a long-running open-source project built incrementally toward
**1.0.0 (Stage 1, desktop)** and **2.0.0 (Stage 2, + iOS/Android)**.
Read these before changing anything:

- [STATUS.md](STATUS.md) — what is done, partial, broken; current version
- [TODO.md](TODO.md) — the next tasks, in order
- [ROADMAP.md](ROADMAP.md) — milestone plan for both stages
- [ARCHITECTURE.md](ARCHITECTURE.md), [CRYPTOGRAPHY.md](CRYPTOGRAPHY.md), [THREAT_MODEL.md](THREAT_MODEL.md)

## When the maintainer says "continue" (or "next milestone", "prepare release" …)

1. Inspect the repo state (`git status`, `git log -5`), read STATUS.md, TODO.md, ROADMAP.md.
2. Run `npm ci` if needed, then `npm run lint && npm run typecheck && npm test`.
3. Take the highest-priority unchecked item in TODO.md and implement it with tests.
4. Fix what breaks; never delete working functionality to make tests pass.
5. Update docs, TODO.md, STATUS.md, CHANGELOG.md (`## [Unreleased]`).
6. Commit with Conventional Commits (`feat(scope): …`, `security(scope): …`).
7. When a milestone's TODO section is complete: release it (see below).
8. Report briefly: completed, tests, what remains, current version, next milestone.

Ask the maintainer only for decisions that need a human (money, accounts,
legal, irreversible architecture changes). Open decisions are listed at the end
of ROADMAP.md.

## Releasing

See [docs/deployment/releasing.md](docs/deployment/releasing.md). In short:
move `[Unreleased]` notes into `## [X.Y.Z] - date` in CHANGELOG.md,
`npm run version:set -- X.Y.Z`, `npm install`, commit `build(release): prepare X.Y.Z`,
tag `vX.Y.Z`, push the tag, watch the Release workflow. Never release with known
critical security issues or failing tests.

## Non-negotiable rules

- Established crypto only (libsignal, Node crypto, libsodium). No custom primitives.
- The server must never receive plaintext content or private keys.
- The renderer is untrusted: no Node, all IPC validated in main with zod.
- The UI must never claim a protection that is not active.
- Never commit secrets. The release signing key lives only in the
  `RIVER_RELEASE_SIGNING_KEY` GitHub secret and the maintainer's offline backup.
- Remote assistance (Stage 2) is consent-only: visible indicator, instant
  termination, no hidden or unattended access — ever.
- Workspace TypeScript: explicit `.ts` import extensions, erasable syntax only.
