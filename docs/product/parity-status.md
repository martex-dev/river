# River 1.0 parity status (audit of parity-checklist.md)

Last audited: **2026-10-12**, against `main` + open PRs for 1.0.18/1.0.19.
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
| Avatar, crop/preview                           | ✅ / 🔨 | Avatar with preview; manual crop ⏳ (auto centre-crop today)                                                                   |
| Animated avatar                                | ⏳      | GIF avatars resized to static today                                                                                            |
| Banner, profile colour, bio, pronouns          | ✅      | 1.0.18 (banner colour, About me, pronouns), encrypted                                                                          |
| Decorations, badges, effects                   | ✖       | Paid cosmetics; not in River's model                                                                                           |
| Account creation date                          | ⏳      |                                                                                                                                |
| Online / idle / DND / invisible                | ✅      | 1.0.17, auto-idle                                                                                                              |
| Custom status, emoji status, expiry            | ✅      | 1.0.17, encrypted                                                                                                              |
| Playing/listening activity                     | 🔒 ⏳   | Would require process/app tracking; opt-in manual "activity" could come later                                                  |
| Per-community nickname                         | ✅      | 1.0.6                                                                                                                          |
| Per-community avatar                           | ⏳      |                                                                                                                                |
| Profile popover, full profile                  | ✅ / 🔨 | Popover from member list and chat (1.0.17); separate full-profile page ⏳                                                      |
| Mutual friends / communities                   | 🔨      | Mutual communities ✅ (Friends page); mutual friends ⏳                                                                        |
| Shared roles, message/add-friend/block buttons | ✅      | Profile card                                                                                                                   |
| Report button                                  | ⏳      | Reporting system planned (§13)                                                                                                 |
| Copy user ID, context menu                     | ✅      | Copy ID on the profile card (1.0.19)                                                                                           |
| Change e-mail/password, 2FA, backup codes      | 🔒      | No password: device key + optional passphrase lock; recovery phrase = backup codes                                             |
| Active devices / sessions management           | 🔨      | Device count shown; management with linked devices (1.2)                                                                       |
| Login alerts, security notifications           | 🔨      | Safety-number change warnings ✅; new-device alerts with linked devices                                                        |

## 2. Friends, contacts and direct messages

| Item                                                                         | Status  | Notes                                                                                                          |
| ---------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| Send/accept/reject/cancel/remove, incoming/outgoing, pending                 | ✅      | Friends page tabs (1.0.3)                                                                                      |
| Request limits, duplicates, blocked requests                                 | ✅      | Server abuse limits; duplicate requests collapse                                                               |
| Search / sort / online filter                                                | ✅      | Online/All/Pending/Blocked, with search                                                                        |
| Username search, ID lookup, invite-based discovery                           | ✅      | 1.0.13                                                                                                         |
| Display-name discovery                                                       | 🔒      | Display names are encrypted; usernames are the public handle                                                   |
| Contact syncing                                                              | 🔒      | Never uploads contacts                                                                                         |
| Favorites                                                                    | ⏳      |                                                                                                                |
| Last-active visibility                                                       | 🔒      | Not stored                                                                                                     |
| DM: send/edit/delete/reply/react/pin?                                        | ✅ / 🔨 | All but DM pins ⏳                                                                                             |
| Quote, forward, copy, copy link, jump, mark unread                           | 🔨      | In channels ✅ (1.0.17); in DMs: copy/quote ✅, forward from DM ⏳                                             |
| Report message                                                               | ⏳      |                                                                                                                |
| Multiline, Enter/Shift+Enter, drafts                                         | ✅      | Drafts kept while open; persisted drafts ⏳                                                                    |
| Emoji picker                                                                 | ✅      | 1.0.17 (+ custom emoji 1.0.19)                                                                                 |
| GIF picker                                                                   | 🔒 ⏳   | Public GIF services see searches and IPs; a privacy-respecting option (proxied or local favourites) is planned |
| Sticker picker                                                               | ⏳      |                                                                                                                |
| Attachments, paste, drag-and-drop                                            | ✅      | 0.4                                                                                                            |
| Link previews                                                                | 🔒 ⏳   | Fetching previews leaks your IP to sites; opt-in, sender-side previews planned                                 |
| Markdown, code, quotes, headings, lists, spoilers                            | ✅      | 1.0.17                                                                                                         |
| Image/video/audio/document attachments, size, progress, retry                | ✅      | Cancel upload ⏳; alt text ⏳; captions = message text                                                         |
| Message states (sending/sent/failed/retrying/edited/deleted)                 | ✅      | Outbox (1.0.5)                                                                                                 |
| New-message divider, unread, typing, read receipts (DM)                      | ✅      |                                                                                                                |
| Search conversation, load older, newest button, scroll-to-bottom             | ✅      | Jump to date ⏳                                                                                                |
| Close/hide DM, group DMs (create, rename, icon, add/remove, leave)           | ✅ / 🔨 | Group icon ⏳                                                                                                  |
| Who can message you, message requests, blocks                                | ✅      |                                                                                                                |
| Spam filtering, suspicious links                                             | 🔨      | Link confirmation shows real address (1.0.17); filtering ⏳                                                    |
| DM calls: start/answer/decline/hang up/duration/ringing/missed/camera/screen | ✅      | 1:1 calls via relay too (1.0.16)                                                                               |
| Rejoin ongoing call                                                          | ⏳      |                                                                                                                |
| Message context menu                                                         | ✅ / 🔨 | Translate ✖ (would send text to a service); report ⏳                                                          |

## 3. The chat interface

| Item                                      | Status  | Notes                                                                                 |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------- |
| Hover toolbar, timestamps, reactions      | ✅      |                                                                                       |
| Avatar/name click → profile               | ✅      | 1.0.17                                                                                |
| Click timestamp → copy link               | ✅      | 1.0.17                                                                                |
| Reactions add/remove, who reacted         | ✅      | View reactions (1.0.18)                                                               |
| Reply preview → jump                      | ✅      |                                                                                       |
| Attachment click → viewer                 | ✅      | Zoom/pan/copy (1.0.18)                                                                |
| Channel/user/role mentions clickable      | ✅ / 🔨 | Role info popover ⏳                                                                  |
| Invite link preview & join flow           | ✅      |                                                                                       |
| Right-click everywhere                    | 🔨      | Messages, channels, communities, members ✅; roles, categories, voice participants ⏳ |
| Paste images, drag files                  | ✅      |                                                                                       |
| Scroll restore after navigation           | ✅      | 1.0.18                                                                                |
| Jump to latest / unread / reply origin    | ✅      |                                                                                       |
| Date separators, relative times, grouping | ✅      |                                                                                       |
| Expand/collapse long messages             | ✅      | Show more / Show less (1.0.19)                                                        |
| Spoilers, highlighted code + copy         | ✅      | 1.0.17                                                                                |
| Embeds with loading/failed states         | 🔒 ⏳   | See link previews                                                                     |
| Empty/loading/error/permission states     | ✅      |                                                                                       |

## 4. Formatting, reactions and expression

| Item                                              | Status  | Notes                               |
| ------------------------------------------------- | ------- | ----------------------------------- |
| Emoji picker, search, recent, categories          | ✅      | Favorites ⏳                        |
| Custom emoji: upload, rename, delete, permissions | ✅ / 🔨 | 1.0.19; rename ⏳ (delete + re-add) |
| Animated custom emoji                             | ✅      | Small GIFs kept as-is               |
| Stickers                                          | ⏳      |                                     |
| GIFs                                              | 🔒 ⏳   | See §2                              |
| Multiple reactions, counts, removal, user list    | ✅      |                                     |
| Super reactions                                   | ✖       | Paid feature                        |
| Markdown incl. escaping, malformed fallback       | ✅      |                                     |
| Timestamps `<t:…>`, message links, channel refs   | ✅      |                                     |
| Soundboard                                        | ⏳      | Planned with voice polish           |

## 5. Communities

| Item                                                  | Status | Notes                                                                                  |
| ----------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| Create with name, icon, template, channels            | ✅     | 1.0.2                                                                                  |
| Join by invite, preview                               | ✅     |                                                                                        |
| Discovery / public listing                            | ✖ / ⏳ | Communities are private and encrypted; an opt-in directory would need a public profile |
| Rules screening, onboarding questions, welcome screen | 🔨     | Welcome screen ✅; rules/onboarding ⏳                                                 |
| Leave, rejoin, new invites, expiry & usage limits     | ✅     |                                                                                        |
| Icon, name, description, banner, splash               | 🔨     | Banner/splash ⏳; image icons ⏳ (emoji icons today)                                   |
| Scheduled events, RSVP, reminders, cancel, delete     | ✅     | 1.0.18                                                                                 |
| Announcement channels                                 | ✅     | Following across communities ⏳                                                        |
| Ownership transfer                                    | ⏳     |                                                                                        |
| Server deletion with confirmation                     | ✅     |                                                                                        |
| Templates                                             | ✅     |                                                                                        |
| Insights / analytics                                  | 🔒     | Server cannot see content; local stats possible ⏳                                     |

## 6. Navigation, channels and categories

| Item                                                                | Status | Notes                                          |
| ------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| Server icons, unread, mention badges, active indicator              | ✅     |                                                |
| Drag-and-drop server order, folders (create/rename/colour/collapse) | ✅     | 1.0.18                                         |
| Categories create/rename/reorder/collapse/delete/permissions        | ✅     | 1.0.0/1.0.6                                    |
| Text, voice, announcement channels                                  | ✅     | Forum ⏳, stage ⏳, media ⏳                   |
| Duplicate channel                                                   | ⏳     |                                                |
| Topic, slowmode, per-channel notifications, permissions             | ✅     | NSFW flag ⏳                                   |
| Private channels, synced/unsynced overrides                         | ✅     |                                                |
| Channel search, unread navigation, recent history                   | ✅     | Quick switcher, Alt+Shift+↑/↓                  |
| Muted / locked indicators                                           | ✅     | 1.0.18                                         |
| Confirm before deleting populated channel                           | ✅     |                                                |
| Restore navigation after restart                                    | ✅     | Last channel per community remembered (1.0.19) |

## 7. Roles and permissions

| Item                                                 | Status  | Notes                                                                                          |
| ---------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| Create/edit/delete roles, colour, hoist, mentionable | ✅      | Duplicate ⏳, icons ⏳                                                                         |
| Drag-and-drop hierarchy                              | 🔨      | Up/down arrows today                                                                           |
| Assign/remove, view members                          | ✅      | Bulk ⏳                                                                                        |
| Self-assignable / reaction roles                     | ⏳      |                                                                                                |
| Temporary roles                                      | ⏳      |                                                                                                |
| Hierarchy enforcement, owner protection              | ✅      | Server-side                                                                                    |
| View as role / effective permission explainer        | ⏳      |                                                                                                |
| Permission categories                                | 🔨      | 23 permissions incl. events and emoji; threads/forums/apps follow those features               |
| Evaluation rules 1–12                                | ✅ / 🔨 | Discord's algorithm, server-enforced, audited; individual member overrides ⏳; diff preview ⏳ |

## 8. Voice, audio and calls

| Item                                           | Status  | Notes                                    |
| ---------------------------------------------- | ------- | ---------------------------------------- |
| Join/leave/move, states, participant counts    | ✅      | Reconnect-safe (1.0.16)                  |
| Full / locked / unavailable channels           | ✅      |                                          |
| Device change without dropping                 | ✅      |                                          |
| Connection quality display                     | 🔨      | Connection check ✅; per-person stats ⏳ |
| Mute/deafen, devices, volumes, per-user volume | ✅      |                                          |
| Mic test, input sensitivity, PTT, noise/echo   | ✅ / 🔨 | Sensitivity slider ⏳                    |
| Server mute/deafen, move, disconnect           | ✅ / 🔨 | Server deafen ⏳                         |
| Speaking indicators, priority speaker          | ✅ / ⏳ |                                          |
| Camera, screen share, grid/focus, pin          | ✅      | Stream quality settings ⏳               |
| Stream audio                                   | ⏳      |                                          |
| Relay when direct connection impossible        | ✅      | 1.0.16 (voice; video still direct)       |
| Stage channels                                 | ⏳      |                                          |
| Soundboard                                     | ⏳      |                                          |

## 9. Notifications and sounds

| Item                                                               | Status  | Notes                                      |
| ------------------------------------------------------------------ | ------- | ------------------------------------------ |
| DM, request, mention, role, @everyone, reply notifications         | ✅      |                                            |
| Event reminders                                                    | ✅      | 1.0.18                                     |
| Global / per-community / per-channel overrides, mute with duration | ✅      | 1.0.18                                     |
| DND suppression                                                    | ✅      | 1.0.17                                     |
| Preview choice                                                     | ✅      |                                            |
| Mobile push, e-mail                                                | ⏳ / 🔒 | Push with mobile apps (Stage 2); no e-mail |
| Quiet hours                                                        | ⏳      |                                            |
| Sound registry with groups and volume                              | ✅      | 1.0.1                                      |

## 10–12. Search, threads, forums, mentions

| Item                                               | Status | Notes                                   |
| -------------------------------------------------- | ------ | --------------------------------------- |
| Search channel/community on device, jump to result | ✅     | Filters (author/date/has:) ⏳           |
| Quick switcher, recent channels                    | ✅     |                                         |
| Back/forward navigation                            | ⏳     |                                         |
| Threads from messages, replies, archive            | ✅     | Follow/unfollow ⏳                      |
| Forums                                             | ⏳     |                                         |
| Mentions with autocomplete, role checks, highlight | ✅     |                                         |
| Mention suppression per message                    | ✅     | @ON/OFF on replies (1.0.18)             |
| Pins, pinned list                                  | ✅     |                                         |
| Bookmarks / saved messages                         | ✅     | Saved messages, on this device (1.0.19) |
| Polls                                              | ✅     | 1.0.18                                  |

## 13–14. Moderation and audit

| Item                                       | Status | Notes                                                     |
| ------------------------------------------ | ------ | --------------------------------------------------------- |
| Delete messages, timeout, kick, ban, unban | ✅     | Bulk delete ⏳, temp bans ⏳                              |
| AutoMod keyword rules                      | 🔒 ⏳  | Server cannot read messages; client-side filters possible |
| Reports, cases, mod notes                  | ⏳     |                                                           |
| Audit log with actor/action/target         | ✅     | Filters/export ⏳                                         |

## 15–17. Apps, events, growth

| Item                            | Status | Notes                                  |
| ------------------------------- | ------ | -------------------------------------- |
| Bots, slash commands, webhooks  | ⏳     | Need an end-to-end-encrypted bot model |
| Activities                      | ⏳     |                                        |
| Events                          | ✅     | 1.0.18                                 |
| Vanity invites, invite tracking | ⏳     |                                        |
| Paid perks                      | ✖      | Not in River's model                   |

## 18–20. Settings, motion, keyboard

| Item                                                                      | Status | Notes                      |
| ------------------------------------------------------------------------- | ------ | -------------------------- |
| Appearance: density, zoom, text size, clock, contrast, motion             | ✅     | 1.0.9/1.0.18               |
| Language selection                                                        | ⏳     | English only               |
| Keybind editor                                                            | 🔨     | PTT key ✅; full editor ⏳ |
| Shortcuts list, Ctrl+K, Ctrl+F, Esc, Alt+↑/↓, Ctrl+Alt+↑/↓, type-anywhere | ✅     | 1.0.17                     |
| Animations with reduced motion                                            | ✅     |                            |

## 21–25. Media, calls, security, reliability, accessibility

| Item                                                       | Status  | Notes                                            |
| ---------------------------------------------------------- | ------- | ------------------------------------------------ |
| Attachments end to end, viewer, save                       | ✅      | PDF preview ⏳                                   |
| Call state machine, reconnection                           | ✅      | 1.0.16                                           |
| Rate limiting, server-side permission checks               | ✅      |                                                  |
| Data export                                                | ⏳      | Encrypted backup exists; readable export planned |
| Crash recovery, startup diagnostics, self-test             | ✅      | 1.0.16                                           |
| Keyboard navigation, focus, screen-reader labels, contrast | ✅ / 🔨 | axe audits in CI                                 |
| Localization                                               | ⏳      |                                                  |

## 26–27. Analytics and premium

Analytics 🔒 (content is encrypted; only local, opt-in statistics would be
possible). Premium/monetization ✖ — River is free software with no paid tier.

## 28. System messages and edge cases

Join/leave and pin notices ✅; "user moved", "call started" notices ⏳;
deleted-reply and missing-attachment states ✅; concurrent edits rely on
server last-write; double submissions are idempotent (client message IDs) ✅.
