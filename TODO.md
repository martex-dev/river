# TODO

Ordered by priority. The top unchecked item is the next thing to build.
Milestone definitions: [ROADMAP.md](ROADMAP.md).

## 0.4.0 — Encrypted attachments

- [x] Crypto: Signal attachment format (AES-256-CBC + HMAC-SHA256, 64-byte random key, SHA-256 digest) in `packages/crypto`, with tamper tests
- [x] Server: ciphertext blob store (`POST/GET /v1/attachments`), size limit, ATTACH_FILES enforced when linking to a message, deletion with message/channel/community, garbage collection of unlinked uploads
- [x] Desktop: upload (picker, drag & drop, paste), inline images/video/audio, file cards with save, local thumbnails, progress and errors
- [x] Tests: server never stores plaintext; wrong key/digest rejected; e2e image round trip between two apps

## 0.5.0 — Contacts and direct messages

- [ ] Prekeys (signed + one-time, Kyber) upload/fetch; libsignal session store in the local DB
- [ ] Offline mailbox with acknowledgements; realtime delivery; multi-device fan-out
- [ ] Contacts: add by invite link or River ID, message requests, block
- [ ] DM UI (conversation list, unread, typing, read receipts, reactions/edit/delete), 1:1 voice/video calls

## Next — community hardening (after 0.2.0)

- [ ] Per-member keys (libsignal sender keys) with forward secrecy; member removal / key rotation
- [ ] TURN relay for strict networks; SFU for larger calls
- [x] Kick/ban, roles UI, channel rename/delete, message edit/delete/reactions (0.3.0)
- [x] Desktop notifications (privacy setting already exists), unread badges (0.3.0)
- [ ] Direct messages and friends (libsignal 1:1 sessions)
- [ ] Global push-to-talk (outside the focused window) — needs a key-up capable hook
- [ ] Persist unread state across restarts; drag-and-drop channel/role ordering; categories
- [ ] Stable community address (named tunnel or hosted server) — needs a maintainer decision
- [ ] Multiple servers per client

## 0.1.1 — Encrypted profiles

- [ ] Profile key (256-bit) in the identity record; profile fields (name, bio, avatar, links) encrypted with AES-256-GCM under it
- [ ] Server: `PUT/GET /v1/profile/:riverId` storing only ciphertext + version; size limits
- [ ] Desktop: profile editor (Settings → Profile), avatar crop/resize locally, upload on change
- [ ] Tests: server stores no plaintext; wrong profile key cannot decrypt; size/tamper checks

## 0.1.x — Account hardening (before 0.2.0)

- [ ] Registration abuse controls: invite codes (`RIVER_REGISTRATION=invite`), per-account rate limits
- [ ] `PUT /v1/devices/list` for list updates (monotonic version) — needed for device linking
- [ ] Session refresh before expiry; reconnect on network change
- [ ] Delete account (server-side) and leave server (client-side)

## Later in 0.0.x / ongoing

- [ ] Optional passphrase lock on systems that do have an OS keystore (app lock)
- [ ] Change / remove passphrase in Settings
- [ ] Post-install health check: detect crash loop after an update and pause auto-install
- [ ] `dev-app-update.yml` for local updater testing
- [ ] Bundle spellcheck dictionaries (Chromium's Linux spellchecker is disabled for privacy)
- [ ] Release-key hardening plan (hardware key / threshold) — before 1.0.0
