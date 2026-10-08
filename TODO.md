# TODO

Ordered by priority. The top unchecked item is the next thing to build.
Milestone definitions: [ROADMAP.md](ROADMAP.md).

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
