# TODO

Ordered by priority. The top unchecked item is the next thing to build.
Milestone definitions: [ROADMAP.md](ROADMAP.md).

## 1.0.0 — Stage 1 release

- [x] Channel categories (encrypted names), drag-and-drop ordering of channels and categories, collapsible categories
- [x] Unread markers that survive restarts (last-read times kept in the local encrypted database)
- [x] Release-key hardening plan (docs/security/release-signing.md); the steps themselves need the maintainer
- [x] README, Home and docs describe the finished Stage 1

## 1.0.x — Make River the only app you need (maintainer request, 2026-10-10)

Each line is one PR; each version ships when its section is done.

### 1.0.1 — Sound and motion

- [ ] Sound library: send, receive, mention, reaction, voice join/leave, call connected/ended, community joined, friend request/added, copied, error; volume and per-group toggles
- [ ] Every interaction plays its sound (community and DMs)
- [ ] Motion: sent/received messages, reaction pop, mention flash, voice join, speaking ring, celebration on joining/adding a friend, badge bounce; reduced motion respected

### 1.0.2 — Easy start

- [ ] Create a community in one step, with templates (Friends, Gaming, Study, Club) and an icon
- [ ] Paste an invite link anywhere (or have it detected on the clipboard) to join
- [ ] Welcome screen for new members, helpful empty states, invite button always at hand

### 1.0.3 — Friends made simple

- [ ] Friends page: Online, All, Pending, Blocked tabs with presence
- [ ] Friend codes/links you can share; one-click add; request alerts with sound
- [ ] Mutual communities and quick Message/Call on every friend

### 1.0.4 — Highlighting

- [ ] Mention autocomplete for people, roles, @everyone and @here
- [ ] Mentioned messages highlighted; role mentions and @everyone respect permissions
- [ ] "New messages" divider, jump to reply/pin/search result with a flash, mention counts kept across restarts

### 1.0.5 — Stability

- [ ] Clear connection banner with automatic reconnect and backoff
- [ ] Messages queue while offline: sending, failed, retry
- [ ] Post-install health check: detect a crash loop after an update and pause auto-install
- [ ] Plain-language errors everywhere

### 1.0.6 — Roles and permissions parity

- [ ] Category permissions; channels synced to their category
- [ ] Hoisted roles (shown separately), mentionable roles, role colours in chat
- [ ] Per-community nicknames; timeouts; audit log

### 1.0.7 — Channels parity

- [ ] Announcement channels; slowmode; channel topic in the header
- [ ] Threads in text channels

### 1.0.8 — Voice parity

- [ ] User limits on voice channels; video grid and focus view
- [ ] Mic test in settings; clearer speaking indicators

### 1.0.9 — Polish

- [ ] Compact mode; quick switcher (Ctrl+K); keyboard shortcuts panel
- [ ] Accessibility and performance pass; security review of 1.0.x

### Later

- [ ] Sealed sender for direct messages

## 0.4.0 — Encrypted attachments

- [x] Crypto: Signal attachment format (AES-256-CBC + HMAC-SHA256, 64-byte random key, SHA-256 digest) in `packages/crypto`, with tamper tests
- [x] Server: ciphertext blob store (`POST/GET /v1/attachments`), size limit, ATTACH_FILES enforced when linking to a message, deletion with message/channel/community, garbage collection of unlinked uploads
- [x] Desktop: upload (picker, drag & drop, paste), inline images/video/audio, file cards with save, local thumbnails, progress and errors
- [x] Tests: server never stores plaintext; wrong key/digest rejected; e2e image round trip between two apps

## 0.9.0 — Hardening

- [x] Older history in channels; search in communities (on device) and conversations
- [x] Contacts, Files and Calls sections (no placeholder sections left)
- [x] Server abuse limits: socket flood control, mailbox cap, storage quota
- [x] Upgrade tests from every released local schema; accessibility audits (axe-core) in CI
- [x] Pre-1.0 security review
- [ ] Multi-device linking (moved to Stage 2, 1.2.x)

## 0.8.0 — Recovery and reliable calls

- [x] Recovery phrase (Bytewords + checksum) and encrypted backup files; restore on a fresh install
- [x] Fresh prekeys and automatic re-introduction to contacts after a restore
- [x] TURN relay support (coturn REST credentials) for calls through strict networks
- [ ] Automatic scheduled backups to a folder; multi-device linking (0.9)

## 0.7.0 — Social

- [x] Posts and 24-hour stories to all friends or chosen people (pairwise libsignal fan-out)
- [x] Comments and reactions relayed by the author; story views; profiles with bios
- [x] Received files kept locally (encrypted) beyond the server's retention
- [ ] Sender-key fan-out for large audiences; video stories; collections

## 0.6.0 — Groups and community key rotation

- [x] Community key epochs: rotation on removal (compare-and-set), delivery over libsignal, key requests with join proof
- [x] Group conversations (pairwise libsignal fan-out, ≤ 32 people): create, admins, add/remove, leave, requests
- [ ] Sender keys for larger groups; read receipts and calls in groups

## 0.5.0 — Contacts and direct messages

- [x] Prekeys (signed + one-time, Kyber) upload/fetch; libsignal session store in the local DB
- [x] Offline mailbox with acknowledgements; realtime delivery (multi-device fan-out comes with device linking)
- [x] Contacts: add by River ID or from a community, message requests, block
- [x] DM UI (conversation list, unread, typing, read receipts, reactions/edit/delete), 1:1 voice/video calls

## Next — community hardening (after 0.2.0)

- [ ] Per-member keys (libsignal sender keys) with forward secrecy; member removal / key rotation
- [ ] TURN relay for strict networks; SFU for larger calls
- [x] Kick/ban, roles UI, channel rename/delete, message edit/delete/reactions (0.3.0)
- [x] Desktop notifications (privacy setting already exists), unread badges (0.3.0)
- [ ] Direct messages and friends (libsignal 1:1 sessions)
- [ ] Global push-to-talk (outside the focused window) — needs a key-up capable hook
- [x] Persist unread state across restarts; drag-and-drop channel ordering; categories (1.0.0)
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
- [x] Release-key hardening plan (hardware key / threshold) — docs/security/release-signing.md
