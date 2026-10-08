# TODO

Ordered by priority. The top unchecked item is the next thing to build.
Milestone definitions: [ROADMAP.md](ROADMAP.md).

## 0.0.4 — Cryptographic identity

- [ ] `packages/crypto`: libsignal identity key pair, River ID, identity fingerprint, PGP-wordlist verification words, safety numbers
- [ ] Onboarding flow (choose display name; no phone/e-mail)
- [ ] Private key never crosses IPC (test)
- [ ] Test vectors for fingerprints and words

## Later in 0.0.x / ongoing

- [ ] Optional passphrase lock on systems that do have an OS keystore (app lock)
- [ ] Change / remove passphrase in Settings
- [ ] Post-install health check: detect crash loop after an update and pause auto-install
- [ ] `dev-app-update.yml` for local updater testing
- [ ] Bundle spellcheck dictionaries (Chromium's Linux spellchecker is disabled for privacy)
- [ ] Release-key hardening plan (hardware key / threshold) — before 1.0.0
