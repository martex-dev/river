# TODO

Ordered by priority. The top unchecked item is the next thing to build.
Milestone definitions: [ROADMAP.md](ROADMAP.md).

## Road to 3.0 (maintainer request, 2026-10-18)

Plan: [docs/product/road-to-3.md](docs/product/road-to-3.md). Many releases, one theme per minor.

- [x] 2.11.2 Call fixes (missed calls, glare, a second call, other devices, speaker and Bluetooth), review fixes
- [x] 2.11.3 Server, connection and hosting sweep: no double posts after a lost reply, reconnects that back off and notice dead connections, prekeys topped up while connected, PostgreSQL restarts, hosting retries and honest Funnel status
- [x] 2.12.0 Community messages and profiles bound to their sender (v2 associated data by default), full channel history, community delivery fixes
- [x] 2.12.1 Phone native sweep: reconnect on network change, Stay connected restart crash, other apps' calls kept, notification ids after a restart, lock screen on Android 8, share and save fixes, iPhone notifications cleared on sign-out
- [x] 2.13.0 Phones look like Telegram and Instagram: bottom tabs, chat list, conversation screen with bubbles, communities as a list, calls list, feed, profile
- [x] 2.13.1 Linking a phone finishes (core timers in a worker)
- [x] 2.14.0 Voice channels for big groups and meetings; joining is heard at once; pages scroll in every skin
- [x] 2.15.0 Privacy part 2 (padding, photo metadata, proxy, retention, local history) and the desktop polish sweep
- [x] 2.16.0 Easy start: one-screen first run, invite links straight in
- [x] 2.17.0 Notifications: per-chat mute/mentions/sound, grouping, Mark as read, badges, in-app banners, mentions always come through
- [x] 2.18.0 Looks: wallpapers, accent picker, bubble shapes, theme codes, live preview, delight with Calm mode
- [x] 2.18.1 Phone audit: 18 fixes (Back inside screens, editing on phones, growing composer, menus, opaque call screen, picture-in-picture, voice lobby, tap targets, phone wording)
- [x] 2.19.0 Group calls in group chats (up to 50, community voice engine), Join bar, call links with Ask to join
- [ ] 2.19.x Polish for each phone screen
- [ ] 2.14.x Easy start: install to first chat in under a minute, one-screen profile, invite links that open the app; community keys need a proof
- [ ] 2.15.x Group calls, call quality, call links — group calls in group chats and call links built, unreleased (ring with "Group call · N people", Join bar, leave and rejoin, mesh up to 8 then the encrypted relay, call history, Ask to join / Let in); still to try with real phones (ringing screen, picture-in-picture) and with many people on a real network
- [ ] 2.16.x Voice channels and meetings: bigger rooms, grid and speaker views, raise hand, stage
- [ ] 2.17.x Notifications: per-chat sounds, mentions-only, grouping — built, unreleased (per-chat levels, mutes and sounds, one notification per conversation with Android group summaries, cleared on read anywhere, Mark as read, icon badges, in-app banners, ignore @everyone); still to try on a real Android phone and iPhone
- [ ] 2.18.x Looks: wallpapers, accent colours, bubble styles, theme editor
  - [x] Chat wallpapers (app and per chat; doodles, gradients, colour, photo), accent picker, bubble shapes, theme codes, live preview, reaction bursts, Calm mode
  - [ ] Alternative app icons — skipped for now: Android launcher aliases can drop home-screen shortcuts and restart the app; Windows taskbars show the pinned shortcut's icon
- [ ] 2.19.x Messaging, part 2
  - [x] Big emoji, reply previews with jump, saved replies (/ and a button, this device only), tags for Note to self and saved messages, message effects (Calm mode and reduced motion respected; 2.18 apps ignore them), Count archived chats, Calls segment contrast, shortened links with the whole address, safe mailto:/tel:, forward without the sender's name
  - [ ] Copy saved replies and tags to linked devices (needs a sync path for settings)
  - [ ] Richer editor, more sticker and emoji tools
- [ ] 2.20.x Privacy, part 2: less metadata, padding, proxy-friendly connections
- [ ] 2.21.x Whole-app sweep

## 2.x — Telegram, Signal and phone-call parity (maintainer request, 2026-10-16)

Audit and plan: [docs/product/telegram-parity.md](docs/product/telegram-parity.md). One release per line.

- [x] 2.0.4 Louder, clearer voice (up to 200 % with a limiter; louder on phones; volume buttons)
- [x] 2.1.0 Chat list: pin, archive, mark unread, filters, jump to latest
- [x] 2.2.0 Message actions: copy, select several, search in a conversation
- [x] 2.3.0 Voice messages with playback speed
- [x] 2.4.0 Disappearing messages
- [x] 2.5.0 Scheduled messages, send without sound
- [x] 2.6.0 Privacy: read receipts, typing indicators, screen security
- [x] 2.7.0 Media: swipe between pictures, video speed, shared media per chat
- [x] 2.8.0 Phone feel: swipe to reply, hold for the menu, haptics
- [x] 2.9.0 People: friend QR codes, Note to self
- [x] 2.10.0 Picture-in-picture calls (Android, computers)
- [x] 2.10.1 Double-tap to react, hold chats, new-message counts
- [x] 2.10.2 Screen off at your ear, call timer
- [x] 2.10.3 Album grids
- [x] 2.10.4 Polls in direct messages and groups
- [x] 2.10.5 Full-screen calls on phones
- [x] 2.10.6 Link previews in direct messages (opt-in, made by the sender)
- [x] 2.10.7 Jump to a date; open older search results
- [x] 2.10.8 Chat folders
- [x] 2.10.9 Contact profiles
- [x] 2.10.10 Stickers in direct messages
- [x] 2.10.11 Reply privately to group messages
- [x] 2.10.12 Bug sweep: seven audits (server, DM logic, main process, voice and calls, phone native, messaging UI, phone layout), all fixes released together
- [x] 2.11.0 Android rings and notifies like a phone (call screen over the lock screen, ringtone, heads-up over other apps, lock-screen message notifications that light the screen, Stay connected on by default with a watchdog); Android updates itself; desktop installs updates by itself when idle; second sweep (social, settings/account, community admin, encryption trust, 2.10.12 regressions)
- [x] Maintainer created the permanent Android signing key (2026-10-17): releases from 2.11.1 install over each other
- [ ] iPhone ringing and notifications while closed: needs Apple push (PushKit/CallKit) and a paid Apple developer account
- [x] 2.11.1 Calls answered or declined on another device stop the others ringing; ringing stops when the caller hangs up even with the screen off; phone-style call screens
- [x] Trust audit: identity changes, own-device copies, community key proofs, stuck rotations, v2 associated data (receiving), call-signal replays, username holds and River ID tombstones (CRYPTOGRAPHY.md §4b)
- [x] 2.12: seal community messages and profiles with v2 associated data (`SEAL_V2_DEFAULT = true` in `sealed.ts`) once 2.11 is out on every platform
- [x] 2.14: refuse community keys without a proof (`ACCEPT_UNPROVEN_KEYS = false` in `community-service.ts`; done in 2.18)
- [ ] Idempotent channel resend: `send` takes the outbox id so a reply lost while going offline cannot post twice (needs server de-duplication)
- [x] Channel history: main returns `hasMore` (and where the next page starts) so pages of undecryptable messages do not end the history early; messages sharing a time at a page boundary are no longer skipped
- [ ] Decide: bind River IDs to identity keys so an ID cannot be registered first on another server (architecture decision for the maintainer)
- [x] Android rings and notifies like a phone: call screen over the lock screen, ringtone, CallStyle notifications, Stay connected on by default, watchdog, restart after reboot, honest Settings state (unreleased)
- [ ] Check on real phones: Android Back, picture-in-picture, proximity, lock-screen calls, the new call screen and ringtone, Stay connected with the screen off for an hour, battery and full-screen prompts, iPhone core recovery (native code first compiled in CI)
- [ ] Picture-in-picture for calls on iPhone (needs AVPictureInPictureController with a video call source)
- [ ] Check the message box stays above the keyboard on Android 15+ (edge-to-edge) on a real phone
- [ ] More interface languages (English and Bulgarian today)

## 1.0.0 — Stage 1 release

- [x] Channel categories (encrypted names), drag-and-drop ordering of channels and categories, collapsible categories
- [x] Unread markers that survive restarts (last-read times kept in the local encrypted database)
- [x] Release-key hardening plan (docs/security/release-signing.md); the steps themselves need the maintainer
- [x] README, Home and docs describe the finished Stage 1

## 1.0.x — Make River the only app you need (maintainer request, 2026-10-10)

Each line is one PR; each version ships when its section is done.

### 1.0.1 — Sound and motion

- [x] Sound library: send, receive, mention, reaction, voice join/leave, call connected/ended, community joined, friend request/added, copied, error; volume and per-group toggles
- [x] Every interaction plays its sound (community and DMs)
- [x] Motion: sent/received messages, reaction pop, mention flash, voice join, speaking ring, celebration on joining/adding a friend, badge bounce; reduced motion respected

### 1.0.2 — Easy start

- [x] Create a community in one step, with templates (Friends, Gaming, Study, Club) and an icon
- [x] Paste an invite link anywhere (or have it detected on the clipboard) to join
- [x] Welcome screen for new members, helpful empty states, invite button always at hand

### 1.0.3 — Friends made simple

- [x] Friends page: Online, All, Pending, Blocked tabs with presence
- [x] Friend codes/links you can share; one-click add; request alerts with sound
- [x] Mutual communities and quick Message/Call on every friend

### 1.0.4 — Highlighting

- [x] Mention autocomplete for people, roles, @everyone and @here
- [x] Mentioned messages highlighted; role mentions and @everyone respect permissions
- [x] "New messages" divider, jump to reply/pin/search result with a flash, mention counts kept across restarts

### 1.0.5 — Stability

- [x] Clear connection banner with automatic reconnect and backoff
- [x] Messages queue while offline: sending, failed, retry
- [x] Post-install health check: detect a crash loop after an update and pause auto-install
- [x] Plain-language errors everywhere

### 1.0.6 — Roles and permissions parity

- [x] Category permissions; channels synced to their category
- [x] Hoisted roles (shown separately), mentionable roles, role colours in chat
- [x] Per-community nicknames; timeouts; audit log

### 1.0.7 — Channels parity

- [x] Announcement channels; slowmode; channel topic in the header
- [x] Threads in text channels

### 1.0.8 — Voice parity

- [x] User limits on voice channels; video grid and focus view
- [x] Mic test in settings; clearer speaking indicators

- [x] River Host: server and tunnel start with Windows; apps follow the server to its new address
- [x] Start River at sign-in; keep running in the tray

### 1.0.9 — Polish

- [x] Compact mode; quick switcher (Ctrl+K); keyboard shortcuts panel
- [x] Accessibility and performance pass; security review of 1.0.x

### 1.0.10 — Hosting status and quick menus

- [x] "Hosting on this PC" in Settings → System; right-click menus; mark read/unread

### 1.0.11 — Hosting built into River

- [x] The River server runs inside the app (no separate install); data in a permanent folder with daily backups
- [x] Public address opens by itself (verified cloudflared); members follow it automatically
- [x] Starts with the PC, keeps running in the tray, optional keep-awake; warns before going offline
- [x] "Host it on this PC" is the default when you start a community; adopts an existing River Host

### 1.0.12 — One River for everyone

- [x] Accounts created automatically on River's built-in home server; communities go there by default
- [x] Server operator Admin: people, communities, timeouts, bans, removal
- [x] Invite friends to communities from the friends list; join from the message
- [x] Hosting hidden from people who do not host; the host PC takes over River Host by itself

### 1.0.13 — Usernames, not IDs

- [x] Pick an @username at setup; change it in Settings → Account
- [x] Add friends by @username (links and IDs still work)
- [x] Operator can create accounts (sign-up links) and set the server invite-only

### 1.0.16 — Voice that stays connected (maintainer report, 2026-10-11)

- [x] Server keeps a voice seat for 45 s after a dropped connection; the app rejoins by itself
- [x] Client and server heartbeats; signals queued while offline; presence grace
- [x] Self-healing peer connections (ICE restart, unlimited backoff, ordered signals, stale-answer guard)
- [x] Tests: simulated mesh of 4–6 people, lost offers/answers, blips, failing paths; real-socket reconnect tests

- [x] Encrypted voice relay through the River server when two members cannot connect directly (real-app e2e with direct paths blocked)
- [x] Connection check in Settings → System (relay, account, server, live connection, NAT type, microphone)
- [x] Startup never fails silently; window/GPU fallbacks; `--self-test` run on the packaged app in CI and releases

### 1.0.17 — Calls everywhere

- [x] Relay for 1:1 direct-message calls (private call rooms, 1.0.16)
- [x] Connection details per person (direct / relayed, ping, packet loss) in the voice panel (1.0.19)
- [ ] Fresh-install walkthrough on a clean Windows VM (needs a VM or a second PC)

### 1.0.17 – 1.0.21 — Parity, shipped

- [x] Presence and custom status, Markdown, every emoji, message links, quote/forward (1.0.17)
- [x] Events, polls, mutes, folders, richer profiles, account deletion, appearance (1.0.18)
- [x] Custom emoji, saved messages, ownership transfer, connection bars (1.0.19)
- [x] Back/forward, search filters, jump to date, quiet hours, drafts, duplicates, emoji rename/favourites, server deafen, input sensitivity (1.0.20)
- [x] Reports, ban cleanup, role icons, alt text, cancel upload, member since (1.0.21)

### 1.0.22 – 1.0.23 — Voice spaces, your data, safer links (shipped)

- [x] Soundboard, forum channels, stage channels, temporary bans, keybind editor (1.0.22)
- [x] Export my data, sender-made link previews, moderator notes, reaction notifications (1.0.23)

### 1.0.24 – 1.0.31 — Parity, shipped

- [x] Rules and onboarding, self-assignable roles, stickers, bulk message delete, audit log filters (1.0.24)
- [x] Slash commands, followed threads, avatar crop, per-community picture, screen share quality, group icons, favourite GIFs (1.0.25)
- [x] Media channels, entrance sounds, leave voice when alone, conversation mutes, insights, access check (1.0.26)
- [x] Language setting with Bulgarian (beta), age-restricted channels, role mention details (1.0.27)
- [x] Word filter and suspicious link warnings (1.0.28)
- [x] Community picture and banner, DM and group pins, call notices (1.0.29)
- [x] Drag to reorder roles, temporary roles (1.0.30)
- [x] Invite tracking and revoke (1.0.31)

### 1.0.32 – 1.0.40 — Finish 1.0.x

- [x] End-to-end-encrypted incoming webhooks, design first (ADR 0004) (1.0.32)
- [x] Priority speaker (1.0.33)
- [x] Animated avatars, rejoin a call that ended unexpectedly (1.0.34)
- [x] Push-to-talk sounds, right-click menus on categories and roles (1.0.35)
- [x] More Bulgarian translation (1.0.36)
- [x] Bulk role changes, smoother chat rendering (1.0.37)
- [x] Screen reader announcements for new messages (1.0.38)
- [x] Move members between voice channels; docs, parity audit and STATUS refreshed for the end of 1.0.x (1.0.39)
- [x] Final 1.0.x polish release: what's new after an update, changelog links (1.0.40)

### 1.0.41 — Calls that stay up, invites anyone can follow

- [x] Voice: people stay in the call while their connection is rebuilt (chaos e2e, 10 people)
- [x] Account recovery when the server no longer knows the account
- [x] Invite page with downloads and "Open in River" (river:// links)
- [x] Permanent link address (GitHub Pages) and version-less installer downloads

### 1.0.42 — Discord-style layout

- [x] One rail: Home, communities, create or join, Admin (host only)
- [x] Home sidebar: search, Friends, Social, Calls, Files, direct messages, user panel
- [x] Settings as a full-window overlay with every tab in one list (Security moved in)
- [x] Thin title bar with the connection status; solid layered colours
- [x] e2e and accessibility checks updated for the new navigation

### 1.0.43 — Permanent address and code signing

- [x] Tailscale Funnel as the hosting address when Tailscale is signed in; quick tunnel as fallback
- [x] Hosting panel steps (download, sign in, allow) and automatic switch-over
- [x] SignPath Foundation signing in the release workflow (off until accepted), latest.yml/blockmap rewrite
- [x] Code signing policy (CODE_SIGNING.md), README and invite page links, PRIVACY.md brought up to date
- [ ] Maintainer: install Tailscale on the hosting PC and sign in (then River switches by itself)
- [ ] Maintainer: apply to SignPath Foundation; add SIGNPATH_API_TOKEN and SIGNPATH_ORGANIZATION_ID when accepted

### 1.0.44 — Calls proven at scale

- [x] Voice field test over the internet (host PC + GitHub machines in another country)
- [x] Fix: stale relay after a server reconnect left a person unheard
- [x] 16 people, 65 minutes, Bulgaria ↔ USA: nobody dropped, 14.95–15 of 15 heard on average

### 1.0.45 — Skins, themes and personalisation

- [x] Theme engine with design tokens; 14 skins, 107 themes; contrast guaranteed
- [x] Appearance centre: browser with previews and try-on, colours, type, layout, components, effects, background, motion, profiles, import/export
- [x] All component styles on tokens (no theme colours hard-coded)
- [ ] Contextual appearance (per community / activity)
- [ ] Faster relayed-voice recovery after a server reconnect (field test: ~45 s gaps when every voice is relayed)
- [x] Re-send relay keys when a pair stays silent (1.4.0)

## 1.1.x — River for Android (ADR 0005)

### 1.1.0 — Android

- [x] Client core runs outside Electron (shims over one native interface), tested against a real server and the desktop
- [x] Android app: core in its own WebView; libsignal-android, SQLCipher, Android Keystore, notifications, deep links
- [x] Phone layout (one pane at a time), River icons
- [x] CI: APK build and emulator end-to-end test
- [x] Released as a preview (APKs signed with a one-off key)
- [ ] Permanent signing key (maintainer runs `python scripts/release/create-android-key.py`)
- [ ] Voice in the Android WebView verified on a real phone (microphone permission, audio routing)

### 1.9.x — Hardening (released in 1.9.0)

- [x] Stage 2 security review (docs/security/1.9.0-review.md); all findings fixed; threat model updated
- [ ] Independent audit (needs the maintainer and funding)

### 1.8.x — Remote assistance (ADR 0007, released in 1.8.0)

- [x] Consent asked by main before every screen share; no default screen
- [x] Always-on-top "can see your screen" bar with Stop, outside the window; comes back if it crashes
- [x] Pointing: viewers point at the shared screen, the sharer sees a ring
- [ ] Control (separate per-session grant, hardware-key stop) — needs OS input injection; not before its own review

### 1.7.x — Calls (released in 1.7.0)

- [x] Incoming 1:1 calls notify while River is in the tray or closed (with Stay connected); opening River shows the ringing call
- [x] Calls keep going with the screen off on Android (1.4.0)
- [ ] Android ConnectionService / iOS CallKit: the system's own incoming-call screen and audio routing

### 1.4.x — Phones, day to day (released in 1.4.0)

- [x] Background reconnect: Stay connected (Android foreground service; no Google/Apple push)
- [x] Calls with the screen off (Android "In a call" service), replies from notifications
- [x] Share → River, biometric lock (Lock River), long-press menus, swipe between panes
- [ ] Content-free push through UnifiedPush (optional, for people who run a distributor)
- [x] Speaker / earpiece on phones (2.0.1); Bluetooth follows the system

## Protocol freeze and security (1.5.x, released in 1.5.0)

The freeze work was done ahead of its slot because the phone apps need a fixed
contract. Version plan (see ROADMAP): Android 1.1.x, devices 1.2.x, iPhone
1.3.x, phones day to day 1.4.x.

- [x] JSON Schema of every wire message frozen as `packages/protocol/schema/v1.json`, drift fails CI
- [x] Cross-language test vectors for identity, fingerprints, words, safety numbers, signatures
- [x] Stability rules (docs/protocol/stability.md)
- [x] Test vectors for attachments (Signal attachment format), backup format and device-list signing
- [x] Message-level spec docs: realtime events and voice relay frames (docs/protocol/realtime.md); community key epochs, groups and call signalling are specified in CRYPTOGRAPHY.md §4–§8 and docs/protocol/messaging.md (groups are pairwise, not sender keys — fixed in the docs)
- [x] Capability list in `GET /v1/version` so clients can feature-detect new optional request fields (request schemas are strict)
- [x] Identity-bound call setup: community call signals signed with the sender's identity key, required for people libsignal holds a key for, fresh within 10 minutes (CRYPTOGRAPHY.md §8, 1.5.0)
- [ ] Release-key hardening steps (protected `release` environment with manual approval) — needs the maintainer

## 1.3.x — iPhone (released in 1.3.0)

- [x] iOS app: the shared core in its own WKWebView; libsignal, SQLCipher, Keychain; deep links; Lock River
- [x] CI: simulator build and start-up self-test; unsigned .ipa in the release
- [ ] Signed App Store / TestFlight builds — needs an Apple developer account (maintainer decision)
- [ ] CallKit for calls with the screen locked

## 1.2.x — Devices (ADR 0006, released in 1.2.0)

- [x] Removed devices lose their open connection; device-list version floors (1.3.1, own review)
- [x] Link mailbox: the offering device reserves the slot; unreserved slots capped per address (1.5.0)
- [x] "Is this you?" step showing the account name before a new device adopts it (1.5.0)
- [x] Friends list and blocks copied to new devices and kept in step (1.6.0)

- [x] Link a device with a code from a linked device (secret-bound hello and provisioning, HPKE)
- [x] Signed device-list updates on the server (versioned, keys never change), removal signs a device out
- [x] Direct messages to every device; sent messages copied to the account's other devices
- [x] Settings → Account → Devices; onboarding “link this device”
- [x] QR code for the link (1.2.0)
- [x] Device names in the device list, kept on the devices and shared between them (2.0.3)
- [ ] Copy history to a new device (device-to-device transfer)

### After 1.0.x (not started; see ROADMAP Stage 2)

- [ ] Bot accounts with a small client library (ADR 0004)
- [ ] PDF preview without loading a PDF engine into the untrusted renderer
- [ ] Mutual friends — needs a private-set-intersection design; contacts never leave the device today
- [ ] Screen-share audio — needs echo-safe system audio capture on every platform

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
- [x] Multi-device linking (1.2.0)

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
- [x] Direct messages and friends (libsignal 1:1 sessions, 0.5.0)
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
- [x] Device list updates with a monotonic version (`PUT /v1/accounts/me/devices`, 1.2.0)
- [ ] Session refresh before expiry; reconnect on network change
- [ ] Delete account (server-side) and leave server (client-side)

## Later in 0.0.x / ongoing

- [ ] Optional passphrase lock on systems that do have an OS keystore (app lock)
- [ ] Change / remove passphrase in Settings
- [ ] Post-install health check: detect crash loop after an update and pause auto-install
- [ ] `dev-app-update.yml` for local updater testing
- [ ] Bundle spellcheck dictionaries (Chromium's Linux spellchecker is disabled for privacy)
- [x] Release-key hardening plan (hardware key / threshold) — docs/security/release-signing.md
