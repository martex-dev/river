# Contributing to River

Thank you for helping. River is a privacy and security project, so a few rules
matter more here than in most codebases.

## Ground rules

1. **No homemade cryptography.** Use libsignal or the primitives listed in
   [CRYPTOGRAPHY.md](CRYPTOGRAPHY.md). New cryptographic constructions need a
   design note in `docs/security/` and review before code.
2. **No plaintext to the server.** If a feature seems to need the server to see
   content, open a discussion first.
3. **No tracking.** No analytics, telemetry, crash reporters or third-party SDKs
   that send data anywhere without an explicit, documented, opt-in decision.
4. **Honest UI.** Never show a security indicator for something that is not
   actually active. Never use "military-grade", "unhackable", "untraceable".
5. **Never commit secrets.** Keys, tokens and passwords belong in GitHub secrets
   or your local `.env` (git-ignored).

## Workflow

1. Fork and create a branch: `feat/short-name` or `fix/short-name`.
2. `npm ci`, then make your change with tests.
3. Before pushing:
   ```bash
   npm run lint && npm run format:check && npm run typecheck && npm test
   npm run build && npm run test:e2e
   ```
4. Use [Conventional Commits](https://www.conventionalcommits.org/):
   `feat(chat): …`, `fix(updater): …`, `security(keys): …`, `docs: …`, `build(release): …`.
5. Open a pull request describing what changed, why, and how it was tested.

## Where things live

See [DEVELOPMENT.md](DEVELOPMENT.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Licensing

By contributing you agree that your contribution is licensed under the
[AGPL-3.0](LICENSE). Only contribute code you have the right to license.
Do not copy code, assets or designs from proprietary products.
