# River 1.0 parity checklist (maintainer's list, 2026-10-10)

The maintainer's complete feature list for perfecting 1.0. It is audited line
by line in 1.0.11 and later: every item gets a status (✅ done, 🔨 partial,
⏳ to do, 🔒 replaced by a privacy-preserving equivalent, ✖ not planned, with
the reason). River's non-negotiable rules (no phone or e-mail requirement, no
tracking, end-to-end encryption, server never sees plaintext) take precedence;
where an item conflicts with them, the audit records the equivalent River
offers instead.

## 1. Account creation, identity and profile

- **Registration and login:** e-mail, password, username, display name, date of birth where required, verification, e-mail confirmation, login errors, session persistence, logout, account recovery, password reset, suspicious-login challenges, account deletion and deactivation.
- **Identity:** unique user ID, username availability, display name, avatar, avatar crop/preview, animated avatar where supported, profile banner, profile colors, bio/about-me, profile pronouns if offered, profile decorations, badges, profile effects, account creation date.
- **Status and presence:** online, idle, Do Not Disturb, invisible/offline, custom status text, emoji status, status expiry, playing/listening/watching activity, activity privacy, per-server nickname, server-specific avatar where supported.
- **Profile viewing:** open profile popover, full profile, mutual friends, mutual communities, shared roles, profile links, connections, message button, add-friend button, block button, report button, copy user ID, context menu, profile loading and unavailable-user states.
- **Account security:** change e-mail/password, two-factor authentication, authenticator support, backup codes, trusted sessions, active-device/session management where available, login alerts, connected-account management, security notifications.

## 2. Friends, contacts and direct messages

- **Friend management:** send request, accept, reject, cancel, withdraw, resend, remove friend, incoming requests, outgoing requests, pending indicators, request limits, blocked requests, duplicate requests, search friends, sort friends, online/offline filtering.
- **Friend discovery:** search username, exact username matching, display-name discovery where available, user ID lookup if supported, mutual communities, recent interactions where privacy permits, invite-based discovery, contact syncing only with explicit consent.
- **Friend list:** online, all, pending, blocked, favorites if implemented, activity indicators, last-active visibility settings, empty states, loading states.
- **Direct messaging:** open DM, create DM, send, receive, edit, delete, reply, quote, forward, react, remove reaction, pin, unpin, copy, select text, copy link, jump to message, report message, mark unread.
- **Message composition:** multiline input, Enter-to-send setting, Shift+Enter newline, draft preservation, emoji picker, GIF picker, sticker picker, file attachment, image paste, drag-and-drop upload, link previews, code formatting, inline code, code blocks, quote formatting, headings, lists, spoiler formatting, Markdown-like text formatting.
- **Rich messages:** image previews, image zoom, video previews, audio attachments, document attachments, file-size display, upload progress, retry failed upload, cancel upload, attachment removal before sending, multiple attachments, captions, alt text, unsupported-file errors.
- **Message states:** sending, sent, failed, retrying, edited, deleted, loading history, new-message divider, unread count, read state where applicable, typing indicator, user is typing, attachment processing, link preview loading.
- **Conversation management:** search conversation, jump to date, load older messages, newest-message button, scroll-to-bottom, close DM, reopen DM, hide conversation, group DM creation, rename group, group icon, add/remove participants, leave group, invite link where supported.
- **DM privacy:** who can message you, who can send friend requests, message requests, spam filtering, blocked users, restricted attachments, suspicious links, report conversation, restrict unsolicited messages.
- **Voice/video from DMs:** start voice call, answer, decline, hang up, join an ongoing call, call duration, ringing state, missed-call indicator, camera toggle, screen share where supported, call notifications, reconnecting, call failed.
- **Message context menu:** reply, edit, delete, pin, copy text, copy message link, mark unread, forward, add reaction, report, translate if supported, open profile, inspect attachment, app actions.

## 3. The chat interface itself

- Hover over a message: reveal timestamp, action toolbar, reactions and context-menu trigger.
- Hover over an avatar: reveal tooltip or profile preview.
- Click avatar: open user profile. Click username: open profile.
- Click timestamp: copy or open message link where supported.
- Click a reaction: add your reaction. Click your existing reaction: remove it.
- Hover over reaction: show who reacted. Click reaction count: open the reaction-user list.
- Click reply preview: jump to the original message.
- Click attachment: open preview or external viewer. Click an embed: open its destination.
- Click a channel mention: navigate to the channel if authorized.
- Click a user mention: open profile or start a DM. Click a role mention: show role information if permitted.
- Click an invite: display a community preview and join flow.
- Right-click messages, channels, users, roles, categories, servers, voice participants and attachments.
- Select and copy text without accidentally activating the message.
- Drag files into the composer. Paste screenshots and copied images.
- Scroll through history, preserve scroll position and restore it after navigation.
- Jump to the latest message, unread messages or a reply's origin.
- Distinguish new, edited, deleted and system-generated messages.
- Date separators, relative timestamps and full timestamp tooltips.
- Message grouping for consecutive messages from the same sender.
- Expand and collapse long messages and large embeds.
- Spoilers concealed until clicked.
- Code blocks with syntax highlighting and a copy-code button.
- Link embeds with loading, success, unavailable and failed-preview states.
- Clear empty, loading, error, retry and permission-denied states.

## 4. Formatting, reactions and expression tools

- Standard emoji picker, categories, search, recent emoji, favorites and frequently used emoji.
- Unicode emoji, custom community emoji, animated emoji where supported, emoji aliases and emoji permissions.
- Stickers: browse, search, preview, send, favorite, upload, manage, remove, inspect availability and enforce limits.
- GIF search, trending GIFs, previews, animated playback, send/cancel, safe-content controls.
- Standard reactions, multiple reactions per message, reaction counts, reaction removal, reaction-user list.
- Animated or enhanced reactions where available.
- Spoiler formatting for text, images, videos and supported attachments.
- Bold, italic, underline, strikethrough, inline code, code blocks, block quotes, lists and headings.
- Markdown parsing, literal-text escaping, malformed-format fallback and preview behavior.
- Message links, mentions, timestamps, channel references and supported special syntax.
- Custom emoji upload, rename, delete, reorder and access management.
- Sticker upload, sticker tags, metadata, server limits and permissions.
- Soundboard sound upload, naming, preview, favorite, playback, deletion and usage permissions.

## 5. Servers and communities

- Create a community, choose a name and icon, select a template and configure initial channels.
- Join by invite link, discover communities, preview community, accept rules, complete onboarding and choose roles.
- Leave, rejoin, get reinvited, cancel an invite, generate a new invite, manage invite expiration and usage limits.
- Server icon, name, description, banner, splash or other artwork, locale, notification defaults and system messages.
- Server discovery, categories, search, public/private visibility, community listing, member count and online count.
- Welcome screen, welcome messages, guidelines, rule screening, onboarding questions, default and recommended channels.
- Member applications or screening flows.
- Scheduled events, event discovery, RSVP, interested/maybe, attendance, event notifications, cancellation and deletion.
- Announcement channels, publishing, following announcement channels, cross-posting and source attribution.
- Community-specific profiles, nicknames, roles, permissions, member lists, invite links and moderation settings.
- Transfer of ownership, server deletion, settings reset and confirmation dialogs.
- Server templates, duplicated channel layouts, setup wizards and setup progress.
- Server insights, analytics and community health tools.

## 6. Server navigation, channels and categories

- Server switcher, server icons, unread indicators, mention badges, active-server indicator, drag-and-drop server ordering.
- Server folders: create, rename, colors, collapse/expand, drag servers into folders, folder notification settings.
- Channel categories: create, rename, reorder, collapse, delete and manage permissions.
- Text, voice, announcement, forum, media, stage and other channel types.
- Create, rename, duplicate, edit, reorder, move, archive or delete channels.
- Channel topic, description, slowmode, age-restricted settings, channel notification overrides and channel permissions.
- Channel visibility, private channels, invite-only channels and role-restricted access.
- Synchronized category permissions and unsynchronized channel overrides.
- Channel search, unread-channel navigation, mention navigation and recent-channel history.
- Channel hover actions, settings cog, context menu, unread marker, muted state, locked state and restricted-access state.
- Channel pinned messages, member lists, channel status and channel integrations.
- Drag channels between categories, reorder them and handle unauthorized drag attempts.
- Bulk channel creation or management.
- Confirmation before deleting a populated channel, with recovery warnings.
- Restore navigation state after restarting the application.
- Hide empty categories, collapse all and expand all categories.

## 7. Roles and the complete permissions system

**Role management:** create, edit, duplicate and delete roles; name, color, gradient, icon, description and display settings; drag-and-drop hierarchy; display roles separately in the member list; mentionable, managed and integration-created roles; assign/remove roles, bulk assign, view role members; automatic, onboarding, reaction or self-assignable roles; temporary or scheduled roles; role audit history and restoration; hierarchy enforcement; protection of the owner and critical permissions; role previews and "view as role"; explaining the source of each effective permission (role, channel override, individual override, administrator).

**Permission areas:**

| Area             | Capabilities                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| Server access    | View server, join, invite, manage server, change server identity, transfer ownership, delete server |
| Channels         | View, create, edit, duplicate, reorder, move, delete, manage categories                             |
| Text messages    | Send, edit/delete own, delete others', reply, react, pin, attach files                              |
| Mentions         | Mention everyone, mention selected roles, external emoji, external stickers                         |
| Threads          | Create public/private threads, reply, manage, archive, unarchive, lock, delete                      |
| Forums           | Create posts, reply, tag, manage tags, pin, lock, move and moderate posts                           |
| Voice            | Connect, speak, video, stream, screen share, voice activity, push-to-talk                           |
| Voice moderation | Mute, deafen, move, disconnect members, priority speaker                                            |
| Expressions      | Create, edit and delete emoji, stickers and soundboard sounds                                       |
| Members          | Change own/others' nicknames, assign roles, kick, ban, timeout, view member history                 |
| Moderation       | Manage messages, threads, reports, automod rules, security alerts, verification and audit logs      |
| Events           | Create, edit, cancel, view and manage events                                                        |
| Apps             | Use commands, install apps, manage integrations, launch activities, manage webhooks                 |
| Community        | Manage onboarding, rules, welcome screens, discovery, announcements and membership screening        |
| Analytics        | View insights, member statistics, message activity and audit reports                                |
| Administration   | Manage roles, channels, integrations, webhooks, permissions and security settings                   |

**Permission evaluation rules:** server defaults are the baseline; roles add capabilities; channel/category overrides modify them; individual overrides give targeted exceptions; deny/allow precedence is deterministic and documented; administrator privileges are defined and auditable; hierarchy limits whom a moderator can manage; changes apply promptly; revoked access stops future actions; denied actions explain why without exposing hidden content; permission changes are logged; administrators can test effective permissions before saving. Permission editor with search, category filters, inherited indicators, allow/deny/inherit states, unsaved-change warnings, bulk editing and a diff preview.

## 8. Voice channels, audio and calls

- **Joining and leaving:** click to join; context menu; connecting, negotiating, connected, reconnecting, disconnected and failed states; current channel and participant count; join/leave/move/reconnect indicators; leave, idle disconnect, shutdown handling; move between channels; locked-channel error; full/unavailable channels and outages; persistence across navigation; device changes without dropping; connection quality and region.
- **Microphone and audio:** mute/unmute, deafen/undeafen, participant icons, input/output device, input/output volume, per-user volume, mic and speaker test, sensitivity and voice activity, push-to-talk keybind, noise suppression, echo cancellation, automatic gain control, attenuation, speaking indicators, permission prompts and device errors, device switching, troubleshooting and retry.
- **Participant management:** open profile, mute self, mute others, server-mute/deafen, move, disconnect, logged moderation actor, local vs server mute, local volume, speaking animation, priority speaker, connection quality, camera/stream/hand-raised state, context menus and accessibility labels.
- **Video and screen sharing:** camera on/off, camera selection, preview and permissions, unavailable/in-use errors, resolution and quality, grid and speaker layouts, local pin, spotlight, start sharing, window/tab/display choice, quality and frame rate, source preview, stop and switch source, who is streaming, join stream, larger view, fullscreen, stream volume, capture errors and reconnection, stream permission, stream audio separate from microphone.
- **Stage channels:** start a stage, listen, request to speak, accept/reject, promote/demote, mute/remove speakers, speaker and listener counts, title, topic and status, moderator controls, hand-raising, ending.
- **Soundboard:** open, browse, search, preview, play to the channel, favorites, upload/rename/replace/remove, per-role and per-channel permissions, volume, now playing, cooldowns and errors, optional entrance sounds, restricted sounds.

## 9. Notifications, alerts and sound effects

- **Types:** DM, message request, friend request, friend accepted, mention, role mention, @everyone/@here, reply, reaction (optional), thread activity, community invitation, join confirmation, event reminder and start, call incoming/missed/accepted/ended, voice join/leave, moderation action, security warning, upload/download failure, application error, update available, reconnection completed.
- **Behavior:** global switch; per-server, per-channel and per-conversation overrides; mute with duration; Do Not Disturb; suppress while streaming; previews; desktop, in-app, push and e-mail where supported; sounds independent of visual notifications; quiet hours; duplicate suppression across devices; mention vs unread vs total counts; mark unread; clear badges after reading; persistence and grouping; clicking a notification opens the right message; expired notifications fall back sensibly; block lists, privacy and permissions respected.
- **Sound registry:** launch (optional), incoming message, mention, friend request, incoming call loop, call answered, call ended, join voice, leave voice, someone joins/leaves voice, mute/deafen, push-to-talk feedback, message sent, error, upload complete, soundboard. For each: trigger, local or remote, volume, priority, cooldown, looping, interruption, accessible alternative, mute setting. Original or licensed audio only.

## 10. Search, discovery and navigation

Global search; current channel; specific conversation; by author, date range, attachment type, mentions, pinned status and keywords; threads and forum posts; users and communities; channel names and categories; highlighted matches; filters, sort, pagination; jump to message; keep the query while opening results; clear, edit and retry; keyboard shortcut; recent searches; permission filtering; empty, no-result, loading and error states; keyboard navigation of results; quick switcher for servers, channels and DMs; recent channels and conversations; back/forward history; unread-only navigation and jump to next mention.

## 11. Threads, forums and long-form conversations

Threads from a message or standalone; title; auto-archive; replies; follow/unfollow; notification subscription; participants; add people; archive, unarchive, lock, unlock and delete; search; reply counts and last activity; side panel or dedicated view; parent preview and navigation; deleted parent and inaccessible channel handling. Forums: posts with titles and bodies; tags and required tags; search, sort and filter; list or gallery; pin, lock, move, delete; follow; last activity, reply count and author; guidelines, default sort and archive behavior; empty and no-match states.

## 12. Mentions, replies and message organization

User, role (with permission checks) and channel mentions with autocomplete; timestamp formatting; mention highlighting; per-message mention suppression; suppress @everyone/@here/role mentions by preference; reply and quote; reply previews and navigation; edited/deleted originals; pin, unpin, pinned list and permission checks; mark unread from a point; unread divider and new-message indicator; follow threads; saved/bookmarked messages; copy message links; share or forward; messages sent while offline.

## 13. Community moderation and safety

Delete messages individually and in bulk; timeout, kick, ban, unban, temporary bans; restrict posting, joining, attachments or voice; verification requirements; membership screening; spam and suspicious-link protection; AutoMod-style keyword, spam and mention-spam rules with exceptions and actions (block, alert, timeout); moderation alerts and moderator channels; review flagged content and reports; report messages, profiles, communities and attachments; report status and decisions; moderator notes and case records; moderation history; appeals; rate limits and slowmode; account-age requirements; failed-join and invite-abuse detection; audit of moderator actions; hierarchy protection; reasons on actions; confirmations; protection against accidental mass deletion; moderator permissions separate from administrator permissions.

## 14. Audit logs and administrative history

Events for: member joined/left; invites created, changed, revoked, used; roles created, modified, reordered, assigned, removed; permission changes; channels and categories created, moved, edited, deleted; messages deleted by moderators; kicks, bans, unbans, mutes, timeouts; server settings; webhooks and integrations; emoji, stickers and sounds; events; ownership transfer; security settings; moderation rules. Each record: actor, action, target, time, resource, reason, before/after diff. Filters, date ranges, actor and action filters, pagination, export and permission checks.

## 15. Integrations, bots, apps and webhooks

App directory and search; add apps to a server; user-level apps; authorization and permission scopes; remove or disable; command configuration; slash commands with autocomplete; message and user context-menu commands; command progress, success, failure and timeout; buttons, select menus and modals; app messages and embeds; bot status and health; bot roles and permissions; webhooks (create, edit, test, revoke, rotate, identity, avatar, destination); incoming webhook messages; event subscriptions; error logs, retries and rate limits; permission isolation; activity launcher; app privacy information and uninstall confirmation.

## 16. Events, activities and shared experiences

Create events with name, description, start time, duration and location or voice channel; cover image; publish, edit, cancel, delete; interested/attending; attendee list; change notifications; reminders; upcoming, ongoing and past events; start, join and leave shared activities; host departure; participant count and status; games and collaborative tools; permissions; unsupported activity, region and startup failures.

## 17. Server customization and community growth

Icon, banner, description and theme; role colors, icons and member grouping; custom emoji and stickers; soundboard library; welcome messages and onboarding questions; new-member roles; rules and acceptance; suggested channels; invites with expiration and limits; invite tracking and attribution; vanity invites; discovery and categories; announcement followers; screening and applications; analytics and growth; templates and setup guides; notification defaults; optional supporter benefits and paid features.

## 18. User settings and personalization

Account; profile; privacy and safety; devices and sessions; connected accounts; notifications; sounds; voice and video; appearance and theme; accessibility; language; text size and scaling; reduced motion; high contrast; keyboard shortcuts and keybind editor; input and output devices; message density; compact vs spacious; timestamp format; relative vs absolute time; link previews; emoji animation; GIF and media autoplay; spellcheck; streaming and activity privacy; per-server notification overrides; block list and message requests; data export and account deletion; reset to defaults; unsaved changes, validation and confirmations.

## 19. Animations, transitions, hover effects and visual feedback

Hover states (buttons, icons, avatars, messages, links, server icons, channel rows, role chips, tooltips, menus); click states (default, hover, pressed, focused, disabled, loading, success, failure); navigation (sidebar, server and channel switches, DMs, panels, modals, back); messaging (appearance, divider, reactions, reply preview, edited, upload progress, error recovery); voice (join/leave, speaking ring, mic state, participants, stream layout, active speaker, quality); community (member join, role assignment, invite acceptance, channel creation, onboarding, event reminders); feedback (toasts, confirmations, tooltips, popovers, dropdowns, skeletons, spinners, progress, error banners); motion preferences (reduced motion, duration, interruption, focus restoration, keyboard equivalents). For every interactive component: hover, mouse down/up, click, right-click, focus, Enter/Space, double-click, disabled, loading, failure, disappearance, permission loss mid-action, sound/animation/notification, can it be disabled, reduced motion.

## 20. Keyboard shortcuts and mouse interactions

Global focus shortcut; quick switcher; search; navigate servers, channels and DMs; jump to latest and to unread; mark read; mark unread; focus composer; send; newline; autocomplete navigation, accept and dismiss; emoji picker; GIF/sticker picker; reply to selected; edit last message; delete selected; message context menu; copy message link; navigate search results; toggle mute and deafen; push-to-talk; accept/decline calls; exit fullscreen; close modal; focus restoration; custom keybinds with conflict detection; shortcuts shown in tooltips and settings. Mouse: left, right and middle click, scrolling, drag and drop, resizing panels, text selection, double-click, touchpad gestures.

## 21. Attachments, media and file handling

Single and multiple uploads; drag and drop; paste; progress and cancellation; retry; type and size validation; filename sanitization; duplicates; image preview, zoom, pan, fullscreen; video playback controls and errors; audio playback; PDF and document preview; download; copy image; open externally; size and type; upload date and sender; expired or removed attachments; thumbnails; link previews and embedding settings; suspicious links and unsafe file types; image descriptions; chunked large uploads; abandoned-upload cleanup; quotas and retention.

## 22. Calls, call management and connection recovery

Initiation; ringing; incoming notification; answer; decline; busy; timeout; cancel; end; rejoin; add participants; group calls; camera and mic permissions; device switching; duration; quality; packet loss and latency; reconnecting; network changes; suspend and resume; interruption by device changes; simultaneous incoming calls; blocked users; call privacy and notification settings; failure and retry; empty calls and departures; cleanup when everyone leaves.

## 23. Security, privacy and data controls

Authentication and sessions; secure secrets; multi-factor authentication; rate limiting and abuse prevention; login and session alerts; device/session revocation; presence and activity privacy; DM privacy; block and restrict; reporting and moderation; server-side permission validation; private channel and attachment access checks; protection against unauthorized edits, deletions and role changes; safe invites; webhook and app authorization; audit logs; data export and account deletion; retention and deletion propagation; secure file delivery; malicious uploads and unsafe previews; abuse escalation; privacy disclosures for integrations; session expiry and re-authentication for sensitive actions.

## 24. Performance, reliability and application lifecycle

Initial loading; session restoration; server and DM list loading; lazy history; virtualized long lists; image and attachment caching; reconnection with backoff; duplicate prevention; consistent ordering; offline and degraded states; crash recovery; update notifications and restart; minimize, restore and close; tray; multiple windows; background notifications; resource limits; rate-limit feedback; timeouts; outages; diagnostics and opt-in error reporting; multi-device sync; concurrent-edit conflicts; testing on large communities.

## 25. Accessibility and internationalization

Full keyboard navigation; visible focus; screen-reader labels; accessible names; status and error announcements; contrast; never color alone; text size and scaling; reduced motion; captions or alternatives; modal focus management; keyboard context menus; localized dates, times and numbers; language selection; translated UI and system messages; Unicode names; text direction; time zones for events; switching language live.

## 26. Community analytics, ownership and advanced administration

Member counts and growth; joins, departures and retention; message and channel activity; engagement; event attendance; invite performance; moderation volume and response time; role distribution; channel usage; health indicators; exports; date filters; analytics permissions; ownership transfer; staff roles; administrative activity; integrations; onboarding and verification; backup and export; deletion and retention.

## 27. Subscription, premium and monetization (optional)

Entitlements; purchase and cancellation; status and renewal; feature gating; decorations; larger uploads; customization; server subscriptions; purchase history and billing; payment failures; entitlement sync; restore purchases; clear upgrade prompts; no accidental purchases; graceful expiry; premium never bypasses safety or privacy.

## 28. System messages and edge cases

Joined, left, removed or banned; channel created or deleted; pins changed; call started or ended; event created or cancelled; invite expired or used up; no permission; private or unavailable channel; deleted message; unavailable reply original; missing attachment; unavailable integration; failed voice connection; moved to another voice channel; restricted account; app updated; connection restored; settings changed while editing; concurrent admin edits; editing a just-deleted message; channel removed while its menu is open; role removed during permission editing; losing access while reading; notification for a deleted message; expired invites; uploads finishing after the composer closed; reconnecting with a different device; double submission; network loss during a role change; server rejecting an apparently available action. For each: UI, backend, notification, retry and audit behavior.

## 29. Implementation contract

Every feature gets: ID (e.g. VOICE-001), name, user action, preconditions, success and failure behavior, visual states, animation, sound, notifications, security, and tests (normal path, denied access, race condition, failure path).

## 30. Development order

1. Core platform. 2. Communities. 3. Voice and calls. 4. Interaction polish. 5. Community tools. 6. Extensibility. 7. Quality and security.
