# Changelog

All notable changes to River are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and River uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.2] - 2026-10-10

**Easy start: create or join a community in one step.**

### Added

- **One start screen.** Paste an invite link to join (pasting a whole link
  joins straight away), or pick a template, type a name and create.
- **Templates**: Friends, Gaming, Study group, Club or team, or Start from
  scratch. Each comes with categories and channels, previewed before you create.
- **Creating your first community creates your account too.** The server
  address is asked for right on the start screen, no trip to Settings.
- **Paste an invite link anywhere in River** (outside a text field) to get a
  "Join this community?" prompt. River only reads the clipboard when you paste.
- **Community icons**: pick an emoji in Community settings → Overview; new
  communities start with their template's emoji. Icons are encrypted with the
  name; older River versions keep showing initials.
- **Empty channels help you start**: "Wave to say hi", plus "Invite friends"
  when you are the only member.
- **Invite button in every channel header.**

## [1.0.1] - 2026-10-10

**Sound and motion: River now sounds and feels alive.**

### Added

- **A sound for every interaction**: sending a message, direct messages (their
  own sound), reactions, call connected and call ended, a friend request, a new
  friend, joining or creating a community, copying a link, and errors.
- **Sound settings** (Settings → Notifications): a volume slider and switches
  for each group — Messages, Voice channels, Calls, Friends and communities,
  Interface — each with preview buttons.
- **Celebrations**: a short confetti burst when you join or create a community
  or make a new friend.
- **Motion**: your messages rise from the composer, mentions arrive with a
  glow, badges and reaction counts bump when they change, the speaking ring
  breathes, the voice panel slides in, voice participants pop in, and channels
  fade in when you switch.

### Accessibility

- Celebrations are hidden from screen readers and are not shown at all when
  reduced motion is on; every other animation follows Settings → Appearance.

## [1.0.0] - 2026-10-09

**Stage 1 is complete: River is a full desktop platform for messages, communities, social, files and calls.**

### Added

- **Channel categories.** Group channels under named categories (names are
  encrypted like everything else), collapse them, and create channels inside
  them. People who may manage channels can **drag and drop** channels and
  categories to reorder them; the whole move is applied at once. Channel
  settings also has a category picker for keyboard users.
- **Unread channels are remembered across restarts.** River keeps the time you
  last read each channel in its encrypted local database and marks channels with
  newer messages, including ones that arrived while River was closed.

### Changed

- Home shows the finished Stage 1 timeline and what comes in Stage 2.
- README describes what works in 1.0 and links the threat model.

### Security

- Release signing: the current setup and the plan to move the key to hardware
  and then to threshold signing are documented in
  `docs/security/release-signing.md`.
- The server only sends a category to members who can see at least one channel
  in it (or may manage channels).

## [0.9.0] - 2026-10-09

**Hardening before 1.0: history, search, every section built, abuse limits, accessibility.**

### Added

- **Contacts**: your contacts, requests and blocked people, adding by River ID,
  message or call with one click, safety-number status at a glance.
- **Files**: every file and picture shared with you in messages and posts,
  filter by type, search, show in chat, save.
- **Calls**: call history (incoming, outgoing, missed, duration — kept only on
  this computer) and quick voice/video calls to your contacts.
- **Search**: search your conversations, and search a community's channels
  (decrypted and searched on your computer — the server cannot read them).
- **Load older messages** in community channels (beyond the latest 100).

### Security

- The server limits realtime event floods per connection, undelivered mail per
  device (`RIVER_MAILBOX_LIMIT`) and stored files per person
  (`RIVER_ATTACHMENT_QUOTA_MB`).
- Pre-1.0 security review: `docs/security/0.9.0-review.md`.

### Changed

- Better contrast for secondary text (WCAG AA) and properly separated channel
  buttons for screen readers; automated accessibility checks run in CI.
- Multi-device linking moves to Stage 2 (1.2.x). To move to a new computer,
  use **Settings → Backup** and **Restore from a backup**.

## [0.8.0] - 2026-10-09

**Never lose your account: recovery phrase and encrypted backups. Calls through strict networks.**

### Added

- **Settings → Backup**: an 18-word recovery phrase and an encrypted backup
  file (AES-256-GCM under a key derived from the phrase) containing your
  identity, account, community keys, contacts and their safety-number trust,
  groups, message history, posts and profile. Without the phrase the file is
  unreadable.
- **Restore from a backup** on the first screen of a fresh install: pick the
  file, type the words, and you are back — communities decrypt, history is
  there, and River re-introduces you to your contacts so conversations
  continue. Prekeys left on the server by the old install are replaced.
- **TURN relay support** for voice/video calls and screen sharing through
  strict firewalls: set `RIVER_TURN_URLS` and `RIVER_TURN_SECRET` on the
  server (coturn); clients get short-lived credentials automatically. See
  `docs/deployment/turn.md`.

### Fixed

- Setting up encrypted messaging no longer freezes River for seconds on slow
  disks (key generation now writes in one transaction).

## [0.7.0] - 2026-10-09

**Social: posts, photos and stories for your friends.**

### Added

- **Social** section: share posts (text, photos, videos) with all your
  contacts or only people you pick, and **stories** that disappear after 24
  hours. Like and react, comment, and see comments from everyone the post was
  shared with. Story viewer with progress bars, tap/arrow navigation, replies
  that arrive as direct messages, and "seen by" for your own stories.
- **Profiles** with a short bio; open anyone's profile from the feed to see
  their posts and message them.
- Every post is end-to-end encrypted separately for each person in its
  audience (Signal protocol); comments and reactions go to the author, whose
  River shares them back with the audience. The server only relays ciphertext.

### Fixed

- Files in direct messages no longer disappear after the server's 31-day
  retention: River keeps its own encrypted copy as soon as they arrive.
- On narrow windows, clicking into the chat closes the member list overlay.
- The server's Docker image builds again (a broken line in the Dockerfile).

## [0.6.0] - 2026-10-09

**Group chats, and removed members can no longer read new community messages.**

### Added

- **Group conversations** in Messages (up to 32 people): **New message → New
  group**, then pick people from your contacts and communities. Admins rename
  the group and add or remove people; anyone can leave. Messages, replies,
  files, reactions, edits and deletes work as in one-to-one chats, end-to-end
  encrypted to each member with the Signal protocol.
- Groups from people you have not accepted arrive as requests; others only
  learn your name once you accept.

### Security

- **Community key rotation**: when someone leaves, is kicked or is banned, a
  remaining member's River replaces the community key and hands the new one to
  everyone else over encrypted direct-message sessions. People who were removed
  cannot read anything sent afterwards, even if they obtain the ciphertext.
- Members who missed a rotation, or join with an older invite link, fetch the
  current key from other members automatically. Members only hand keys to people
  who prove they joined with a genuine invite, so a fake member added by a
  compromised server receives nothing.
- Invite links now carry a check value, so a damaged or altered key is caught
  when joining.

### Changed

- On narrow windows the member list opens as an overlay (toggle it with the
  members button) instead of disappearing.

## [0.5.0] - 2026-10-09

**Direct messages and calls, end-to-end encrypted with the Signal protocol.**

### Added

- **Messages**: private one-to-one conversations using libsignal (PQXDH with
  post-quantum Kyber keys and the Double Ratchet). Start one from anyone's
  profile card in a community (**Message**), from **New message**, or by pasting
  a River ID (copy yours from the Messages sidebar).
- Replies, edits, delete for me / for everyone, emoji reactions, files and
  pictures (encrypted the same way as in communities), typing indicators,
  delivered/read status, unread badges, and desktop notifications that follow
  your preview setting.
- **Message requests**: messages from people you have not accepted wait in
  Requests; they get no read receipts and cannot call you until you accept.
  **Block** hides you from someone and silently drops their messages.
- **Safety numbers**: compare 60 digits to rule out interception, mark a
  contact verified, and get a warning if their key changes. River also checks a
  person's key against the one in your shared communities.
- **1:1 voice and video calls** from a conversation, with ringing, accept /
  decline, busy and missed-call handling, mute, deafen, camera and screen
  sharing. Call setup travels inside encrypted messages and is never stored.
- Offline delivery: messages wait on the server (encrypted) for up to 30 days.

### Server

- Prekey distribution, an encrypted mailbox, blocks, and longer retention for
  files sent in direct messages. See `docs/protocol/messaging.md`.

## [0.4.0] - 2026-10-09

**Encrypted files and pictures.**

### Added

- Send files, images, videos and audio in community channels: the + button,
  drag and drop onto the chat, or paste. Up to 10 files (25 MB each) per message.
- Every file is encrypted on your device with its own key (the Signal
  attachment format: AES-256-CBC + HMAC-SHA256, padded to hide the exact size);
  the server stores only ciphertext and never learns names or types.
- Pictures appear inline with a blurred preview while they load and open full
  size on click; audio and video play inline after a click; other files show as
  cards with **Save**. River never opens a received file by itself, and warns
  about programs.
- Server: `RIVER_ATTACHMENT_DIR` and `RIVER_MAX_ATTACHMENT_MB`; blobs are
  deleted with their message, and uploads never sent are cleaned up after a day.
- The **Attach files** permission now applies (on for @everyone by default).

## [0.3.0] - 2026-10-09

**Roles, permissions, moderation and a full community experience.**

### Added

- **Roles and permissions**: an @everyone role plus custom roles with names,
  colours and ordering; 18 permissions (view, send, react, mention @everyone,
  manage messages, pin, connect, speak, video & screen share, mute and move
  members, manage channels/roles/community, kick, ban, invites, administrator).
  The server enforces every permission and the role hierarchy (you can only
  manage roles and members below your highest role; nobody can act on the owner).
- **Private and read-only channels** through per-channel permission overrides
  (allow / inherit / deny per role).
- **Moderation**: kick, ban and unban (banned people cannot rejoin), server
  mute and disconnect in voice, leave community, delete community (owner).
- **Community settings**: overview (name, description), roles editor, member
  management with role assignment, ban list. **Channel settings**: rename,
  topic, order, delete, permissions. Create text or voice channels, optionally private.
- **Messages**: edit (Up arrow edits your last message), delete, reply,
  pin and a pinned-messages panel, emoji reactions (the server sees only an
  HMAC tag, never the emoji), @mentions with autocomplete and highlighting,
  simple formatting (bold, italic, underline, strike, code, quotes), date
  dividers, typing indicators, jump to present.
- **Presence and unread**: online/offline member list grouped by role,
  unread and mention badges on channels and communities.
- **Desktop notifications** for messages or only mentions while River is in the
  background; what they reveal follows Settings → Notifications (default: nothing private).
- **Voice**: click a channel to join; mute, deafen, push to talk (while River
  is focused), Ctrl+Shift+M / Ctrl+Shift+D, speaking indicators, LIVE badges,
  per-person volume, input/output device selection, noise suppression and echo
  cancellation toggles, microphone test, click a tile to spotlight it. The call
  keeps playing while you read text channels.
- **Profile**: display name and avatar (cropped and resized on your device,
  encrypted per community).
- Original synthesised **sound effects** (messages, mentions, join/leave,
  mute/deafen, streaming) and interface **animations**; both respect
  Settings (sounds toggle, reduced motion).

### Changed

- Members may create invite links by default (the owner can turn this off for
  @everyone). Non-members asking about a community now get "not found".
- Leaving or being removed from a community deletes its key from this device.

### Security

- New realtime events and fields are optional, so 0.2.x apps keep working
  against an upgraded server while they auto-update.

## [0.2.2] - 2026-10-09

### Fixed

- **Copy link** for community invites now copies to the clipboard. River's
  permission lock-down had blocked clipboard writes; it now allows writing
  (never reading) the clipboard for River's own interface.

## [0.2.1] - 2026-10-09

### Fixed

- The screen-share picker explains when no screen or window can be captured
  (for example Linux on Wayland without PipeWire) instead of showing an empty list.

## [0.2.0] - 2026-10-09

**Communities.** Create a private community, invite people with a link, chat in
text channels and meet in voice channels with video and screen sharing.

### Added

- **Communities** with text and voice channels, owners/admins/members, member
  list, and live updates.
- **Invite links** — one paste joins the community *and* creates the account on
  that server automatically. Links expire after 7 days or 100 uses.
- **End-to-end encrypted community content**: community, channel and member
  names, messages and call setup are encrypted on your device with the community
  key (AES-256-GCM, bound to community and channel). The key travels only in the
  invite link's `#fragment`, which never reaches the server.
- **Voice channels with video and screen sharing**: direct, peer-to-peer WebRTC
  calls (DTLS-SRTP), mute, camera, screen/window picker with high-quality screen
  sharing, connection status per person.
- Server: communities, channels, invites (stored hashed), encrypted messages,
  realtime WebSocket, encrypted signalling relay, `/join` landing page.
- Guide: [host a community tonight](docs/deployment/host-a-community.md) with a
  free Cloudflare tunnel. `npm run server` starts the server.
- Two-app end-to-end test: create, invite, join, chat both ways, call, camera.

### Known limitations

- Shared community key: anyone with an invite link can read the community, and
  there is no forward secrecy or removal of members yet. Per-member libsignal
  keys are planned.
- Calls are a full mesh (best for up to ~10 people); no relay (TURN/SFU) yet.
- Direct messages, social feed and files are still to come.

## [0.1.0] - 2026-10-09

**Accounts.** Create an account on a River server with nothing but your
cryptographic identity — no phone number, e-mail or name.

### Added

- **Account registration** in Settings → Server. River proves to the server
  that it holds your identity key and a new key for this device, and registers
  a **device list signed by your identity key**.
- **Device sessions** by challenge–response with the device key; the session
  token is kept only in memory and the server stores only its hash.
- **Server-tamper detection**: every time River connects it checks that the
  server's copy of your account is signed by your own identity. If not, River
  stops talking to that server and shows a security warning.
- Server: accounts, devices, sessions and one-time challenges (SQLite and
  PostgreSQL), stricter rate limits on authentication routes, `RIVER_REGISTRATION`
  (open/closed) and `RIVER_SESSION_TTL_HOURS`. No IP addresses, names or
  last-seen times are stored; dates are kept to the day.
- Security Center: server and devices rows reflect your account; top bar shows
  the connection.
- Protocol specification: [docs/protocol/accounts.md](docs/protocol/accounts.md).
- Integration test suite (`tests/integration`) running the desktop account code
  against the real server, including a malicious-server scenario.

### Changed

- Server Docker image is now based on Debian slim (libsignal needs glibc).

## [0.0.4] - 2026-10-08

You now have a River identity: a key pair created on your computer, with a
fingerprint your contacts will be able to verify.

### Added

- **First-run onboarding**: create your identity — no phone number, no e-mail.
  Choose an optional display name (kept on this computer for now).
- **Cryptographic identity** built on **libsignal** (Curve25519 identity key,
  the same construction Signal uses), a random River ID and registration ID.
  The private key is stored only in the encrypted local database and never
  leaves River's main process.
- **Identity fingerprint** (128-bit, hex) and **verification words** (Bytewords),
  shown in onboarding and in a new *Your identity* card in the Security Center.
- `@river/crypto` package: identity creation, fingerprints, verification words
  and libsignal safety numbers (used for contact verification from 0.3).
- `THIRD_PARTY_NOTICES.md`.

### Changed

- Home greets you by name and shows the next milestones.
- Security Center marks Identity as active once created.

## [0.0.3] - 2026-10-08

River now has an encrypted place on your computer to keep things — the
foundation for conversations, keys and media in the coming releases.

### Added

- **Encrypted local database** (SQLCipher, AES-256). River never writes its
  local data in readable form.
- The database key is 32 random bytes protected by your operating system:
  **Windows DPAPI**, **macOS Keychain** or the **Linux Secret Service**
  (GNOME Keyring / KWallet).
- **Passphrase protection** where no real keyring exists (for example Linux
  without a Secret Service): River asks you to choose a passphrase on first
  start and to unlock on later starts. The key is sealed with Argon2id
  (64 MiB, 3 passes, libsodium) and AES-256-GCM. Repeated wrong guesses are slowed down.
- **Local data migrations**: upgrades are applied in one transaction, with an
  encrypted backup copy before any destructive change; data written by a newer
  River is never touched by an older one.
- Security Center shows encrypted storage as active and how its key is protected.

### Changed

- Installers now contain only their own platform's native libraries.
- The updater no longer considers web-installer packages.

## [0.0.2] - 2026-10-08

The River server arrives, and the desktop app can connect to one. Still no
accounts or messages — this release lays the ground they will run on.

### Added

- **River server** (`apps/server`): Fastify HTTP service with `/v1/health` and
  `/v1/version`, strict security headers, request size limits, per-client rate
  limiting (in-memory only), and uniform JSON errors that never leak internals.
- **Privacy-preserving logging**: the server logs method, route template,
  status and duration — never IP addresses, headers, query strings or bodies.
  Tested in unit tests and against the container in CI.
- **Database layer** for SQLite (default) and PostgreSQL with forward-only,
  transactional migrations (a failing migration leaves no partial changes).
- **Docker image** (non-root, read-only filesystem, health check) and a
  docker-compose example; [self-hosting guide](docs/deployment/self-hosting.md).
- **Settings → Server** in the desktop app: enter a server address (HTTPS
  required, except for a server on your own computer) and test the connection.
  The test is one anonymous request for the server's version.
- `@river/protocol` package with the protocol version and validated API schemas.

### Changed

- Settings files from 0.0.1 are upgraded automatically; nothing is lost.
- The Security Center shows which server River is set to use.

### Fixed

- Paths containing backslashes or encoded separators are refused on every OS
  (Linux previously treated them as ordinary file names).

## [0.0.1] - 2026-10-08

The foundation release. River does not send messages yet — this version
establishes the desktop app, its design and, most importantly, the signed
automatic-update path that every later release will arrive through.

### Added

- Desktop app for Windows, macOS and Linux with River's own interface: Home,
  Messages, Communities, Social, Calls, Files, Contacts, Security and Settings.
  Sections that are not built yet say so clearly and show when they arrive.
- **Signed automatic updates** from GitHub Releases. Every update is checked
  against an Ed25519-signed release manifest whose key is built into River
  before it can be installed. Downgrades are refused.
- **Release channels**: Stable, Beta and Nightly, selectable in Settings → Updates.
- **Security Center** showing only what is actually active in this version.
- Settings for update behaviour, motion (reduced-motion support) and
  notification privacy (previews hidden by default).
- Hardened desktop shell: sandboxed interface served from a private `river://`
  scheme with a strict Content-Security-Policy, blocked navigation and pop-ups,
  all permissions denied by default, validated IPC.
- Installers: Windows (NSIS), macOS (DMG/ZIP, Intel and Apple silicon), Linux
  (AppImage, deb, rpm), with `SHA256SUMS`, a CycloneDX SBOM and a signed manifest.
- Architecture, threat model, cryptography, privacy and roadmap documentation.
- CI: lint, typecheck, unit and end-to-end tests on all three desktop platforms,
  CodeQL, Dependabot, dependency audit.

### Known limitations

- macOS builds are not notarized: first launch needs right-click → Open, and
  updates are offered as a download instead of installing silently.
- Windows builds are not Authenticode-signed: SmartScreen shows a warning on
  first install.

[Unreleased]: https://github.com/martex-dev/river/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/martex-dev/river/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/martex-dev/river/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/martex-dev/river/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/martex-dev/river/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/martex-dev/river/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/martex-dev/river/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/martex-dev/river/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/martex-dev/river/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/martex-dev/river/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/martex-dev/river/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/martex-dev/river/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/martex-dev/river/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/martex-dev/river/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/martex-dev/river/compare/v0.0.4...v0.1.0
[0.0.4]: https://github.com/martex-dev/river/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/martex-dev/river/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/martex-dev/river/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/martex-dev/river/releases/tag/v0.0.1
