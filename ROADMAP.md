# River Roadmap

River ships in two stages. Every release must contain a meaningful, tested
change; version numbers are never bumped just to move forward. The version
lists below are a plan, not a promise — a milestone may take more or fewer
patch releases.

Legend: ✅ released · 🔨 in progress · ⏳ planned

## Stage 1 — Desktop platform (0.0.1 → 1.0.0)

Windows, macOS, Linux. Messaging + groups + communities + social + media +
files + calls, all end-to-end encrypted.

| Series    | Theme                          | Contents                                                                                                                                                                                                                                       |
| --------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0.0.x** | Foundation                     | Repo, docs, CI, signed auto-update, desktop shell, server skeleton, encrypted local DB, cryptographic identity                                                                                                                                 |
| **0.1.x** | Accounts                       | Registration without phone/e-mail, device auth, signed device lists, profiles, contacts, privacy settings, recovery phrase                                                                                                                     |
| **0.2.x** | Encrypted direct messages      | Prekeys, libsignal sessions, realtime delivery, offline mailbox, conversation UI, drafts, unread, typing, delivery/read receipts. _Messages are end-to-end encrypted from the very first one — River never ships a plaintext messaging phase._ |
| **0.3.x** | Messaging depth + verification | Replies, reactions, edit, delete, forward, mentions, pins, local search, voice messages, saved messages; safety numbers, QR verification, key-change warnings, sealed sender, Security Center                                                  |
| **0.4.x** | Groups                         | Sender-key groups, admins, invites, large groups, polls, stickers/GIFs (local), broadcast channels                                                                                                                                             |
| **0.5.x** | Media & files                  | Encrypted attachments (images, video, audio, documents), local thumbnails, River Files vault (folders, favourites, recent, shared), previews                                                                                                   |
| **0.6.x** | Communities                    | Communities, text/voice/announcement/discussion/private channels, roles, permissions, moderators, invites, bans, mutes, threads, pinned content                                                                                                |
| **0.7.x** | Social                         | Profiles with posts, photos, videos, stories, reactions, comments, followers/friends, feeds, collections, galleries, audience controls, share-to-chat                                                                                          |
| **0.8.x** | Calls                          | 1:1 voice/video, group calls (SFU + frame E2EE), voice channels, screen sharing, device selection, call history, quality indicators                                                                                                            |
| **0.9.x** | Integration & hardening        | Desktop multi-device linking, notifications, accessibility, performance, migrations from every 0.x, full security review, documentation                                                                                                        |
| **1.0.0** | **Stage 1 release**            | Complete desktop platform                                                                                                                                                                                                                      |

### Path to 1.0.0 (current plan, updated 2026-10-09)

Communities shipped earlier than the series table assumed (0.2.0–0.3.0), so the
remaining Stage 1 work is ordered by what people need to replace their other
apps. Each line is one minor release; patch releases fix things in between.

| Version    | Deliverable                                                                                                      | Status |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| 0.2–0.3 ✅ | Communities: text/voice/video/screen share, roles, permissions, moderation, reactions, pins, notifications       | done   |
| 0.4.0      | Encrypted attachments: files, images, video and audio in channels (Signal attachment format), drag & drop, paste | ⏳     |
| 0.5.0      | Contacts and encrypted direct messages (libsignal prekeys + sessions, offline mailbox, read receipts), 1:1 calls | ⏳     |
| 0.6.0      | Group DMs (sender keys); per-member community keys with rotation when someone is removed                         | ⏳     |
| 0.7.0      | Social: encrypted profiles, posts and photos feed, stories for friends, comments and reactions                   | ⏳     |
| 0.8.0      | Multi-device linking, recovery phrase and encrypted backup                                                       | ⏳     |
| 0.9.0      | Hardening: TURN relay, message search, accessibility, performance, migrations from every 0.x, security review    | ⏳     |
| 1.0.0      | Stage 1 release                                                                                                  | ⏳     |

1.0.0 is released only when all of the above work, tests pass on all three
desktop platforms, and no critical security issue is open.

### First 10 concrete milestones

| #   | Version  | Deliverable                                                                                                                                              | Done when                                                                   |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | 0.0.1 ✅ | Repository, architecture docs, CI, desktop shell with River design language, **signed auto-updater with stable/beta/nightly channels**, release pipeline | Tagged release installs on Windows/macOS/Linux and later releases update it |
| 2   | 0.0.2 ✅ | River server skeleton: config, Kysely (SQLite/Postgres), migration framework, health/version endpoints, Docker image; protocol package                   | Server tests + container build in CI                                        |
| 3   | 0.0.3 ✅ | Encrypted local database (SQLCipher, keystore-wrapped key), client migration framework with backup-before-migrate                                        | Upgrade test from empty → v1 schema; tamper/wrong-key tests                 |
| 4   | 0.0.4 ✅ | Cryptographic identity: identity key, fingerprint, verification words, onboarding flow (no phone/e-mail)                                                 | Test vectors for fingerprints; key never crosses IPC                        |
| 5   | 0.1.0 ✅ | Account registration + device challenge–response auth + signed device list                                                                               | Integration tests client ↔ server                                           |
| 6   | 0.1.1    | Encrypted profiles (name, bio, avatar, links)                                                                                                            | Server stores only ciphertext for private fields                            |
| 7   | 0.1.2    | Contacts: username lookup (privacy-gated), requests, block                                                                                               | Abuse/rate-limit tests                                                      |
| 8   | 0.1.3    | Privacy settings model (who can find / message / add / call …) enforced server-side where needed                                                         | Authorization tests                                                         |
| 9   | 0.1.4    | Recovery phrase + encrypted backup                                                                                                                       | Restore test on fresh profile                                               |
| 10  | 0.2.0    | Prekeys, libsignal sessions, realtime WebSocket delivery, first encrypted 1:1 message                                                                    | Two-client E2E test; server DB contains no plaintext                        |

## Stage 2 — Full ecosystem (1.0.x → 2.0.0)

Windows, macOS, Linux, iOS, Android, all with the full feature set plus
consent-based remote assistance.

| Series    | Theme                           | Contents                                                                                                                                            |
| --------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.0.x** | Stabilisation                   | Fixes from 1.0 feedback, performance                                                                                                                |
| **1.1.x** | Protocol freeze                 | Protocol v1 spec, protobuf schemas, cross-language test vectors, API stability guarantees                                                           |
| **1.2.x** | Devices                         | Device-to-device transfer, device approval UX, key rotation tooling, revocation                                                                     |
| **1.3.x** | iOS foundation                  | SwiftUI app, libsignal-swift, Keychain/Secure Enclave, onboarding, messaging (TestFlight)                                                           |
| **1.4.x** | Android foundation              | Compose app, libsignal-android, Keystore/StrongBox, onboarding, messaging (APK + F-Droid track)                                                     |
| **1.5.x** | Mobile parity I                 | Groups, media, files; content-free push (APNs, FCM, UnifiedPush); biometric lock                                                                    |
| **1.6.x** | Mobile parity II                | Communities, social feed, stories, camera                                                                                                           |
| **1.7.x** | Mobile calls                    | CallKit / ConnectionService, group calls on mobile                                                                                                  |
| **1.8.x** | Remote assistance               | Consent-based remote support: session request/code, view, control, clipboard, file transfer, always-visible indicator, instant termination, history |
| **1.9.x** | Cross-platform sync & hardening | Full multi-device sync across desktop and mobile, migrations from every 1.x, security review                                                        |
| **2.0.0** | **Stage 2 release**             | Complete cross-platform ecosystem                                                                                                                   |

After 2.0.0: regular semantic versioning (2.0.1, 2.1.0, …). Every release is
delivered to installed clients through the signed update channel.

## Open decisions that need the maintainer

| Decision                         | Needed by                                                                   | Notes                                                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public server hosting            | 0.1.0                                                                       | Messaging needs a reachable server. Options: maintainer-hosted instance, community instances, or self-host only. River works with any of them (server URL is configurable). |
| Apple Developer ID ($99/yr)      | before relying on macOS auto-install; required for iOS App Store/TestFlight | Without it: macOS gets notify-and-download updates; iOS limited to sideloading/AltStore/EU marketplaces                                                                     |
| Windows code-signing certificate | optional                                                                    | Removes SmartScreen warning; River's own update signatures already protect updates                                                                                          |
