# TODO

Ordered by priority. The top unchecked item is the next thing to build.
Milestone definitions: [ROADMAP.md](ROADMAP.md).

## 0.1.0 — Accounts and device authentication

- [ ] Protocol: `POST /v1/accounts` (River ID, identity key, device ID, device Ed25519 auth key, registration ID), schemas + test vectors
- [ ] Server: `accounts` and `devices` tables (migration 0002), registration with proof the client holds the identity key (signature over a server challenge)
- [ ] Challenge–response login (`/v1/auth/challenge`, `/v1/auth/session`), opaque session tokens stored hashed, short expiry
- [ ] Identity-signed device list v1 (`PUT /v1/devices/list`), monotonic version, client-side verification
- [ ] Per-account rate limits; abuse controls for registration (configurable: open / invite codes)
- [ ] Desktop: device auth key in the encrypted DB; "Create account on <server>" flow in Settings → Server; Security Center devices
- [ ] Tests: registration replay, wrong signature, stale device-list version, token expiry; e2e desktop ↔ server registration

## Later in 0.0.x / ongoing

- [ ] Optional passphrase lock on systems that do have an OS keystore (app lock)
- [ ] Change / remove passphrase in Settings
- [ ] Post-install health check: detect crash loop after an update and pause auto-install
- [ ] `dev-app-update.yml` for local updater testing
- [ ] Bundle spellcheck dictionaries (Chromium's Linux spellchecker is disabled for privacy)
- [ ] Release-key hardening plan (hardware key / threshold) — before 1.0.0
