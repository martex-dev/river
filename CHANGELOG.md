# Changelog

All notable changes to River are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and River uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.11.0] - 2026-10-17

**Phones that ring and notify like phones, updates that install by themselves, and a second bug sweep.**

### Added

**Android rings and notifies like a phone (maintainer request).** River still
uses no Google push service: everything depends on River's own connection,
so Stay connected matters.

- **River for Android updates itself** (Settings → Updates). It checks GitHub
  Releases at start, about every six hours and on demand; takes only a release
  whose manifest is signed by River's release key (the desktop's verifier) and
  is newer, on your channel (Beta and Nightly only if you chose them); downloads
  the APK for the phone's processor; checks its SHA-256 and size against the
  signed manifest and that it is signed with the same Android key as the
  installed River; then hands it to Android's installer, which asks you to
  confirm. The first time, Android asks you to allow River to install apps.
- A release signed with a different Android key than yours (the early preview
  builds) is not installed over it: River explains that only a fresh install
  gets it, that uninstalling deletes River's data on the phone unless you back
  up first (Settings → Backup), and links the download page.

- **Incoming calls on Android** ring like a phone call: the phone's ringtone in
  a loop and a repeating vibration (silent and vibrate modes and Do Not
  Disturb respected), a call screen that wakes the phone and covers the lock
  screen with the caller's name, Voice or Video call, and big Answer and
  Decline buttons. With another app in front, Android's call notification
  (Answer / Decline) stays on top. Answer opens River straight into the call;
  Decline declines without opening River. Ringing stops when the caller hangs
  up or after 45 seconds. With notification previews hidden, the call screen
  says "Someone".
- **The "In a call" notification** is Android's ongoing-call notification with
  Hang up, naming the person (or "River call" with previews hidden).
- **Message notifications on Android**: one per conversation with the
  sender's name (Android's conversation style), sound and vibration; the lock
  screen shows sender and text only with "Sender and message" previews,
  otherwise "New message". **Light up the screen for new messages**
  (Settings → System, on by default) turns a dark screen on for a few seconds,
  but not during Do Not Disturb or for messages sent without sound.
- **Stay connected is on for new Android installs**; existing installs are asked
  once ("Get messages and calls when River is closed?"). Turning it on explains
  and then lets Android ask to stop battery optimization delaying River.
- **Settings → System → Calls and notifications** (Android): Stay connected,
  battery optimization, full-screen calls (Android 14+ asks separately) and
  notification permission, as Android reports them, each with a button to fix
  it. A one-time prompt offers the full-screen permission when it is missing.
- Stay connected keeps working with the screen off: a watchdog wakes the phone
  about every 15 minutes to check the connection (a ping that must be
  answered) and reconnect, and the service starts again after a restart of
  the phone or an update of River.

### Changed

- iPhone: Settings → Updates says plainly that a sideloaded app cannot update
  itself, and no longer shows update settings that do nothing there.

### Security

Trust audit: what a malicious or compromised server can do to end-to-end
encryption (CRYPTOGRAPHY.md §4b). Every change works with the previous
releases on desktop, Android and iPhone.

- A contact's identity key changing on an incoming message is accepted only if
  the server's bundle carries that key, the device list signed by it lists the
  sending device, and no shared community names another key. Verification is
  never cleared silently: a verified contact whose key changed shows "changed
  since verified" and gets nothing until you compare the new safety number.
  Marking as verified needs the number that was on screen.
- Copies from your own devices (sent messages, edits, friends list, groups) are
  accepted only from devices in your signed device list under your own
  identity key.
- Contacts' device lists are checked again at least daily (and when a message
  comes from a device River does not know); the newest versions seen are in
  backups, so a restore does not accept an older list.
- Community keys travel with a proof: sealed under the previous epoch's key.
  Keys from older Rivers are accepted only from members who held a genuine key
  before; rotations go only to such members. A rotation that reaches nobody is
  asked for again by the server and redone, and the app says the community is
  still on the previous key meanwhile. Pending members are never picked to
  rotate, and a refused claim hands over to the next member.
- Community messages and profiles can be sealed bound to their ID and sender
  (associated data v2); every River now opens them. Sending v2 starts in 2.12.
- Identity-bound call signals cannot be replayed within their ten minutes;
  signals from someone whose key just changed are refused until you look at it.
- The file cache is keyed by the whole file pointer, not the blob ID alone.
- Server: link-code slots are limited per address and for accounts made today;
  usernames given up are held 30 days for their owner; a deleted River ID can be
  registered again only with its own identity key.
- Docs: the recovery secret is 128 bits (16 Bytewords + 2 checksum words), and
  sealed sender is not implemented — CRYPTOGRAPHY.md said otherwise.

- **Social privacy**: posts and stories go only to friends who have answered
  (as the Friends page counts them), never to someone you only opened a chat
  with or sent a request to; a hand-picked audience is limited to friends too.
  Comments and reactions are relayed only to people who are still your
  contacts, comments from people you blocked are not shown on anyone's post,
  and posts and stories of people you removed leave your feed and their profile.

### Fixed

- **Updates on computers install by themselves.** Closing River only hides it in
  the tray, so a downloaded update used to wait for a real quit that rarely came
  (some people stayed on old versions for weeks). Now a verified update
  restarts River by itself while River is in the tray or unused for 10 minutes,
  never during a call, and River comes back in the tray if that is where it
  was. A PC that hosts River does it at night (3–5 am).

- Android: when River's core restarted (Android often ends background
  renderers), every River notification on screen disappeared. They now stay,
  as plain notifications that open River.
- Android: an interface renderer that kept crashing could rebuild River's
  screen in a loop; it is rebuilt at most three times a minute, then closes
  with a message.
- Opening River from a ringing call no longer risks answering "busy" to that
  same call.

- Traffic for group conversations you removed is dropped instead of waiting
  forever; only people you know can have messages wait for a group, at most 20
  each.
- Call invites are never kept to be replayed later, and one that waited longer
  than a ring lasts no longer rings.

- **A crash no longer leaves a blank window**: River shows "Something went
  wrong" with the error and Reload; a crash on one page leaves the rest of River
  working (and that page can be tried again).
- **Stories**: the viewer follows the story you are watching by its ID, so
  marking it seen no longer jumps to someone else or crashes when stories
  disappear. Video stories play (muted, inline) and move on when they end; the
  timer starts once the picture is shown, and holding keeps its progress.
  Arrow keys and Esc while writing a reply stay in the reply box. On touch
  screens, a hold pauses, a tap goes back or on, and a swipe down closes.
- **Posts that did not go out**: a post nobody received is removed instead of
  staying as if shared (sharing again makes no duplicate); people a post
  missed, deletes, "seen" receipts and comment relays are sent again later. An
  offline comment or like is taken back and says so (your comment returns to
  the box) instead of looking sent and being lost.
- **Profiles**: a bio that could not be saved is no longer shown as saved, and
  a new bio reaches your friends (once, a few seconds after the last change).
  Profiles update after likes, comments and deletes. On narrow windows (phones)
  your profile, bio and friends are reachable at the top of the feed.
- Photo previews in the post and story composer are freed when removed, cut
  off by the limit or closed.
- **Call history**: calls you decline show as declined and calls that were
  answered but never connected as "Could not connect", not as missed; new
  calls appear on the Calls page at once.
- **Adding a friend** again no longer sends a second greeting ("already sent");
  adding someone who asked you first accepts their request and says you are
  now friends; someone you blocked is refused with a reason. Pasting a bare
  River ID offers to add them instead of doing nothing.
- **Events**: a half-typed start time no longer crashes the form (Save waits
  for a valid time), and an event of another length (say 90 minutes) keeps it
  when edited instead of becoming one hour.
- **Shortcuts**: Space on a focused button presses it instead of jumping to
  the message box; Alt+↑/↓ and Ctrl+Alt+↑/↓ no longer switch channels from
  other fields, menus or dialogs (they still work from the message box).
- **Admin**: a new sign-up link is no longer shown as already copied, and a
  failed copy, sign-up mode change or cancelled link says so.
- Private channels stay private: deleting a category, or moving a channel synced
  to it elsewhere, now gives the channel the category's permissions as its own
  instead of making it public. The delete confirmation says so.
- Channel and category permissions that already allowed Administrator (from
  older versions) can be edited again, owner included; adding Administrator is
  still refused.
- Forum posts: opening a post loads its replies, and new replies appear live;
  a thread opened any other way fetches its replies; message links to a forum
  post open it.
- Dragging channels: the move shows at once (no snap back), is placed among all
  channels including ones you cannot see, and only needs Manage channels on the
  channel you moved. Reordering roles changes only roles below your own and is
  applied all at once; deleting a role closes the gap in the order.
- The role editor lists Time out members, View audit log, Manage events,
  Manage emoji & sounds and Priority speaker. The channel and category
  permission editors offer Allow only for permissions you hold there.
- "Community settings" is offered wherever any of its tabs is (Webhooks and
  Reports included), the same in every menu. Settings fit a phone screen: the
  tabs become a strip that scrolls sideways and the close button stays in reach.
- Webhooks list only channels you manage, and deleting one asks first.
- Replying in an archived thread is offered only to people who manage messages,
  as the server requires.
- New members of a screened community whose rules cannot be shown still get the
  welcome screen with a way in; accepting the rules and picking roles confirm
  properly.
- Notification level "Nothing" also hides mention badges and thread mention
  sounds; followed threads stay quiet in muted channels. Categories have their
  own mute and notification level (a channel's own setting still wins).
- Used-up invites are no longer listed as active; the audit log no longer skips
  entries that share a timestamp when loading older ones.
- `:emoji:` codes after text starting with `<` or a lone backtick (`<3 :party:`)
  are converted; switching communities marks the channel you left as read; the
  thread Follow button updates after you reply.

- **Account, devices, backup and settings audit.**
  - A device removed from its account (or an old backup restored) is no longer
    told its account was deleted: it says it was probably removed, offers
    **Link this device again** (forgets the stale account and identity and opens
    linking; only a code from the same account is accepted), and **Set up my
    account again** now creates the new account _before_ forgetting the old one
    — if the account still exists it explains that this device was removed,
    instead of a dead end. Every failure message is shown.
  - Cancelling at "Is this you?" on a new device no longer leaves a phantom
    device on the account: it sends a signed "no" (new `PUT /v1/link/:id/decline`)
    and the device that showed the code takes it off the list again.
  - "Link a new device" and "Link it" cannot be pressed twice (a second start
    could show a code of zeros; a second confirm published an outdated list);
    a start replaced or cancelled while reserving never shows its code. "Linked"
    clears after a moment and never shows on the new device itself.
  - "Last backup" is set only once the file is written (not when the save
    dialog is cancelled or writing fails), and the first backup needs the
    recovery phrase to have been shown.
  - Settings changed by River itself reach the screen at once (a phone without a
    screen lock turning app lock off, hosting turning on start-at-login, server
    moves, deleting the account), so a switch never shows a protection that is off.
  - Interface size is hidden on phones (it only zooms computer windows), and
    the keyboard hint names ⌘ on a Mac. "Start River when I sign in" is hidden on
    Linux, where River cannot do it, and the hosting text no longer claims it.
  - Esc no longer closes Settings while typing in a field or when something else
    handled it; closing Settings or switching tabs with unsaved profile changes
    asks first. The profile saves without a display name (it is optional) and
    cannot be saved twice at once.
  - Notifications shows the preview choice once, as one radio group.
  - Onboarding on an invite-only River server asks for a sign-up link, and River
    stops retrying the account in the background until it gets one. A device
    link arriving after the identity exists no longer strands the first run.
  - A pasted "@alice" is saved as "alice", and the username field shows what the
    server saved (it keeps lower case) instead of staying "changed".
  - The lock screen buttons no longer stay on "Encrypting…/Unlocking…" when a
    call fails, and passphrases longer than 1024 characters are refused up front.
  - Security Center describes what River does now: messages pass through the
    server end-to-end encrypted, devices can be linked, contacts verified by
    safety number.
  - Bulgarian: "Account" is "Акаунт" and "Profile" is "Профил".
  - The background picture is kept once in settings, with appearance profiles
    pointing to it, instead of a ~2.7 MB copy in every profile (settings files of
    up to ~80 MB); existing settings are compacted when read.

### Not on iPhone

- Without Apple's push service (it needs a paid Apple developer account), an
  iPhone cannot ring or notify while iOS has paused River. Settings → System
  says so; nothing here pretends otherwise.

## [2.10.12] - 2026-10-16

**Bug sweep: a review of the whole program — server, phone apps, calls, voice, messages and layout.**

### Security

- Channel and category permission overwrites can only allow what the person
  editing them holds there, and never Administrator.
- Self-assignable roles cannot be given moderation permissions later, and are
  checked again when a member picks them.
- `RIVER_TRUST_PROXY=true` now trusts only a proxy on the same machine (the
  River Host tunnel); a forged `X-Forwarded-For` no longer escapes per-address
  limits. Proxies elsewhere are named by address or range.
- A blocked sender is answered like for an account that does not exist, before
  any other check, so the answer no longer reveals the block. Apps show
  "That no longer exists" instead of pretending the message was sent.
- Webhooks stop posting once their creator is removed or may no longer manage
  the channel; wrong tokens no longer use up a webhook's rate limit; webhooks
  are deleted with their channel (and orphans are removed).
- Timed-out and pending members cannot join existing reactions; only members
  who may rotate move a community's key epoch (rate limited).
- Realtime connections end when their session expires or is revoked.

- **Link previews** refuse every non-public IPv6 spelling (IPv4-mapped as
  Node writes it, IPv4-compatible, NAT64, 6to4, site-local, documentation) and
  connect only to the address that was checked, so DNS rebinding cannot reach
  this computer or the local network.
- **Screen sharing**: the window can no longer hide the "can see your screen"
  bar while a screen River handed out may still be shared. The bar goes with
  its own Stop, the call ending, or the window reloading or crashing.
- **Passphrase**: pressing set up or unlock twice can no longer set up two
  different keys (making the data unreadable) or open the data twice.

### Fixed

- **Voice channels**: a second click on Join no longer starts a second call
  that kept the first microphone open; Disconnect while River is still opening
  the microphone or joining now really leaves (microphone off, nothing joined);
  a camera or screen that finishes opening after you left is stopped at once.
- People using voice activity no longer look **muted** to others while quiet,
  and their speaking ring shows again; a speaking ring no longer sticks after
  someone's voice stops.
- **Undeafen** keeps you muted if you were muted before deafening.
- The **microphone test** in Settings → Voice no longer leaves the microphone
  on when stopped before it finished opening.
- **Push-to-talk** no longer swallows its key (` by default) while you type in
  a text field; keys that type nothing (F-keys, Ctrl) still talk while typing.
- Joining a voice channel during a 1:1 call now ends that call properly (no
  stuck call pill, no "busy" answers to every new call); starting a 1:1 call
  from a voice channel no longer offers "Rejoin" for it later.
- **Phones**: voices played above 100 % (the phone default) are no longer
  silent while the audio engine is asleep; River wakes it from the Join,
  Call or Accept tap and plays voices directly until it runs.
- **1:1 calls**: hanging up while River is opening the microphone sends no
  invite and turns the microphone off; a double click starts one call; an
  unanswered incoming call is logged as missed (with the right voice/video
  type) when it stops ringing; answering without microphone access declines
  the call and logs it; a call the caller ends while you answer ends on your
  side too; an answered call that cannot connect within 30 seconds ends with
  a notice instead of "Connecting…" forever; the screen picker and minimized
  view start fresh with each call.

- A linked device that never published keys no longer makes its account
  unreachable; one device's full mailbox drops only its copy.
- One-time prekeys are claimed atomically (no key handed out twice on
  PostgreSQL); Kyber one-time prekeys are capped; a last-resort Kyber key whose
  ID matches a one-time key is stored instead of dropped.
- Device-list updates, invite use counts and the storage quota are now safe
  against concurrent requests; re-giving a role ignores an expired end time.
- Voice seats and call rooms belong to the connection that joined: a crashed
  desktop leaves the call even while the phone stays connected. Realtime events
  are handled in order per connection; a connection that closes while signing in
  is never kept; deleting a community ends its voice calls.

- **Android Back** no longer closes River: it first closes what the interface
  has open, and otherwise moves River to the background, still running.
- **Android calls and the lock screen**: River shows over the lock screen only
  while a call rings or lasts, not forever after one.
- **Android, Stay connected**: notifications work after Android restarts
  River's connection in the background; screen security is applied again when
  River's screen reopens; closing River during a call ends the call (and tells
  the other side) instead of leaving it silent; Hang up in the "In a call"
  notification works without River's screen; stopping River ends the "In a
  call" notification, the call audio and the screen-off sensor lock.
- **Android notifications**: a reply from a notification can never reach the
  wrong conversation after River restarted, and a reply that cannot be sent says
  so; swiped-away notifications are forgotten; the notification permission is
  asked while River is in front.
- **Android robustness**: River recovers when Android ends one of its
  WebViews to free memory instead of closing; dialogs always get an answer;
  databases are closed when the core stops; reopening River from recent apps no
  longer shares something again; Lock River hides River before Android takes
  the recent-apps preview (Android 13+: no preview at all while it is on).
- **iPhone and iPad**: an iPad is recognised as iOS; River restarts its core if
  iOS ends it; "Save to Files" reports a cancelled save as not saved and deletes
  the temporary copy when the sheet closes; swiped-away notifications are
  forgotten.
- **Phones**: a failed database commit reports its own error instead of a
  follow-up one.

- One realtime connection at a time (startup, sign-up and waking up opened
  two, and the extra one's events arrived twice); a refused (expired) session
  signs in again instead of retrying the dead one forever; a connection that
  never becomes ready is replaced after 20 seconds.
- **Set up again** and creating a first community after deleting the account
  work again for accounts on River's server.
- Linking a device: a failed sign-in on the new device no longer leaves it
  stuck with an identity and no account; the linked device refuses an expired
  code and takes a device it could not provision off the list again.
- A damaged settings file's recovered settings are saved (they were lost on
  the next start), and unknown settings no longer reset their whole section.
- Editing a message changes only its text: files, picture descriptions, the
  reply (and its no-ping), tags, previews and stickers stay, also for thread
  messages and older ones; an edit River cannot base on the original is
  refused. Saving an older or thread message works.
- Kept copies of received files stay under 2 GB (least recently used go first)
  and are deleted with the account; downloads of the same file at once are
  counted once.
- Notifications stay clickable on Windows; the Dock icon reopens River on
  macOS; settings changes no longer start an update check each time; a failed
  screen-share request is answered instead of hanging; the hosting PC keeps
  following its own server after taking over from River Host.

- **Phones**: Android's Back closes the topmost menu or dialog, shrinks a
  full-screen call, then goes from a conversation to the list. River opening
  a chat by itself (a notification, an accepted call, the quick switcher, a
  shared file) now shows it instead of leaving the list on screen. ☰ no longer
  covers dialogs or the call's ⌄; the member list can be closed again;
  Settings, the image viewer, toasts and full-screen dialogs keep clear of the
  notch and the gesture bar; menus stay above the iPhone keyboard and scroll
  when long; swiping a chat to open the list works again.
- **Touch**: menus, pickers and the image viewer open above the message, so a
  swipe in the viewer no longer also replies and a tap in a menu no longer
  toggles ❤️ or gets lost after a long press; double taps on reactions and
  links are left alone; the hover toolbar no longer sticks after a tap.
- **Message boxes**: on phones Return makes a new line (Send sends); Enter
  never sends while an input method is composing. Typing during a voice
  recording no longer throws it away, and the microphone is never left on.
  A failed send gives its text and reply back without overwriting what you
  typed since; files waiting to be sent stay when you switch chats.
- **Direct messages**: no call buttons for requests not yet accepted, or while
  a call rings; "Add people", renaming a group and "Mark as verified" show
  success only when it worked; "Jump to latest" counts only new messages;
  re-opening the open chat keeps your reply; the date picker allows today in
  your time zone; adding an existing friend opens your chat.
- **Channels**: older history no longer duplicates or stops early, and can be
  loaded again after switching channels; failed thread replies can be
  discarded; deleted thread replies disappear; threads open only once created;
  /nick and edits report failures and keep your text; decrypted pictures are
  kept within a memory budget; Escape closes only the topmost menu or dialog,
  and pressing a menu's button closes it.

## [2.10.11] - 2026-10-16

**Reply privately.**

### Added

- **Reply privately** to a group message (its menu): River opens a direct
  message with the person who wrote it, with their words quoted in the message
  box, ready for your answer.

## [2.10.10] - 2026-10-16

**Stickers in direct messages.**

### Added

- **Stickers in direct messages and groups**: 🗒️ next to the message box shows
  the stickers of all your communities; the one you pick is sent as an
  encrypted picture and shown small and frameless, like a sticker. Apps older
  than 2.10.10 show it as a small picture.

## [2.10.9] - 2026-10-16

**Contact profiles.**

### Added

- Tap a person's name at the top of a chat for their **profile**: a big
  picture, their bio, whether you verified them, Call, Video, Search and Media
  buttons, the groups you are both in, their River ID (tap to copy), the safety
  number, and Block.

## [2.10.8] - 2026-10-16

**Chat folders.**

### Added

- **Folders for your chats**, like Telegram: ＋ next to the chat filters makes a
  folder (a name and the people and groups in it); it shows as a tab beside
  All, Unread, People and Groups. ✎ edits or deletes the open folder. Up to
  ten folders, kept on this device only.

## [2.10.7] - 2026-10-16

**Jump to a date.**

### Added

- **Jump to a date** in direct messages and groups: 🔍 in the conversation →
  pick a day, and River goes to the first message from that day on.

### Fixed

- Search results older than the latest 500 messages in a conversation now open
  too: River loads the conversation back to that message instead of saying it
  is too old.

## [2.10.6] - 2026-10-16

**Link previews in direct messages.**

### Added

- With **link previews** turned on (Settings → Appearance), links you send in
  direct messages and groups get a preview card, as in channels. Your own
  device makes the preview and seals it in the encrypted message; the people
  you write to never fetch anything, and River's server never sees the link.

## [2.10.5] - 2026-10-16

**Polish: full-screen calls on phones.**

### Changed

- On phones, calls **fill the screen** like a phone or Instagram call: their
  video (or a big picture of them in a voice call) behind everything, your
  camera in a small corner window, the name, timer and status at the top and
  large buttons at the bottom. **⌄** goes back to the conversation with the
  call still on; **Full screen** brings it back.

## [2.10.4] - 2026-10-16

**Polls everywhere.**

### Added

- **Polls in direct messages and groups**: the conversation menu → 📊 Create a
  poll. One or several answers, open for an hour up to a week. The question,
  the answers and every vote are end-to-end encrypted (votes are encrypted
  reactions, as in channels); apps older than 2.10.4 show the question as a
  message.

## [2.10.3] - 2026-10-16

**Polish: albums.**

### Changed

- Pictures sent together in one message show as an **album**: a tidy grid
  (two side by side, three with a wide first one, four in a square, five or
  more in rows of three) instead of a row of different sizes. Tap any of them
  to open the viewer and swipe through.

## [2.10.2] - 2026-10-16

**Polish: calls like a phone call.**

### Added

- **Screen off at your ear**: in a call on the earpiece, holding the phone to
  your ear turns the screen off (Android and iPhone), so your cheek does not
  press buttons. On the loudspeaker the screen stays on.
- **Call timer**: calls show how long they have been going (0:42), in the call
  and in the "In call with…" bar.

## [2.10.1] - 2026-10-16

**Polish: touch.**

### Added

- **Double-tap a message** on a phone to react with ❤️ (double-tap again to take
  it back), in direct messages, groups and channels.
- **Hold a chat** in the list for its menu (Pin, Mark unread, Archive) on every
  phone, including iPhone.
- The **jump to latest** buttons count the messages that came in while you were
  reading older ones, in direct messages and channels.

### Fixed

- Letting go after holding a message no longer also opens the picture or link
  that was held.

## [2.10.0] - 2026-10-16

**Calls: picture-in-picture.**

### Added

- **Android**: during a call, going home or switching apps keeps the call in a
  small window on top (Android 12 and later do it by themselves; 8 to 11 when
  you press Home). The window shows their video with yours in the corner, or
  their picture in a voice call. Tap it to come back.
- **Computers**: a ⧉ button in video calls keeps their video in a small
  always-on-top window while you use other apps.
- iPhone does not have picture-in-picture for calls yet.

## [2.9.0] - 2026-10-16

**People.**

### Added

- **Add friends by QR code**: Friends → Add friend → **Show QR code** shows
  your friend code; **📷 Scan QR code** reads a friend's code with the camera
  and sends them a request. Camera pictures are decoded on the device and
  thrown away.
- **Note to self**: a conversation with yourself for notes, links and files
  (at the top of Direct messages). It is kept on this device, new notes are
  copied to your linked devices, and nothing is sent to anyone else. You do
  not show up as your own friend.

## [2.8.0] - 2026-10-16

**Phone feel.**

### Added

- **Swipe to reply**: pull a message to the left (direct messages, groups and
  channels) and let go to reply to it, like Telegram. A ↩ shows how far to go.
- **Hold for the menu**: holding a message opens its menu on every phone,
  including iPhone (Reply, Copy, Forward, Pin, Edit, Select, Delete).
- **Haptics** on Android and iPhone: a short vibration when a swipe reaches
  reply, when a hold opens the menu, on reactions and when a voice recording
  starts. It follows the phone's own touch-feedback setting.

## [2.7.0] - 2026-10-16

**Media.**

### Added

- **Move between pictures**: in the picture viewer, ‹ › buttons, the arrow keys,
  or a sideways swipe on phones go to the previous or next picture in the
  conversation; swipe down to close. A counter shows where you are.
- **Video speed**: a 1× / 1.5× / 2× / 0.5× button on videos.
- **Shared media** in direct messages and groups: the conversation menu →
  "Shared media, files and links" lists photos, videos, files, voice messages
  and links from the messages kept on this device.

## [2.6.0] - 2026-10-16

**Privacy controls.**

### Added

- Settings → System → **Privacy**:
  - **Read receipts** on or off. Off: people do not see when you read their
    messages, and you do not see when they read yours.
  - **Typing indicators** on or off, the same both ways.
  - **Screen security** (Android, Windows, macOS): blocks screenshots and screen
    recordings of River; on Android it also shows River blank in the app
    switcher.

## [2.5.0] - 2026-10-16

**Send later, send quietly.**

### Added

- **Send without sound**: ⏰ next to the message box → the other side gets the
  message without a notification.
- **Scheduled messages**: ⏰ → Schedule message… (in 1 hour, in 3 hours,
  tomorrow 9:00, or any time). A bar in the conversation lists what is waiting,
  with Send now and Cancel. River keeps scheduled messages encrypted on your
  device and sends them on time while it is on and online — River's server never
  holds them.

## [2.4.0] - 2026-10-16

**Disappearing messages.**

### Added

- **Disappearing messages** for any conversation or group (⋯ → Disappearing
  messages): 30 seconds up to 4 weeks. The setting is shared end-to-end
  encrypted with everyone in the conversation, a notice shows who changed it,
  and new messages carry a ⏱. Each device deletes its copy on time — together
  with the file attachments it kept — even if nobody opens the conversation.
- Honest limits, also shown in the app: a message can be copied or
  photographed before it disappears, an encrypted backup made before then still
  contains it, and both sides need River 2.4 or newer.

## [2.3.0] - 2026-10-16

**Voice messages.**

### Added

- **Record and send voice messages** in conversations and channels: tap the
  🎤 next to the message box (it shows while the box is empty), talk, then ➤ to
  send or ✕ to cancel. They are encrypted on your device like any file.
- **A voice-message player**: play/pause, drag to any point, the length, and
  playback speed 1×, 1.5× or 2×.

## [2.2.0] - 2026-10-16

**Message actions in conversations.**

### Added

- **A menu on every message** — right-click, or long-press on a phone: Reply,
  Copy text, Forward, Pin, Edit, Select, Delete for me, Delete for everyone.
- **Select several messages** to copy, forward or delete them together.
- **Search inside a conversation** (🔍 in its header); a result jumps to the
  message and highlights it.

## [2.1.0] - 2026-10-16

**A chat list like Telegram's.**

### Added

- **Pin conversations** to the top of the list (up to 10), **archive** them
  into an "Archived chats" row (which shows its unread count), and **mark as
  unread / read** — right-click a conversation, or long-press on a phone. These
  stay on your device, in its encrypted database.
- **Filters** above the list: All, Unread, People, Groups.
- **Jump to the latest message** in conversations: a round ↓ button with the
  unread count appears when you scroll up.

### Fixed

- A new message no longer yanks you to the bottom while you are reading older
  messages in a conversation.

## [2.0.4] - 2026-10-16

**Louder, clearer voice.**

### Added

- **Voice volume up to 200 %.** Settings → Voice has a Voice volume slider for
  everyone you hear, and each person's volume (in voice channels and now in 1:1
  calls too) goes up to 200 %. Above 100 % River boosts the sound through a
  limiter, so it gets louder without distorting.
- Phones play voices louder by default (160 %); change it in Settings → Voice.

### Fixed

- Android: during a call the volume buttons now change the call's volume, and
  the phone's audio returns to normal when the call ends.
- Per-person volume above 100 % was accepted but never applied.
- docs/product/telegram-parity.md: what River has compared with Telegram and
  Signal, and the plan for 2.1–2.10.

## [2.0.3] - 2026-10-16

### Added

- **Device names.** Settings → Account → Devices shows each device by the name
  typed when it was linked ("Alice's phone") instead of "Device 2". Names stay
  on your devices and are shared between them end-to-end encrypted.

## [2.0.2] - 2026-10-16

### Added

- **Calls ring like a phone call** (Android): an incoming call uses River's own
  "Calls" notification channel with the phone's ringtone, rings for as long as
  the call does, and fills the screen when the phone is locked. On computers
  the call notification stays until you answer or it stops ringing; on iPhone
  it makes a sound.

## [2.0.1] - 2026-10-16

### Added

- **Speaker or earpiece** (phones): a speaker button in calls and voice
  channels. Voice calls start at the ear, video calls and voice channels on the
  loudspeaker.

### Changed

- Server: `@fastify/websocket` 11.3.4.

## [2.0.0] - 2026-10-16

**River 2.0 — Stage 2 is complete: River on your computer and your phone.**

Everything since 1.0 in one place: River for Android (1.1) and iPhone (1.3);
one account on all your devices, linked with a code or a QR code (1.2), with
your friends list in step (1.6); phones that stay connected, keep calls going
with the screen off, take shares from other apps and let you reply from
notifications (1.4); call setup bound to identity keys and safer linking
(1.5); calls that ring in the background (1.7); consent-based remote
assistance — see and point, never control (1.8); and River's Stage 2 security
review with every finding fixed (1.9). From here River uses regular semantic
versioning (2.0.1, 2.1.0, …).

### Changed

- README, roadmap and status describe the finished Stage 2.

## [1.9.0] - 2026-10-16

**Hardening: River's Stage 2 security review.**

### Security

- **Stage 2 security review** (docs/security/1.9.0-review.md): the phone apps,
  linked devices, calls and remote assistance were reviewed; every finding is
  fixed in 1.3.1–1.8.0, and the threat model now covers phones, linked devices
  and remote assistance, including what remains (keys are not rotated when a
  device is removed; the Android preview key; the unsigned iPhone app).

### Fixed

- A slow encryption test no longer fails on a busy machine.

## [1.8.0] - 2026-10-16

**Remote assistance: see and point.**

### Added

- **Remote assistance: see and point.** When you share your screen in a call,
  a red bar stays on top of that screen saying who can see it, with a **Stop
  sharing** button — River shows it itself, outside the app window, so it
  cannot be hidden. People watching can point at something on your screen
  (Alt+click, or a click in fullscreen; in a 1:1 call just click), and you see
  a ring there. They can see and point; they cannot control your computer.
  Every share asks "Share your screen?" in a system dialog first.
  Design: docs/architecture/decisions/0007-remote-assistance.md.

## [1.7.0] - 2026-10-16

**Calls that reach you.**

### Added

- **Calls ring while River is in the background.** An incoming 1:1 call shows
  an "Incoming call" notification when River is in the tray (or closed on a
  phone that stays connected), and opening River from it shows the call ready
  to answer.

## [1.6.0] - 2026-10-16

**Devices in step.**

### Added

- **Your friends list follows you to new devices.** A newly linked device gets
  your friends and the people you blocked from your other devices (end-to-end
  encrypted, device to device), and accepting or blocking someone on one device
  reaches the others. A copy never unblocks or removes anyone.

## [1.5.0] - 2026-10-15

**Protocol and security: identity-bound calls, safer linking.**

### Security

- **Calls in communities are bound to each person's identity key.** Call setup
  (the connection details that protect a call's encryption) from people you
  have exchanged direct messages with must now carry a fresh signature by
  their identity key — the one your safety numbers verify — as well as the
  community key's seal. Before, the server together with another member could
  in principle have tampered with it. For people you have not messaged
  directly, calls are protected as before. People you message directly need
  this version for community calls with you.
- **"Is this you?" before linking.** A new device now shows whose account it
  received (name, server, River ID) and links only after you confirm, so a
  link code someone else made — for example one a web page opened — cannot
  quietly put your new device into their account.
- **Linking can no longer be blocked by strangers.** The device showing a link
  code now reserves its mailbox on the server first; only that slot accepts the
  new device's hello. Codes from older apps still work, a few at a time per
  network address. Before, anyone could fill every linking slot on a server.

## [1.4.0] - 2026-10-15

**Phones, day to day.**

### Added

- Phones: swipe right on a conversation to open the server and channel list,
  and left to go back, as in Discord.
- **Stay connected** (Android, Settings → System): River keeps its connection
  while closed, so messages and calls notify like any messaging app. Android
  shows a quiet "River is connected" notification while it runs. River uses no
  Google or Apple push service.
- **Calls keep going with the screen off** (Android): while you are in a call
  or a voice channel, an "In a call" notification keeps the microphone and the
  call running when you lock the phone or switch apps, with a Hang up button.
- **Reply from the notification** (Android, iPhone, macOS): answer a direct message
  right from its notification, without opening River. The reply is sent
  end-to-end encrypted like any message.
- **Share → River** (Android): share text, links, photos or files from any
  app to River, pick a conversation or channel, and it opens with them in the
  message box. Nothing is sent until you press Send.

### Security

- Android: other apps can no longer fake a tap on River's notifications (each
  carries a random secret), and Share → River refuses any address that could
  point back at River's own files.

### Fixed

- Voice: a connection that silently stops answering during a call is noticed
  within about ten seconds (was up to a minute) and replaced, and the voice
  relay key is sent again, so people who reconnect mid-call hear and are heard.

## [1.3.1] - 2026-10-15

**Security fixes for linked devices.**

### Security

- **Removing a linked device now ends its connection at once.** Before, a
  removed device that was online kept its realtime connection until it next
  reconnected. Found in River's own review of linked devices.
- **Older device lists are refused.** River remembers the newest signed device
  list it has seen for you and for each person, so a server cannot bring back a
  removed device by replaying an older list.
- Linking shows which server the code belongs to before you continue, and the
  removal message says plainly what removal does and does not do.

## [1.3.0] - 2026-10-15

**River for iPhone.**

### Added

- **River for iPhone** (iOS 16+): the same River as on Android and computers —
  the same interface and client, with libsignal, SQLCipher and the iOS
  Keychain underneath. The release has `River-ios-unsigned.ipa`, which you
  install with a free Apple ID through Sideloadly or AltStore (see
  docs/mobile).
- **Lock River** (phones, Settings → System): River asks for your fingerprint,
  face or screen lock whenever it opens, and hides itself in the app switcher.
- iPhone: a long press opens River's menus (messages, channels, members), as
  right-click does on computers.

## [1.2.0] - 2026-10-15

**One account on your phone and your computer.**

### Added

- **Linked devices — one account on your phone and your computer.** In
  Settings → Account → Devices, choose _Link a new device_; on the new device
  choose _I already use River — link this device_ and type the code. The new
  device gets your account, your communities and your name, handed over
  encrypted from device to device (the server cannot read it or slip in a
  device of its own). Direct messages reach all your devices, and what you
  send from one shows on the others. Remove a device any time; it is signed
  out for good. History from before linking stays where it was.
- **Link a phone with its camera.** The link screen shows a QR code; scan it
  with the new phone's camera app and River opens with the code filled in. You
  still confirm on both devices.
- Servers: `PUT /v1/accounts/me/devices` and the link mailbox (`/v1/link`),
  advertised as the `linked-devices` capability.

## [1.1.0] - 2026-10-15

**River for Android.**

### Security

- **A sign-up link from outside River no longer creates an account by itself.**
  "Open in River" (`river://open?link=…`) with a sign-up link used to register
  the account straight away when the app had none yet, on whatever server the
  link named, so a web page could choose your server. River now asks first:
  "Create your account on <server>?", and does nothing until you confirm. Invite
  and friend links already asked. Found in a review of the Android app's deep
  link handling; the fix is in the shared interface, so it covers desktop and
  phone.

### Added

- **River for Android** (Android 8.0+): the same River on your phone — the
  desktop's own interface and client, so everything works the same way and
  phones and computers talk to each other directly. Communities, channels,
  voice, direct messages and calls, files, invites; "Open in River" links;
  message notifications. Download `River-android.apk` from the release.
  This first build is a **preview** signed with a one-off key: the first build
  with River's permanent key will need one reinstall.
- Phone layout: one pane at a time — the conversation, or the server and
  channel list behind ☰; Back returns to the list.
- On the phone, the same protections as the desktop: libsignal for direct
  messages, sealed community content, the local database encrypted with
  SQLCipher and its key held by the Android Keystore. River's data is excluded
  from Android backups.
- **Protocol v1 is frozen.** `packages/protocol/schema/v1.json` holds
  the JSON Schema of every wire message and `packages/protocol/vectors/identity-v1.json`
  the cross-language test vectors (identity keys, fingerprints, verification
  words, safety numbers, a frozen signature) that the iOS and Android clients
  must reproduce. Tests fail on any drift. Rules: docs/protocol/stability.md.
- **Format vectors for protocol v1:** `packages/protocol/vectors/formats-v1.json`
  freezes the encrypted-attachment format, the recovery phrase and backup file,
  and the exact bytes signed for device lists, registration, sessions and
  account deletion. They are built independently of the library, so the code
  is checked against the specification.
- **Server capabilities:** `GET /v1/version` now lists `capabilities`
  (`attachments`, `community-key-epochs`, `voice-relay`, `delete-account`) so
  apps can tell whether a server supports a feature before sending new request
  fields. Servers without the list are treated as supporting none.
- **Realtime reference** (docs/protocol/realtime.md): the `/v1/ws` handshake,
  every client and server event, rate limits, close codes and the binary voice
  relay frame format.

### Changed

- Servers accept requests from River's phone apps (CORS for River's own app
  origins only; the API uses bearer tokens, never cookies).
- The roadmap for Stage 2 now starts with Android (1.1.x), then phones day to
  day (push, 1.2.x), one account on several devices (1.3.x) and iOS (1.4.x).

### Fixed

- **Docs:** CRYPTOGRAPHY.md said groups use libsignal Sender Keys and were
  "planned". Groups (0.6.0) use pairwise sessions; the document now says so.

## [1.0.46] - 2026-10-15

**Specter's skins, and you choose your look.**

### Changed

- **The skins are now Specter's** (martex-dev/specter): Specter, Neon, Aurora,
  Terminal, Paper, Synthwave, Blueprint, Brutal, Retro, Holo and Glitch — each
  with its six palettes — plus Luxury, Corporate and Nature: 14 skins, 84
  palettes. Specter's typography (Segoe, Bahnschrift, Sitka, Arial Black,
  Tahoma, Cascadia), Retro's bevels and caption bar, Brutal's hard shadows,
  Holo's prism borders, Glitch's RGB split and notches, Blueprint's grid
  paper, and floating panels in Aurora, Synthwave and Holo.
- **No built-in look any more.** River's own default skin is gone: everyone
  chooses a skin and palette first (once — existing users too), and can switch
  or customise it any time in Settings → Appearance.
- Settings → Appearance shows the skins as a gallery and the chosen skin's
  palettes as chips, like Specter.
- Palette accents fill buttons and highlights in their true colours; wherever
  an accent colours text, a readable version is used.

### Fixed

- Buttons without a style used the browser's grey instead of the theme.

## [1.0.45] - 2026-10-15

**Make River yours: 14 skins, 107 themes, and a personalisation centre.**

### Added

- **Skins** — whole design languages, not colour swaps: River (signature),
  Cyberpunk, Space Tech, Glass, Neon, Luxury, Minimal, Corporate, Industrial,
  Terminal, Retro Future, Nature, Editorial and Accessible. Each has its own
  typography, shapes (cut corners, hexagon avatars, sharp or pill buttons),
  materials (glass, glow, flat), background pattern and message layout.
- **107 themes** across them, light and dark — from Neon District and Outrun
  to Enterprise Blue, Paper and High Contrast.
- **Settings → Appearance**, rebuilt as a personalisation centre:
  - a theme browser with live miniature previews, search, skin and style
    filters, favourites, and **Try** (see the whole app, then Apply or Cancel);
  - every colour editable, with contrast checks, saved as your own themes;
  - typography (8 interface fonts, 7 heading fonts, 4 code fonts, weight, line
    height, letter spacing, table numbers);
  - layout (messages as classic, bubbles, cards, compact or terminal; your
    messages left or right; picture shapes; navigation left or right; rail,
    sidebar and member-list sizes; readable column; spacing; focus mode);
  - components (button and tab styles, badges, scrollbars, rounding, borders,
    icon size and stroke);
  - effects (intensity, contrast, saturation, depth, glass, blur, glow,
    gradients, shadows, ten patterns);
  - backgrounds (gradient, aurora, mesh, or your own picture, dimmed and
    blurred), motion speed and hover effects;
  - **profiles**: save complete looks, switch in one click, seven starting
    points, export and import (validated data, never code), reset.
- The window buttons on Windows follow the theme; River remembers the look so
  it never flashes the old one at startup.

### Changed

- The old single look is gone; River starts in River · Deep Current. Every
  screen now draws from shared design tokens, and text stays readable (WCAG AA)
  whatever theme or colours are chosen.

## [1.0.44] - 2026-10-14

**Big calls that stay clear: tested with 16 people for an hour, Bulgaria ↔ USA.**

### Fixed

- **Nobody goes silent in a call any more.** After a short server reconnect,
  one person could stay shown as connected while some others could no longer
  hear them for the rest of the call. Found by a real 16-person test across
  the Atlantic; River now corrects such a pair within 2 seconds.

### Added

- A voice field test: real River clients on machines in another country join
  one call through the internet and measure, every 15 seconds, whose voice they
  actually hear. Result with 16 people for 65 minutes: nobody dropped, everyone
  heard on average 14.95–15 of 15 others. See
  docs/security/voice-field-test-2026-10-14.md.
- ADR 0005: proposed plan for the phone apps.

## [1.0.43] - 2026-10-13

**A permanent address for home hosting, and code signing on the way.**

### Added

- **A permanent, free address for communities hosted on your PC.** Install
  Tailscale on the hosting PC and sign in (free): River serves your
  communities through Tailscale Funnel at `https://<your-pc>.<tailnet>.ts.net`,
  an address that never changes and does not drop every few minutes like the
  Cloudflare quick tunnel. River switches over by itself, keeps members
  connected through the quick tunnel while it does, and falls back to it if the
  permanent address ever stops answering. Settings → Hosting walks you through
  it (Download Tailscale, sign in, **Allow in Tailscale** once).
- **Windows code signing, ready to switch on.** The release workflow can send
  the Windows installer to SignPath Foundation's free open-source signing and
  publish the signed file (with `latest.yml` and the block map rewritten so
  updates keep working). It turns on once the project is accepted; until then
  installers stay unsigned. Policy: CODE_SIGNING.md.

### Changed

- PRIVACY.md now lists everything the app talks to today (River server, calls,
  ntfy.sh for moved servers, invite pages, link previews, updates, and the
  tunnel provider on a hosting PC).

## [1.0.42] - 2026-10-13

**A Discord-style layout.**

### Changed

- **River now looks and works like Discord.** One rail down the left: **Home**
  at the top, your communities under it, **Create or join a community**, and —
  on the PC that hosts River — **Admin** at the bottom. Next to it, a sidebar
  (a community's channels, or Home's friends and direct messages) with you at
  the bottom: your name, status, mute, deafen and the **Settings** gear.
- **Home** holds Friends, Social, Calls, Files and your direct messages, with
  search at the top. The old dashboard page and the separate Messages page are
  gone; your River ID is no longer shown there.
- **Settings is one full-window overlay** over whatever you were doing, like
  Discord's: User settings (Account, Profile, Security, Backup) and App
  settings (Appearance, Voice & video, Notifications, System, Updates, Hosting,
  About). Esc or the close button returns you to where you were. The Security
  Center lives under Settings → Security.
- A thin title bar shows where you are and your connection; the window
  controls moved into it. Solid, layered dark colours replace the glass look.
- "Create or join a community" keeps you and your Settings at the bottom left.

## [1.0.41] - 2026-10-13

**Calls that stay up, and invites anyone can follow.**

### Fixed

- **Voice calls no longer lose people every few minutes.** The free tunnel that
  connects members to a home-hosted server drops every connection every few
  minutes (median 3.4 min on the live host). People whose voice went through
  the server vanished from the call for up to ~20 seconds each time; now
  everyone stays in the call and keeps hearing everyone. Tested with 10 people
  and the connection cut every 20 seconds for 5 minutes: nobody dropped, sound
  never stopped.
- **"reconnecting…" only when someone's voice is actually interrupted** — not
  every time their link to the server blips while their voice keeps playing.
- **No more dead end when the server forgets your account.** River used to
  retry forever ("The server did not recognise this device"); now it explains
  what happened and offers **Set up my account again** in Settings → Account.
- **New accounts are set up within seconds** after a network blip, instead of
  waiting a minute.

### Added

- **Invite links that never go stale.** Links to River's home server now use
  https://martex-dev.github.io/river/join#… — they keep working after the host's
  PC restarts and its address changes.
- **A real invite page.** Opening an invite in a browser shows a download for
  your computer, exactly what to click past "Windows protected your PC" and
  macOS warnings, and **Open in River**.
- **Open in River.** River now handles `river://` links, so clicking an invite
  opens River and asks "Join this community?" — no copying and pasting.
- **Stable download links** for the newest installer, e.g.
  https://github.com/martex-dev/river/releases/latest/download/River-Setup.exe

### Security

- Review: `docs/security/1.0.41-review.md`.

## [1.0.40] - 2026-10-13

**River 1.0.x, complete: what's new after every update, and everything from 1.0.28 to here in one place.**

### Added

- **What's new after an update:** a small card lists the highlights of the
  version you just got, once, with a link to all changes. Fresh installs see
  nothing.

## [1.0.39] - 2026-10-13

**Moderators can move people between voice channels, and the 1.0.x docs are up to date.**

### Added

- **Move people between voice channels:** moderators with Move members pick
  "Move to…" on someone's profile card; River takes them there (even into a
  full channel) and tells them where they were moved. Audited.

## [1.0.38] - 2026-10-13

**Easier for everyone: screen readers hear new messages, and reduced motion means still pictures.**

### Added

- **Screen readers hear new messages** from others as they arrive in the
  channel you are reading ("Ada: hello", "Ada: sent 2 files"); loading
  older history stays quiet.
- **Reduced motion covers stickers and custom emoji too:** animated ones
  show their first frame.

## [1.0.37] - 2026-10-13

**Less clicking, less redrawing: change roles for many members at once, and a smoother chat.**

### Added

- **Change roles of many members at once:** tick members in Community
  settings → Members, then give or remove a role for all of them. River says
  how many changes the server accepted.

### Changed

- **Smoother chat during calls:** messages no longer redraw when someone
  types or speaks; each one updates only when something it shows changes.

## [1.0.36] - 2026-10-13

**More of River in Bulgarian.**

### Added

- **More of River in Bulgarian:** Community settings, category and role
  menus, and the voice panel.

## [1.0.35] - 2026-10-13

**Quicker hands: push-to-talk clicks and right-click menus for categories and roles.**

### Added

- **Push-to-talk clicks:** a tiny sound when you start and stop talking
  with push-to-talk (Settings → Notifications → Voice channels).
- **Right-click a category** to mark it read, collapse or expand it, and
  (for managers) create a channel in it or edit it; right-click a role in
  Community settings to edit or delete it.

## [1.0.34] - 2026-10-13

**Little things that feel right: animated avatars, and a quick way back into a call.**

### Added

- **Animated avatars:** a small GIF (up to about 44 KB) stays animated as
  your picture, everywhere and per community; larger ones are cropped to a
  still as before. With reduced motion on, you see its first frame.
- **Rejoin call:** if River closes or loses a voice call without you
  pressing Disconnect, the sidebar offers to put you back (for two hours).
  Not after a moderator disconnects you.

## [1.0.33] - 2026-10-13

**Be heard when it matters: priority speaker.**

### Added

- **Priority speaker:** a new role permission. People who have it get a 📣
  button in voice; while it is on and they talk, everyone else is turned
  down for the listeners. Listeners only honour it from people the
  community really allows.

## [1.0.32] - 2026-10-13

**Webhooks without giving up encryption: services post into channels, and the server still cannot read a word.**

### Added

- **Encrypted incoming webhooks** (Community settings → Webhooks): let a
  script or service post into a text channel. The poster seals each post
  with a key that lives only in the secret webhook address, so the server
  still cannot read it ([ADR 0004](docs/architecture/decisions/0004-webhooks-and-bots.md)).
  Posts show a **WEBHOOK** badge; deleting a webhook stops its address at
  once. `scripts/webhook/post.mjs` is a dependency-free example poster.

## [1.0.31] - 2026-10-13

**Know your invites: see who made each link and who joined with it, and revoke it.**

### Added

- **Invite tracking:** Community settings → Invites lists each active link,
  who made it, how many uses are left, when it expires and who joined with
  it. Revoke stops a link at once (audited); people who already joined stay.

## [1.0.30] - 2026-10-13

**Roles that fit: drag to reorder, and roles that end on their own.**

### Added

- **Drag roles to reorder them** in Community settings → Roles.
- **Temporary roles:** give someone a role for an hour, a day, a week or
  30 days from their profile card (⏳ shows until when); it goes away on its
  own.

## [1.0.29] - 2026-10-13

**Make it yours: community pictures and banners, pins in direct messages, and calls in the conversation.**

### Added

- **Calls show up in the conversation:** "📞 Call · 5 min", "Missed call"
  and "no answer" lines appear between your messages.
- **Pin messages in direct messages and groups** (📌 on a message); the
  header lists what's pinned. Everyone in the conversation sees it.
- **Community picture and banner** (Community settings → Overview): a real
  picture instead of an emoji in the list, and a banner above the channels.
  End-to-end encrypted.

## [1.0.28] - 2026-10-13

**Safer communities: a word filter and warnings before suspicious links.**

### Added

- **Suspicious link warnings:** before opening a link, River warns about
  look-alike characters, raw IP addresses, short links that hide where they
  go, and unencrypted http.
- **Word filter** (Community settings → Rules & roles): words and phrases
  that River hides (with Show anyway) or stops people from sending. It
  ignores case, accents and look-alikes; moderators still see everything.
  Because the server cannot read messages, each River app applies it.

## [1.0.27] - 2026-10-12

**Speak your language: a language setting, plus age-restricted channels and clearer roles.**

### Added

- **Role mentions explain themselves:** hover or focus one to see the role,
  how many people have it and whether you do.
- **Click someone in a voice channel** (or right-click) to open their
  profile card, with volume and moderator controls.
- **Age-restricted channels (18+):** people confirm their age once per
  channel before opening it (channel settings).
- **Language** (Settings → Appearance): English, or Bulgarian (beta,
  partly translated: navigation, settings, menus and voice controls so
  far), or follow your system. Changes apply at once.

## [1.0.26] - 2026-10-12

**Understand your community: why someone can or can't, insights, and media channels.**

### Added

- **Media channels:** turn a text channel into a gallery of the pictures
  and videos shared there (channel settings → Media channel); the chat is
  one click away.
- **Entrance sounds:** pick a soundboard sound that plays when you join a
  voice channel in that community (Community settings → Soundboard).
- **Leave voice when you're alone** after 5, 15, 30 or 60 minutes
  (Settings → Voice; off by default).
- **Mute a conversation** for 15 minutes up to for good (⋯ in a direct
  message or group): no sound and no desktop notification.
- **Insights** (Community settings): members, who's online, new members per
  week, roles, messages per day, busiest channels and most active people —
  counted on your device, since the server cannot read messages.
- **Check someone's access:** in a channel's permissions, pick a member to
  see what they can and can't do there and exactly why — including changes
  you have not saved yet.

## [1.0.25] - 2026-10-12

**Little comforts: your GIFs, your picture, your shortcuts — and slash commands.**

### Added

- **Slash commands:** type `/` for /shrug, /tableflip, /me, /spoiler,
  /poll, /nick, /status, /online, /idle, /dnd, /invisible, /mute 1h and
  /unmute, with suggestions as you type.
- **Pin and close forum posts** (moderators: right-click a post); pinned
  posts stay on top.
- **Follow threads:** threads you start or reply in are followed, so you
  hear about new replies; Follow / Following in the thread header.
- **Crop your picture:** drag and zoom to choose exactly what shows.
- **A different picture per community:** right-click a community →
  Nickname & picture here.
- **Screen share quality:** choose Sharp text (1080p, 15 fps), Balanced
  (720p, 30 fps) or Smooth motion (1080p, 60 fps) when you share; River
  remembers your choice.
- **Group icons:** group admins pick an emoji for the conversation
  (right-click the group → Change icon).
- **Your GIFs, privately:** click ☆ on any GIF or picture in a chat to keep
  it, then send it again from the GIF button. They stay in your encrypted
  database; no GIF service ever sees what you look for.

## [1.0.24] - 2026-10-12

**Welcome people well: rules, pick-your-roles, stickers and cleaner moderation.**

### Added

- **Stickers:** communities add their own (Community settings → Stickers);
  send one with the 🗒️ button next to the message box. End-to-end encrypted.
- **Delete many messages at once:** moderators right-click → Select
  messages, click the ones to remove (up to 100) and delete them together.
- **Audit log filters:** by kind of change, by person and by text, and copy
  what you see.
- **Rules and onboarding** (Community settings → Rules & roles): a welcome
  note and rules new members see first; optionally they must accept the
  rules before they can post, react or join voice (the server enforces it).
- **Pick your roles:** offer roles members can give themselves (never ones
  that moderate); new members are asked after accepting the rules, and
  anyone can change them from the community menu.

## [1.0.23] - 2026-10-12

**Yours to keep: export your data, private link previews and moderator notes.**

### Added

- **Link previews, made privately** (Settings → Appearance, off by
  default): when you send a link, your River fetches the page's title and
  description and seals them into your message, so people reading it never
  contact the site. River never fetches local or private network addresses.
- **Moderator notes:** people who moderate members can keep private notes
  on someone's profile card (encrypted; only moderators see them).
- **Hear about reactions** to your messages (Settings → Notifications,
  off by default).
- **Forward direct messages** to a channel or another conversation.
- **Export my data** (Settings → Account): save a readable copy of your
  profile, settings, contacts, direct messages, groups, calls, posts and
  saved messages. It never contains your keys.

## [1.0.22] - 2026-10-12

**Bring the room to life: soundboard, forums, stages and your own shortcuts.**

### Added

- **Soundboard.** Play short sounds to everyone in a voice channel from the
  🎵 button; right-click one to hear it yourself first. People with *Manage
  emoji & sounds* upload clips (up to 5.5 seconds) with a name and emoji in
  Community settings → Soundboard. Sounds are end-to-end encrypted; set or
  turn off their volume in Settings → Voice, and muting someone for yourself
  silences their sounds too.
- **Forum channels:** posts with a title, tags and their own replies, shown
  as a list you can search, filter by tag and sort. Create one from Create
  channel, or turn a text channel into a forum in its settings.
- **Stage channels** for talks and events: people join as listeners, raise
  a hand to ask to speak, and moderators invite speakers up or move them
  back to the audience. Create one from Create channel, or turn a voice
  channel into a stage in its settings.
- **Temporary bans:** ban someone for an hour, a day, a week or 30 days;
  they can rejoin once it ends.
- **Change your voice shortcuts** (Settings → Voice → Keyboard shortcuts):
  mute, deafen, camera and leave voice, with clash warnings.

### Fixed

- A permission refusal for something other than joining (for example a
  moderation action) no longer drops you from the voice channel.

## [1.0.21] - 2026-10-12

**Keep it friendly: reports, cleaner bans, role icons and pictures everyone can follow.**

### Added

- **Report a message** (right-click → Report message): pick a reason and
  optionally add details. It goes only to the people who moderate messages
  in that community, who get a **Reports** tab in Community settings to open
  the message, resolve, dismiss or reopen reports. Reasons and copies are
  end-to-end encrypted; every decision is in the audit log.
- **Ban and clean up:** banning someone can also delete their messages from
  the last hour, 6 hours, a day, 3 days or a week.
- **Role icons:** give a role an emoji; it shows next to the names of people
  with that role.
- **Cancel an upload** while files are encrypting and uploading — your
  message and files stay in the box.
- **Describe pictures (alt text)** with the ALT button before sending; screen
  readers read it, and an ALT badge shows it on the picture.
- **Member since** on profile cards.

## [1.0.20] - 2026-10-12

**Get around faster: back and forward, search filters, quiet hours — and better voice control.**

### Added

- **Back and forward**, like a browser: Alt+← / Alt+→ (⌘[ / ⌘] on a Mac)
  or your mouse's back and forward buttons walk through the channels,
  conversations and pages you opened.
- **Search filters:** `from:`, `in:`, `has:image|video|audio|file|link|poll`,
  `before:`, `after:`, `during:`, `pinned:true` and `mentions:me`, with
  clickable hints under the search box. **Jump to a date** in the open
  channel. Opening an older result now loads history until it is on screen.
- **Quiet hours** (Settings → Notifications): no pop-ups or notification
  sounds between two times every day.
- **Each channel and conversation keeps its own unsent text** while River is
  open, instead of carrying it into the next one.
- **Duplicate a channel** (right-click it) with its category, topic,
  permissions and settings, and **duplicate a role**.
- **Rename custom emoji** (click the name) and **favourite emoji**:
  right-click any emoji in the picker; favourites get their own ⭐ tab.
- **Server deafen** for moderators with *Mute & deafen members*: the person
  hears nothing and cannot speak until undeafened, and is told.
- **Input sensitivity** for voice activity (Settings → Voice): turn off
  automatic sensitivity and set how loud you must be to be heard, with a line
  on the microphone meter.

## [1.0.19] - 2026-10-12

**Make it yours: custom emoji, saved messages, and a clear view of every call.**

### Added

- **See how each person's call is doing:** little bars on every call tile;
  hover for "Direct · 38 ms · 0% loss" or "Via your server".
- **Saved messages:** right-click → Save message, and find everything you
  saved under 🔖 in any channel (kept only on this device).
- **Transfer ownership** of a community from someone's profile card.
- Each community reopens on the channel you used last; very long messages
  start folded with **Show more**; profile cards can copy a River ID.
- **Custom emoji.** Upload a community's own emoji in Community settings →
  Emoji (people with the new **Manage emoji** permission); everyone uses them
  with `:name:` in messages and as reactions, from the picker's community tab
  or by typing `:` and part of the name. A message that is only an emoji shows
  it big. Pictures and names are end-to-end encrypted.

## [1.0.18] - 2026-10-12

**Plan together: events, polls, mutes, folders, profiles — and your account is yours to delete.**

### Added

- **Scheduled events.** Plan a game night or a study call: name,
  description, start time, how long, and a voice channel or a place. Everyone
  sees upcoming and live events at the top of the channel list, can mark
  themselves **Interested**, and gets a reminder when it starts (with a "Join
  voice" button while it is on). People with the new **Manage events**
  permission can edit, cancel or delete them. Name, description and place are
  end-to-end encrypted.
- **Delete your account** (Settings → Account). It is removed from your
  server for good — you leave your communities, communities you own are
  deleted, and your keys and devices are gone there — after you confirm, and
  River proves the request with your device key, so a stolen session alone
  can never delete an account. River will not quietly make a new account for
  you afterwards.
- **Polls.** Click 📊 next to the message box: a question, up to ten
  answers, one or several choices, open for an hour to a week. Results show
  as bars that update live. Questions, answers and votes are end-to-end
  encrypted — the server cannot tell who picked what.
- **Richer profiles:** About me, pronouns and a banner colour, with a live
  preview in Settings → Profile; shown on your profile card in every
  community, end-to-end encrypted.
- **@ ON/OFF on replies:** choose whether the person you reply to is
  notified.
- **View reactions:** right-click a message or a reaction to see who reacted
  with what.

- **Mute a community or channel** — for 15 minutes, an hour, 8 hours, a day,
  or until you turn it back on — and choose **All messages**, **Only
  @mentions** or **Nothing** for any community or channel. Right-click it in
  the list. Muted places are dimmed and quiet; @mentions still reach you
  unless you chose Nothing.
- **Make River the size you like:** interface size (Ctrl+= / Ctrl+− /
  Ctrl+0), message text size, 12- or 24-hour clock, and a **high-contrast**
  mode that also turns on when your system asks for more contrast
  (Settings → Appearance).
- **Folders and your own order for communities.** Drag communities in the
  list on the left to reorder them; drop one onto another to make a folder.
  Click a folder to open or close it; right-click it to rename it, pick a
  colour, mark it read or ungroup it.
- Coming back to a channel you had scrolled up in returns you to the same
  place.
- **Zoom and pan in the image viewer** (wheel, +/−, double-click, drag) and
  **Copy image**.

### Fixed

- Editing a message no longer drops its reactions after the community key
  changed (the edit is now sealed with the message's own key), and keeps
  everything else in it.
- The Notifications settings no longer claim they take effect "when
  messaging arrives in River 0.2".

## [1.0.17] - 2026-10-11

**Express yourself: status, formatting, every emoji, message links.**

### Added

- **Status, like on Discord.** Click your name in the corner to be Online,
  Idle, Do Not Disturb (no notifications or notification sounds) or Invisible
  (appear offline but use River as usual). River shows you as Idle after ten
  minutes away from the computer. Idle and Do Not Disturb have their own
  shapes, not just colours.
- **Custom status** with an emoji and "clear after" (today, 4 hours, 1 hour,
  30 minutes or never). It shows under your name in member lists and on your
  profile card, and it is end-to-end encrypted like the rest of your profile.
- **Full message formatting:** `||spoilers||`, `# headings`, `-# small text`,
  bulleted and numbered lists, `***bold italic***`, `\` escapes, links and
  `[masked links](https://…)`, and `<t:…>` timestamps shown in your own time
  zone. Code blocks get syntax highlighting and a Copy button.
- **Links are safe to click.** River shows the real address (look-alike
  letters spelled out) and asks before opening your browser.
- **Message links, Quote and Forward.** Right-click a message (or click its
  time) to copy a link to it; in River the link opens the message, in a
  browser it only says "open River". **Quote** puts the message in your reply
  as a quote; **Forward** sends it to another channel or conversation.
- **Click someone's avatar or name** in the chat to see their profile card.
- **Keyboard:** Ctrl+F searches, Ctrl+Alt+↑/↓ switches communities, Esc marks
  the channel read and jumps to the newest message (Shift+Esc: the whole
  community), and you can start typing anywhere to write a message.
- **Every emoji, searchable.** The picker has all Unicode emoji by category,
  search by name or keyword, and your recently used ones. Type `:` and two
  letters for suggestions; `:fire:` becomes 🔥 when you send.

## [1.0.16] - 2026-10-11

**Voice that stays connected — on every network.**

### Added

- **Voice works even when two people cannot connect directly.** Some networks
  (mobile data, strict routers, school or work firewalls) block direct calls
  between certain people, and River had no fallback, so they simply could not
  hear each other. Now River sends their voice through your River server —
  still end-to-end encrypted: the server forwards sealed audio frames and
  cannot listen. Tiles show "via server" while it is in use, and River
  switches back to a direct connection as soon as one works. Voice only:
  camera and screen sharing still need a direct connection. This works for
  1:1 calls from a conversation too.
- **Connection check** in Settings → System: one button tests the address
  relay, your account, the server (and how fast it answers), the live
  connection, hosting, what kind of network you are on for calls, and your
  microphone — with plain-language advice and a report you can copy.
- **River never fails to open silently.** If something goes wrong while
  starting, River now says what happened (with a "Copy details" button and the
  log folder) instead of staying invisible in the background, which made every
  later launch do nothing until a restart. The window appears even if the
  graphics driver is slow to draw, a crashed window reloads itself, and if the
  graphics driver keeps crashing River restarts without hardware acceleration.
- `River --self-test` checks that an installation works (encryption
  libraries, database, keys, interface) without touching your data. Every CI
  run and every release now runs it against the packaged app on Windows,
  macOS and Linux.

### Fixed

- **A 1:1 call now rings while you are in a voice channel.** River used to
  answer "busy" without telling you; accepting now leaves the voice channel.
- **Voice channels no longer drop everyone every minute or two.** A home
  server's public tunnel reconnects every few minutes, and each time every
  member's connection to the server was cut — and the server threw everyone out
  of voice at once. Calls run directly between members' computers, so now the
  server keeps your seat for 45 seconds (shown as "reconnecting…"), River
  reconnects and takes it back by itself, and the call keeps playing the whole
  time. Call setup sent during the gap is delivered afterwards.
- **Joining a voice channel with several people now always connects.**
  Connections between members repair themselves: a network blip gets an ICE
  restart on the same connection, a failed connection is rebuilt with backoff
  for as long as the person stays in the channel (it used to give up after four
  tries), answers and candidates from a replaced attempt are ignored, and call
  setup from each person is handled strictly in order.
- River pings the server every 20 seconds, so tunnels never close the
  connection for being idle, and a connection that silently died is replaced
  within a minute instead of hanging. The server pings too, and announces
  someone offline only after 15 seconds, so short drops no longer flash
  everyone offline.

- **Invite links from the hosting PC work for everyone.** Since 1.0.14 the host
  talks to its own server over 127.0.0.1, and its invite, friend and sign-up
  links carried that private address. Links now always use the public address.
- Friend links that name an older address of your server are no longer
  refused as "another server".

## [1.0.15] - 2026-10-10

### Fixed

- **The hosting PC's own account now always connects to it.** If your account
  had no saved server identity (accounts from before 1.0.8, or one that was
  lost), River proves your account lives on this PC's server by signing in with
  your device key, then connects to it directly. It never moves an account to a
  server that does not hold it.

## [1.0.14] - 2026-10-10

**No more server talk — River just connects.**

### Fixed

- **"Server unreachable" on the PC that hosts.** Your own River now talks to
  your server directly, so it connects instantly and never chases a public
  address. If it ever missed the switch before, it recovers by itself.

### Changed

- The interface drops the "server" language. **Settings → Account** leads with
  your **@username** and a plain **Connected / Offline**; the account ID,
  device and connection details move under **Technical details**. Elsewhere
  River says "Connecting…" and "you're offline — messages send when you're
  back", not "your River server".
- People who have an account but no username yet are prompted to pick one.

## [1.0.13] - 2026-10-10

**Usernames: add people the way you do on Discord.**

### Added

- **Usernames.** Pick an @username when you set up River; people add you by it.
  No more River IDs to copy. Change it any time in Settings → Account.
- **Add friends by @username** on the Friends page (links and IDs still work).
- **Operator: create accounts.** On the PC that hosts the server, Admin can
  create an account ahead of time — a sign-up link that carries a chosen
  username — cancel pending ones, and switch the server between **open**
  (anyone can join) and **invite-only** (only people you make a link for).
- Admin lists everyone by @username.

### Changed

- Settings → Server is now **Settings → Account**, with your username and the
  server details together. The top bar shows **Online**, not an address.

## [1.0.12] - 2026-10-10

**One River for everyone: install, pick a name, and you are in.**

### Added

- **Your account is created by itself.** River now has a home server built in.
  Right after you pick your name, River finds it and creates your account —
  no server address, no "Create account" button. If the server is away, River
  says "Setting up your account…" and finishes on its own when it is back.
- **Communities go to River's server.** Creating a community just needs a name;
  another server is still one click away ("Use a different server").
- **Admin, for whoever hosts the server.** On the PC that hosts it, a new Admin
  section lists everyone who uses River through it (by name where you know
  them), who is online, every community, and lets you **time out** (1 hour,
  1 day, 1 week), **ban** (with an optional reason shown to them), **unban**,
  **remove an account** or **delete a community**. Timed-out and banned people
  are signed out at once.
- **Invite friends to communities.** ➕ next to a friend sends them an invite
  in your conversation, and invites you receive show a **Join community**
  button.
- **The host's PC takes over by itself.** If River finds the older River Host
  running the home server on this PC, it switches to built-in hosting at start,
  with all the data.

### Changed

- Hosting is out of everyone's way: the Hosting tab only appears for people
  who host (or who ask for it in Settings → Server).
- The top bar says **Online** instead of showing a server address.

### Fixed

- Invite links keep working after the host's PC restarts and the server's
  address changes: River tries the invite on your own server first.

### Security

- Operator endpoints (`/v1/admin/*`) answer only the program hosting the
  server, from the same machine, with its per-start host token — never through
  the tunnel. They expose ids, dates and counts; the server still has no names
  or content. See THREAT_MODEL §5c.
- Development builds and tests never create accounts on River's real server.

## [1.0.11] - 2026-10-10

**Hosting built into River: your communities stay online from your PC, for free.**

### Added

- **Host on this PC.** River can run your community server itself — no
  separate program, no account anywhere, nothing to set up. Turn it on in
  **Settings → Hosting**, or just pick **On this PC — free** when you create a
  community (the new default when you have no account yet).
- **Starts with your PC.** While hosting is on, River starts when you sign in,
  starts the server and opens its public address by itself, and keeps running
  in the tray.
- **Never loses anything.** Your communities live in a permanent folder on
  your PC, with an automatic backup every day (newest seven kept) and a
  **Back up now** button.
- **Stays reachable.** River restarts the server or the tunnel if either stops,
  reopens an address that stopped answering, and members' apps follow the new
  address by themselves. Optionally keeps the PC from sleeping while hosting.
- **Asks before going offline.** Quitting River from the tray while hosting
  asks first. The tray shows whether hosting is online.
- **Moves River Host into River.** Turning hosting on takes over an existing
  River Host (1.0.8) on this PC with all its data; the old folder stays as a
  backup.

### Security

- `cloudflared` is used only from a system location or as a pinned Cloudflare
  release verified by SHA-256 before it runs. Details: THREAT_MODEL §5b.

## [1.0.10] - 2026-10-10

**Quicker everyday actions, and a view of your own hosting.**

### Added

- **Hosting on this PC** in Settings → System shows whether this PC runs a
  River server, its current public address (with a copy button) and whether
  members' apps follow it automatically.
- **Right-click menus** on messages (react, reply, thread, copy text, edit,
  pin, mark unread, delete), channels (mark as read, invite, edit) and
  community icons (mark all as read, invite, settings, nickname, leave).
- **Mark as read / mark unread.** Mark a whole channel read, or mark any
  message unread to come back to it later.

### Fixed

- Installing River Host again replaces a copy that is already running instead
  of starting a second one.

## [1.0.9] - 2026-10-10

**Polish: get around faster, and never lose a message.**

### Added

- **Quick switcher (Ctrl+K).** Type part of a channel, person or section and
  press Enter. Unread channels come first.
- **Keyboard shortcuts list (Ctrl+/)**, and **Alt+↑ / Alt+↓** to move between
  channels (add Shift to jump between unread ones).
- **Compact mode** (Settings → Appearance → Message density) for more messages
  on screen.
- **Messages survive closing River.** Anything you sent that had not reached
  the server yet is kept, encrypted, on your computer and goes out the next
  time River starts.

### Accessibility

- Automated checks now also cover Settings → System, the quick switcher and
  the shortcuts list.

### Security

- Review of the whole 1.0.1–1.0.9 series: `docs/security/1.0.x-review.md`.

## [1.0.8] - 2026-10-10

**Voice, and a server that comes back by itself.**

### Added

- **River Host** for people who host on their own PC: the server and its
  public tunnel start when you sign in to Windows, run hidden, restart if they
  stop, and keep their data in a permanent folder
  (see `docs/deployment/host-on-your-pc.md`).
- **River follows your server to its new address.** A home server's tunnel
  address changes after a restart. The server signs a note with its new
  address, and River moves there automatically, but only if the same server
  signed it and answers there.
- **Settings → System**: *Start River when I sign in* (opens quietly in the
  tray) and *Keep River running when I close the window*.
- **Voice channel user limits** (2 to 99 people); the channel list shows
  `2/5`, and a full channel says so.
- **Video tiles** you can use from the keyboard: Enter shows someone large,
  double-click or F toggles fullscreen; moving bars show who is speaking.

### Fixed

- Joining a voice channel the server refuses (full, or not allowed) no longer
  looks connected while you are alone: River explains and leaves.

## [1.0.7] - 2026-10-10

**Channels: threads, announcement channels and slowmode.**

### Added

- **Threads.** Start one from any message (🧵). Replies stay in a panel beside
  the channel, and the starting message shows "Game night · 3 replies · 14:02".
  Rename a thread by double-clicking its name; archive or unarchive it.
  Thread names are encrypted like everything else.
- **Announcement channels.** Turn any text channel into one in its settings:
  only people who can manage messages post there, and everyone else reads and
  reacts. Marked with 📢.
- **Slowmode** from 5 seconds to 6 hours per channel. The composer says it is
  on, and a too-early message tells you how long to wait. People who manage
  messages are not slowed down.

## [1.0.6] - 2026-10-10

**Roles and permissions: timeouts, an audit log, category permissions, hoisted roles and nicknames.**

### Added

- **Time out members** (new *Time out members* permission) for 60 seconds up
  to a week, from their member card. A timed-out member can still read, but
  cannot send, react, attach files, invite or join voice. Their card and
  composer show until when.
- **Audit log** in Community settings (new *View audit log* permission). It
  shows who changed roles, channels, categories and settings, who moderated
  whom, and who joined or left, in plain sentences. The server keeps only IDs
  and numbers for 90 days; names are filled in on your computer.
- **Category permissions.** Channels can follow their category's permissions
  ("synced"); a channel with its own permissions shows **Sync with category**.
  Channels from templates start synced.
- **Show members with a role separately** (hoisted roles) in the member list.
- **Nicknames per community** ("Change nickname" in the community menu).
  They are encrypted into your profile for that community only, and
  @nickname mentions you.
- Friend links opened in a browser show a short how-to page.

### Changed

- Channel and category permission editors are the same, with clear
  allow / inherit / deny choices.

## [1.0.5] - 2026-10-10

**Stability: River stays connected, never loses what you type, and explains problems plainly.**

### Added

- **Messages wait for you.** What you send appears straight away as
  *Sending…*. While you are offline it shows *Waiting for connection* and goes
  out automatically when you are back. If the server refuses it, the reason
  stays with **Retry** and **Delete**.
- **A clear connection banner.** After a short grace period it says
  "You're offline. Trying again in 8s." with **Retry now**, and "Back online"
  when the connection returns.
- **Faster reconnecting.** River reconnects right away when your computer
  wakes, the screen unlocks or the network comes back, and spreads retries out
  so servers aren't flooded.
- **A guard against bad updates.** If an updated River fails to start three
  times in a row, automatic installs pause and Home explains what happened.

### Changed

- **Plain-language errors** for connection problems, rate limits, files that
  are too large, expired sessions and server errors. Internal details never
  reach the screen.

## [1.0.4] - 2026-10-10

**Highlighting: mentions, roles, channels and what you missed.**

### Added

- **Role mentions.** Turn on "Allow anyone to @mention this role" in a role's
  settings. Mentioning the role pings everyone who has it. People allowed to
  mention @everyone can mention any role.
- **Replies to your messages count as mentions**: sound, badge, highlight and
  notification.
- **Smarter autocomplete** for @people (with avatars), @roles (in their colour),
  @everyone and @here (with what they do), and **#channels**.
- **Clickable #channel links** and role mentions shown in the role's colour.
- **"New messages" divider** and a catch-up bar ("3 new messages since 14:02 —
  Mark as read"). Opening a channel with new messages starts at the divider.
- **Unread and mention counts survive restarts**, including messages that
  arrived while River was closed. They are counted on your computer after
  decrypting; the server cannot see them.
- **Search highlights the matching words** in community and conversation
  search results.

## [1.0.3] - 2026-10-10

**Friends made simple.**

### Added

- **Friends page** (replaces Contacts) with **Online, All, Pending and
  Blocked** tabs, search, online status and mutual communities.
- **Pending shows both directions**: requests for you (Accept, Read message,
  Ignore) and requests you sent ("waiting for them to accept", Cancel request).
- **Add friend** with a friend link or River ID and an editable first message.
  **Your friend link** has a Copy button.
- **Add friend on every member card** in a community; it shows "Request sent",
  "Wants to be friends" or "Friends".
- **Paste a friend link anywhere** in River to get an "Add a friend?" prompt.

### Fixed

- A request you sent no longer shows the person as your friend before they
  accept. When they accept you hear the new-friend sound and see the
  celebration.

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

[Unreleased]: https://github.com/martex-dev/river/compare/v1.0.46...HEAD
[1.0.46]: https://github.com/martex-dev/river/compare/v1.0.45...v1.0.46
[1.0.45]: https://github.com/martex-dev/river/compare/v1.0.44...v1.0.45
[1.0.44]: https://github.com/martex-dev/river/compare/v1.0.43...v1.0.44
[1.0.43]: https://github.com/martex-dev/river/compare/v1.0.42...v1.0.43
[1.0.42]: https://github.com/martex-dev/river/compare/v1.0.41...v1.0.42
[1.0.41]: https://github.com/martex-dev/river/compare/v1.0.40...v1.0.41
[1.0.40]: https://github.com/martex-dev/river/compare/v1.0.39...v1.0.40
[1.0.39]: https://github.com/martex-dev/river/compare/v1.0.38...v1.0.39
[1.0.38]: https://github.com/martex-dev/river/compare/v1.0.37...v1.0.38
[1.0.37]: https://github.com/martex-dev/river/compare/v1.0.36...v1.0.37
[1.0.36]: https://github.com/martex-dev/river/compare/v1.0.35...v1.0.36
[1.0.35]: https://github.com/martex-dev/river/compare/v1.0.34...v1.0.35
[1.0.34]: https://github.com/martex-dev/river/compare/v1.0.33...v1.0.34
[1.0.33]: https://github.com/martex-dev/river/compare/v1.0.32...v1.0.33
[1.0.32]: https://github.com/martex-dev/river/compare/v1.0.31...v1.0.32
[1.0.31]: https://github.com/martex-dev/river/compare/v1.0.30...v1.0.31
[1.0.30]: https://github.com/martex-dev/river/compare/v1.0.29...v1.0.30
[1.0.29]: https://github.com/martex-dev/river/compare/v1.0.28...v1.0.29
[1.0.28]: https://github.com/martex-dev/river/compare/v1.0.27...v1.0.28
[1.0.27]: https://github.com/martex-dev/river/compare/v1.0.26...v1.0.27
[1.0.26]: https://github.com/martex-dev/river/compare/v1.0.25...v1.0.26
[1.0.25]: https://github.com/martex-dev/river/compare/v1.0.24...v1.0.25
[1.0.24]: https://github.com/martex-dev/river/compare/v1.0.23...v1.0.24
[1.0.23]: https://github.com/martex-dev/river/compare/v1.0.22...v1.0.23
[1.0.22]: https://github.com/martex-dev/river/compare/v1.0.21...v1.0.22
[1.0.21]: https://github.com/martex-dev/river/compare/v1.0.20...v1.0.21
[1.0.20]: https://github.com/martex-dev/river/compare/v1.0.19...v1.0.20
[1.0.19]: https://github.com/martex-dev/river/compare/v1.0.18...v1.0.19
[1.0.18]: https://github.com/martex-dev/river/compare/v1.0.17...v1.0.18
[1.0.17]: https://github.com/martex-dev/river/compare/v1.0.16...v1.0.17
[1.0.16]: https://github.com/martex-dev/river/compare/v1.0.15...v1.0.16
[1.0.15]: https://github.com/martex-dev/river/compare/v1.0.14...v1.0.15
[1.0.14]: https://github.com/martex-dev/river/compare/v1.0.13...v1.0.14
[1.0.13]: https://github.com/martex-dev/river/compare/v1.0.12...v1.0.13
[1.0.12]: https://github.com/martex-dev/river/compare/v1.0.11...v1.0.12
[1.0.11]: https://github.com/martex-dev/river/compare/v1.0.10...v1.0.11
[1.0.10]: https://github.com/martex-dev/river/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/martex-dev/river/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/martex-dev/river/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/martex-dev/river/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/martex-dev/river/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/martex-dev/river/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/martex-dev/river/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/martex-dev/river/compare/v1.0.2...v1.0.3
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
