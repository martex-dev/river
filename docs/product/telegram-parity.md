# River and Telegram / Signal: what we have, what comes next

An audit (2026-10-16) of River against a large Telegram feature inventory the
maintainer provided, plus Signal and Silent Phone. Statuses were checked in
the code. "On purpose" marks things River leaves out for privacy.

## Already in River

Mute per chat with durations, quiet hours and notification preview privacy;
reply, edit, delete for everyone, reactions, pins and forwarding in direct
messages; formatting (bold, italic, code, spoilers, strikethrough, quotes);
emoji picker; paste and drag-and-drop files; image viewer with zoom and pan;
stories and posts with views; 1:1 voice and video calls, screen sharing and
remote assistance; call history; noise suppression; reply from notifications;
app lock with biometrics; safety numbers; linked devices with names; themes,
skins and text size; usernames; blocking; webhooks and slash commands;
communities with roles, invite links, slow mode, threads, forums, polls,
announcement channels, stickers and custom emoji; phone safe areas,
long-press menus and swipe between panes.

## Partly there

Drafts (memory only, on purpose), stickers
(communities only), saved messages (bookmarks, plus Note to self since 2.9),
languages (English and Bulgarian).

Finished since the audit: mark unread and pinned chats (2.1), copy text,
multi-select and search in a conversation (2.2), shared media per chat (2.7),
polls in direct messages and groups (2.10.4), album grids (2.10.3), link
previews in direct messages (2.10.6, opt-in), jump to date in direct
messages (2.10.7), chat folders (2.10.8), contact profiles (2.10.9),
per-person volume (2.0.4).

## Plan

| Version  | Theme                 | Contents                                                                                                                                   |
| -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.0.4 ✅ | Louder, clearer voice | Voice volume up to 200 % with a limiter, louder default on phones, per-person volume in 1:1 calls, Android volume buttons control the call |
| 2.1 ✅   | Chat list             | Pin chats, archive, mark unread, filters (Unread, People, Groups), jump to latest in conversations                                         |
| 2.2 ✅   | Message actions       | Copy text, select several messages, search in a conversation                                                                               |
| 2.3 ✅   | Voice messages        | Record, send, play, playback speed                                                                                                         |
| 2.4 ✅   | Disappearing messages | Per-chat timer, enforced on both sides                                                                                                     |
| 2.5 ✅   | Send later            | Scheduled messages, send silently                                                                                                          |
| 2.6 ✅   | Privacy controls      | Read receipts and typing indicator toggles; screen security on Android                                                                     |
| 2.7 ✅   | Media                 | Shared media per conversation, swipe between pictures, video speed                                                                         |
| 2.8 ✅   | Phone feel            | Swipe to reply, haptics                                                                                                                    |
| 2.9 ✅   | People                | Add by QR code, a "Note to self" conversation                                                                                              |
| 2.10 ✅  | Calls                 | Picture-in-picture for video calls                                                                                                         |

After 2.10: 2.10.x polish releases.

## Not planned, and why

- Phone-number accounts and SMS codes, contact-book upload, "people nearby":
  River has no phone numbers and never uploads contacts.
- Last seen: River does not store it.
- Premium, Stars, gifts, paid media, business subscriptions: River takes no
  money.
- Translation and voice transcription through a server: they would send
  content off the device.
- GIF search through a third-party service: it would leak what you type.
- Mini apps: a web platform inside an end-to-end encrypted messenger needs
  its own security design first.
