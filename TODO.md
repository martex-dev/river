# TODO

Ordered by priority. The top unchecked item is the next thing to build.
Milestone definitions: [ROADMAP.md](ROADMAP.md).

## 0.0.2 — River server skeleton

- [ ] `packages/protocol`: protocol version constant, zod schemas for `/v1/version` and `/v1/health`
- [ ] `apps/server`: Fastify app factory, config from env (validated), structured logger without IPs/bodies
- [ ] Kysely database layer: SQLite (better-sqlite3) default, PostgreSQL option
- [ ] Server migration framework (`schema_migrations`, forward-only, transactional) + first migration
- [ ] `/v1/version`, `/v1/health`, security headers, request size limits, rate-limit plugin
- [ ] Tests: config validation, migrations up from empty, endpoint tests
- [ ] Dockerfile (non-root, read-only FS) + docker-compose example; CI builds the image
- [ ] Desktop: "Server" setting (URL, validated https) and connection check in Settings
- [ ] Docs: `docs/backend/`, `docs/deployment/self-hosting.md`

## 0.0.3 — Encrypted local database

- [ ] `better-sqlite3-multiple-ciphers` in main process (SQLCipher), electron-builder native rebuild in CI
- [ ] 32-byte DB key wrapped with `safeStorage`; Linux fallback when no keyring (passphrase via Argon2id)
- [ ] Client migration framework with backup-before-destructive-migration and restore on failure
- [ ] Tests: wrong key fails, file is not plaintext, migration upgrade from fixture DBs

## 0.0.4 — Cryptographic identity

- [ ] `packages/crypto`: libsignal identity key pair, River ID, identity fingerprint, PGP-wordlist verification words, safety numbers
- [ ] Onboarding flow (choose display name; no phone/e-mail)
- [ ] Private key never crosses IPC (test)
- [ ] Test vectors for fingerprints and words

## Later in 0.0.x / ongoing

- [ ] Post-install health check: detect crash loop after an update and pause auto-install
- [ ] `dev-app-update.yml` for local updater testing
- [ ] Bundle spellcheck dictionaries (Chromium's Linux spellchecker is disabled for privacy)
- [ ] Release-key hardening plan (hardware key / threshold) — before 1.0.0
