# River 1.0 parity status (audit of parity-checklist.md)

Last audited: **2026-10-13**, against releases up to 1.0.32 and the 1.0.33–1.0.38 work.
Status: ✅ done · 🔨 partial · ⏳ to do · 🔒 privacy-preserving equivalent ·
✖ not planned (reason given). Each ✅ is backed by code and tests; the tests
are named where it helps. This file is updated with every release.

## 1. Account creation, identity and profile

| Item                                           | Status  | Notes                                                                                                                          |
| ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Registration / login                           | 🔒      | No e-mail or password: an identity key on your device, account created automatically (1.0.12); session by device-key challenge |
| E-mail confirmation, password reset, DOB       | 🔒      | No e-mail/password/DOB collected by design; recovery is the 18-word phrase + encrypted backup                                  |
| Session persistence, logout                    | ✅ / 🔨 | Sessions persist; "log out" = lock (passphrase) or delete account (1.0.18); per-device sign-out ⏳ with linked devices (1.2)   |
| Account recovery                               | ✅      | Recovery phrase + encrypted backup/restore (0.8)                                                                               |
| Suspicious-login challenges                    | 🔒      | No passwords to guess; every session needs the device key                                                                      |
| Account deletion                               | ✅      | 1.0.18, device-key proof; deactivation ✖ (deletion or leaving communities covers it)                                           |
| Unique ID, username availability, display name | ✅      | River ID, @username (1.0.13), display name                                                                                     |
| Avatar, crop/preview                           | ✅      | Crop and zoom dialog (1.0.25)                                                                                                  |
| Animated avatar                                | ✅      | Small GIFs stay animated (1.0.34); a still frame with reduced motion                                                           |
| Banner, profile colour, bio, pronouns          | ✅      | 1.0.18 (banner colour, About me, pronouns), encrypted                                                                          |
| Decorations, badges, effects                   | ✖       | Paid cosmetics; not in River's model                                                                                           |
| Account creation date                          | 🔨      | Member since (per community, 1.0.21)                                                                                           |
| Online / idle / DND / invisible                | ✅      | 1.0.17, auto-idle                                                                                                              |
| Custom status, emoji status, expiry            | ✅      | 1.0.17, encrypted                                                                                                              |
| Playing/listening activity                     | 🔒 ⏳   | Would require process/app tracking; opt-in manual "activity" could come later                                                  |
| Per-community nickname                         | ✅      | 1.0.6                                                                                                                          |
| Per-community avatar                           | ✅      | 1.0.25                                                                                                                         |
| Profile popover, full profile                  | ✅ / 🔨 | Popover from member list and chat (1.0.17); separate full-profile page ⏳                                                      |
| Mutual friends / communities                   | 🔨      | Mutual communities ✅ (Friends page); mutual friends ⏳                                                                        |
| Shared roles, message/add-friend/block buttons | ✅      | Profile card                                                                                                                   |
| Report button                                  | ✅      | Report a message to the community’s moderators (1.0.21)                                                                        |
| Copy user ID, context menu                     | ✅      | Copy ID on the profile card (1.0.19)                                                                                           |
| Change e-mail/password, 2FA, backup codes      | 🔒      | No password: device key + optional passphrase lock; recovery phrase = backup codes                                             |
| Active devices / sessions management           | 🔨      | Device count shown; management with linked devices (1.2)                                                                       |
| Login alerts, security notifications           | 🔨      | Safety-number change warnings ✅; new-device alerts with linked devices                                                        |

## 2. Friends, contacts and direct messages

| Item                                                                         | Status | Notes                                                                               |
| ---------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| Send/accept/reject/cancel/remove, incoming/outgoing, pending                 | ✅     | Friends page tabs (1.0.3)                                                           |
| Request limits, duplicates, blocked requests                                 | ✅     | Server abuse limits; duplicate requests collapse                                    |
| Search / sort / online filter                                                | ✅     | Online/All/Pending/Blocked, with search                                             |
| Username search, ID lookup, invite-based discovery                           | ✅     | 1.0.13                                                                              |
| Display-name discovery                                                       | 🔒     | Display names are encrypted; usernames are the public handle                        |
| Contact syncing                                                              | 🔒     | Never uploads contacts                                                              |
| Favorites                                                                    | ✅     | Favourite emoji (1.0.20) and GIFs (1.0.25)                                          |
| Last-active visibility                                                       | 🔒     | Not stored                                                                          |
| DM: send/edit/delete/reply/react/pin?                                        | ✅     | DM and group pins (1.0.29)                                                          |
| Quote, forward, copy, copy link, jump, mark unread                           | ✅     | Channels (1.0.17); forward from DMs (1.0.23)                                        |
| Report message                                                               | ✅     | Community messages (1.0.21); DMs: block instead                                     |
| Multiline, Enter/Shift+Enter, drafts                                         | ✅     | Per-channel drafts while open (1.0.20); on-disk drafts 🔒 (would store unsent text) |
| Emoji picker                                                                 | ✅     | 1.0.17 (+ custom emoji 1.0.19)                                                      |
| GIF picker                                                                   | 🔒     | Favourite any GIF or picture and send it again (1.0.25); no outside GIF service     |
| Sticker picker                                                               | ✅     | Community stickers (1.0.24)                                                         |
| Attachments, paste, drag-and-drop                                            | ✅     | 0.4                                                                                 |
| Link previews                                                                | 🔒     | Opt-in, made by the sender, public addresses only (1.0.23)                          |
| Markdown, code, quotes, headings, lists, spoilers                            | ✅     | 1.0.17                                                                              |
| Image/video/audio/document attachments, size, progress, retry                | ✅     | Cancel upload and alt text (1.0.21)                                                 |
| Message states (sending/sent/failed/retrying/edited/deleted)                 | ✅     | Outbox (1.0.5)                                                                      |
| New-message divider, unread, typing, read receipts (DM)                      | ✅     |                                                                                     |
| Search conversation, load older, newest button, scroll-to-bottom             | ✅     | Jump to date ✅ (1.0.20)                                                            |
| Close/hide DM, group DMs (create, rename, icon, add/remove, leave)           | ✅     | Group icons (1.0.25)                                                                |
| Who can message you, message requests, blocks                                | ✅     |                                                                                     |
| Spam filtering, suspicious links                                             | ✅     | Warnings for look-alike, raw-IP, shortened and http links; word filter (1.0.28)     |
| DM calls: start/answer/decline/hang up/duration/ringing/missed/camera/screen | ✅     | 1:1 calls via relay too (1.0.16)                                                    |
| Rejoin ongoing call                                                          | ✅     | Rejoin offer after a call ends unexpectedly (1.0.34)                                |
| Message context menu                                                         | ✅     | Report (1.0.21), save, forward; translate ✖ (would send text to a service)          |

## 3. The chat interface

| Item                                      | Status | Notes                                                                                       |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| Hover toolbar, timestamps, reactions      | ✅     |                                                                                             |
| Avatar/name click → profile               | ✅     | 1.0.17                                                                                      |
| Click timestamp → copy link               | ✅     | 1.0.17                                                                                      |
| Reactions add/remove, who reacted         | ✅     | View reactions (1.0.18)                                                                     |
| Reply preview → jump                      | ✅     |                                                                                             |
| Attachment click → viewer                 | ✅     | Zoom/pan/copy (1.0.18)                                                                      |
| Channel/user/role mentions clickable      | ✅     | Role details on hover/focus (1.0.27)                                                        |
| Invite link preview & join flow           | ✅     |                                                                                             |
| Right-click everywhere                    | ✅     | Messages, channels, categories and roles (1.0.35), communities, members, voice participants |
| Paste images, drag files                  | ✅     |                                                                                             |
| Scroll restore after navigation           | ✅     | 1.0.18                                                                                      |
| Jump to latest / unread / reply origin    | ✅     |                                                                                             |
| Date separators, relative times, grouping | ✅     |                                                                                             |
| Expand/collapse long messages             | ✅     | Show more / Show less (1.0.19)                                                              |
| Spoilers, highlighted code + copy         | ✅     | 1.0.17                                                                                      |
| Embeds with loading/failed states         | 🔒     | Sender-made previews (1.0.23)                                                               |
| Empty/loading/error/permission states     | ✅     |                                                                                             |

## 4. Formatting, reactions and expression

| Item                                              | Status | Notes                                                                 |
| ------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| Emoji picker, search, recent, categories          | ✅     | Favourites (1.0.20)                                                   |
| Custom emoji: upload, rename, delete, permissions | ✅     | 1.0.19; rename 1.0.20                                                 |
| Animated custom emoji                             | ✅     | Small GIFs kept as-is                                                 |
| Stickers                                          | ✅     | 1.0.24: upload, picker, send, permissions, limit 60                   |
| GIFs                                              | 🔒     | Favourites (1.0.25), see §2                                           |
| Multiple reactions, counts, removal, user list    | ✅     |                                                                       |
| Super reactions                                   | ✖      | Paid feature                                                          |
| Markdown incl. escaping, malformed fallback       | ✅     |                                                                       |
| Timestamps `<t:…>`, message links, channel refs   | ✅     |                                                                       |
| Soundboard                                        | ✅     | 1.0.22: upload, rename, emoji, preview, volume, cooldown, permissions |

## 5. Communities

| Item                                                  | Status | Notes                                                                                  |
| ----------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| Create with name, icon, template, channels            | ✅     | 1.0.2                                                                                  |
| Join by invite, preview                               | ✅     |                                                                                        |
| Discovery / public listing                            | ✖ / ⏳ | Communities are private and encrypted; an opt-in directory would need a public profile |
| Rules screening, onboarding questions, welcome screen | ✅     | Rules screening and welcome note (1.0.24); role picker after accepting                 |
| Leave, rejoin, new invites, expiry & usage limits     | ✅     |                                                                                        |
| Icon, name, description, banner, splash               | ✅     | Picture and banner, end-to-end encrypted (1.0.29)                                      |
| Scheduled events, RSVP, reminders, cancel, delete     | ✅     | 1.0.18                                                                                 |
| Announcement channels                                 | ✅     | Following across communities ⏳                                                        |
| Ownership transfer                                    | ✅     | 1.0.19, owner only, audited                                                            |
| Server deletion with confirmation                     | ✅     |                                                                                        |
| Templates                                             | ✅     |                                                                                        |
| Insights / analytics                                  | 🔒     | Counted on the device (1.0.26)                                                         |

## 6. Navigation, channels and categories

| Item                                                                | Status | Notes                                          |
| ------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| Server icons, unread, mention badges, active indicator              | ✅     |                                                |
| Drag-and-drop server order, folders (create/rename/colour/collapse) | ✅     | 1.0.18                                         |
| Categories create/rename/reorder/collapse/delete/permissions        | ✅     | 1.0.0/1.0.6                                    |
| Text, voice, announcement channels                                  | ✅     | Forum, stage (1.0.22), media (1.0.26)          |
| Duplicate channel                                                   | ✅     | 1.0.20                                         |
| Topic, slowmode, per-channel notifications, permissions             | ✅     | Age-restricted channels (1.0.27)               |
| Private channels, synced/unsynced overrides                         | ✅     |                                                |
| Channel search, unread navigation, recent history                   | ✅     | Quick switcher, Alt+Shift+↑/↓                  |
| Muted / locked indicators                                           | ✅     | 1.0.18                                         |
| Confirm before deleting populated channel                           | ✅     |                                                |
| Restore navigation after restart                                    | ✅     | Last channel per community remembered (1.0.19) |

## 7. Roles and permissions

| Item                                                 | Status  | Notes                                                                                          |
| ---------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| Create/edit/delete roles, colour, hoist, mentionable | ✅      | Duplicate (1.0.20), icons (1.0.21)                                                             |
| Drag-and-drop hierarchy                              | 🔨      | Up/down arrows today                                                                           |
| Assign/remove, view members                          | ✅      | Bulk via self-roles; bulk moderator assign ⏳                                                  |
| Self-assignable / reaction roles                     | ✅      | Self-assignable roles (1.0.24)                                                                 |
| Temporary roles                                      | ✅      | 1 hour to 30 days, server-enforced expiry (1.0.30)                                             |
| Hierarchy enforcement, owner protection              | ✅      | Server-side                                                                                    |
| View as role / effective permission explainer        | ✅      | Check someone’s access, and why (1.0.26)                                                       |
| Permission categories                                | 🔨      | 23 permissions incl. events and emoji; threads/forums/apps follow those features               |
| Evaluation rules 1–12                                | ✅ / 🔨 | Discord's algorithm, server-enforced, audited; individual member overrides ⏳; diff preview ⏳ |

## 8. Voice, audio and calls

| Item                                           | Status | Notes                                                                 |
| ---------------------------------------------- | ------ | --------------------------------------------------------------------- |
| Join/leave/move, states, participant counts    | ✅     | Reconnect-safe (1.0.16)                                               |
| Full / locked / unavailable channels           | ✅     |                                                                       |
| Device change without dropping                 | ✅     |                                                                       |
| Connection quality display                     | ✅     | Connection check ✅; per-person bars (1.0.19) ✅                      |
| Mute/deafen, devices, volumes, per-user volume | ✅     |                                                                       |
| Mic test, input sensitivity, PTT, noise/echo   | ✅     | Sensitivity slider (1.0.20)                                           |
| Server mute/deafen, move, disconnect           | ✅     | Server deafen (1.0.20)                                                |
| Speaking indicators, priority speaker          | ✅     | Priority speaker permission and toggle (1.0.33)                       |
| Camera, screen share, grid/focus, pin          | ✅     | Stream quality presets (1.0.25)                                       |
| Stream audio                                   | ⏳     |                                                                       |
| Relay when direct connection impossible        | ✅     | 1.0.16 (voice; video still direct)                                    |
| Stage channels                                 | ✅     | 1.0.22: audience, hands, invite to speak, move to audience            |
| Soundboard                                     | ✅     | 1.0.22: upload, rename, emoji, preview, volume, cooldown, permissions |

## 9. Notifications and sounds

| Item                                                               | Status  | Notes                                      |
| ------------------------------------------------------------------ | ------- | ------------------------------------------ |
| DM, request, mention, role, @everyone, reply notifications         | ✅      |                                            |
| Event reminders                                                    | ✅      | 1.0.18                                     |
| Global / per-community / per-channel overrides, mute with duration | ✅      | 1.0.18                                     |
| DND suppression                                                    | ✅      | 1.0.17                                     |
| Preview choice                                                     | ✅      |                                            |
| Mobile push, e-mail                                                | ⏳ / 🔒 | Push with mobile apps (Stage 2); no e-mail |
| Quiet hours                                                        | ✅      | 1.0.20                                     |
| Sound registry with groups and volume                              | ✅      | 1.0.1                                      |

## 10–12. Search, threads, forums, mentions

| Item                                               | Status | Notes                                                                    |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| Search channel/community on device, jump to result | ✅     | Filters from:/in:/has:/before:/after:/during:/pinned:/mentions: (1.0.20) |
| Quick switcher, recent channels                    | ✅     |                                                                          |
| Back/forward navigation                            | ✅     | Alt+←/→, ⌘[/⌘], mouse buttons (1.0.20)                                   |
| Threads from messages, replies, archive            | ✅     | Follow threads (1.0.25)                                                  |
| Forums                                             | ✅     | 1.0.22: posts with titles and tags, search, filter, sort                 |
| Mentions with autocomplete, role checks, highlight | ✅     |                                                                          |
| Mention suppression per message                    | ✅     | @ON/OFF on replies (1.0.18)                                              |
| Pins, pinned list                                  | ✅     |                                                                          |
| Bookmarks / saved messages                         | ✅     | Saved messages, on this device (1.0.19)                                  |
| Polls                                              | ✅     | 1.0.18                                                                   |

## 13–14. Moderation and audit

| Item                                       | Status | Notes                                                                     |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------- |
| Delete messages, timeout, kick, ban, unban | ✅     | Ban cleanup (1.0.21), temporary bans (1.0.22)                             |
| AutoMod keyword rules                      | 🔒 ✅  | Word filter applied by each app (1.0.28); the server cannot read messages |
| Reports, cases, mod notes                  | ✅     | Reports (1.0.21), moderator notes (1.0.23)                                |
| Audit log with actor/action/target         | ✅     | Filters and copy (1.0.24)                                                 |

## 15–17. Apps, events, growth

| Item                            | Status  | Notes                                                                                                        |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| Bots, slash commands, webhooks  | 🔨      | Built-in slash commands (1.0.25); end-to-end-encrypted incoming webhooks (1.0.32, ADR 0004); bot accounts ⏳ |
| Activities                      | ⏳      |                                                                                                              |
| Events                          | ✅      | 1.0.18                                                                                                       |
| Vanity invites, invite tracking | ✅ / ⏳ | Invite tracking and revoke (1.0.31); vanity invites ⏳                                                       |
| Paid perks                      | ✖       | Not in River's model                                                                                         |

## 18–20. Settings, motion, keyboard

| Item                                                                      | Status | Notes                                         |
| ------------------------------------------------------------------------- | ------ | --------------------------------------------- |
| Appearance: density, zoom, text size, clock, contrast, motion             | ✅     | 1.0.9/1.0.18                                  |
| Language selection                                                        | 🔨     | English; Bulgarian beta (1.0.27)              |
| Keybind editor                                                            | ✅     | Voice shortcuts with clash detection (1.0.22) |
| Shortcuts list, Ctrl+K, Ctrl+F, Esc, Alt+↑/↓, Ctrl+Alt+↑/↓, type-anywhere | ✅     | 1.0.17                                        |
| Animations with reduced motion                                            | ✅     |                                               |

## 21–25. Media, calls, security, reliability, accessibility

| Item                                                       | Status | Notes                                                                                                |
| ---------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| Attachments end to end, viewer, save                       | ✅     | PDF preview ⏳                                                                                       |
| Call state machine, reconnection                           | ✅     | 1.0.16                                                                                               |
| Rate limiting, server-side permission checks               | ✅     |                                                                                                      |
| Data export                                                | ✅     | Export my data (1.0.23)                                                                              |
| Crash recovery, startup diagnostics, self-test             | ✅     | 1.0.16                                                                                               |
| Keyboard navigation, focus, screen-reader labels, contrast | ✅     | axe audits in CI; new messages announced to screen readers (1.0.38); reduced motion holds GIFs still |
| Localization                                               | 🔨     | Framework and Bulgarian beta (1.0.27), wider coverage (1.0.36)                                       |

## 26–27. Analytics and premium

Analytics 🔒 (content is encrypted; only local, opt-in statistics would be
possible). Premium/monetization ✖ — River is free software with no paid tier.

## 28. System messages and edge cases

Join/leave and pin notices ✅; call lines in direct conversations ✅ (1.0.29);
"user moved" and "call started" notices in channels ⏳;
deleted-reply and missing-attachment states ✅; concurrent edits rely on
server last-write; double submissions are idempotent (client message IDs) ✅.
