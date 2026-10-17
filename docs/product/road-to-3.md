# The road to River 3.0

The maintainer's goal (2026-10-18): keep releasing until River is a fully polished app with
nothing left to touch, then call it 3.0. Many small releases, each one installed by the
signed update channel, rather than a few large ones.

## Direction

- **Phones (Android and iPhone) look and feel like Telegram or Instagram**, not like Discord:
  a bottom tab bar, a chat list with avatars, previews, times and unread counts, a
  conversation screen with a back arrow, the person's picture and call buttons, message
  bubbles, and communities shown as a list of groups with their channels inside. The same
  chats, communities, friends and accounts as on a computer.
- **Computers look and feel like Discord, Telegram Web or AnyDesk**: a server rail, channel
  lists, a wide conversation, and remote assistance one click away.
- **No extra work compared with a normal social app**: installing, making a profile,
  adding a friend and joining a community each take a few taps.
- **More private by default, and no harder to use**: what River protects is said plainly,
  and the UI never claims a protection that is not active (CLAUDE.md).
- **Calls and voice channels that just work**: they ring, connect, survive a network
  change and sound clean, from two people to large meetings.
- **Bugs fixed in sweeps**: every minor version ends with an audit of the areas it
  touched, and every few versions a sweep of the whole app.

## Plan

One theme per minor version. Patch versions (2.12.1, 2.12.2 …) carry polish and fixes for
that theme, and as many of them ship as needed.

| Version | Theme                              | Contents                                                                                                                                                                         |
| ------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.11.x  | Phone calls                        | Rings like a phone, stops when the caller hangs up, phone-style call screens, call fixes and reviews                                                                             |
| 2.12.x  | Phones look like Telegram          | Bottom tabs (Chats, Communities, Calls, Feed, Settings), Telegram-style chat list and conversation, bubbles, Instagram-style profiles and feed; v2 associated data on by default |
| 2.13.x  | Easy start                         | Install-to-chat in under a minute, one-screen profile, invite links that open the app, friend links, QR everywhere; community keys need a proof                                  |
| 2.14.x  | Calls, part 2                      | Group calls in conversations and groups, call quality (bandwidth adaptation, reconnect on network change), call links                                                            |
| 2.15.x  | Voice channels and meetings        | Bigger rooms, grid and speaker views, raise hand, stage channels, screen share in voice                                                                                          |
| 2.16.x  | Notifications                      | Per-chat sounds and vibration, mentions-only, grouped notifications, reliable delivery on every platform that allows it                                                          |
| 2.17.x  | Looks                              | Chat wallpapers, accent colours, bubble styles, theme editor, app icon choices, more motion and sounds                                                                           |
| 2.18.x  | Messaging, part 2                  | Message effects, quick replies, richer editor, saved-message folders, more sticker and emoji tools                                                                               |
| 2.19.x  | Privacy, part 2                    | Less metadata on the server, padding, proxy and Tor-friendly connections, local-only mode                                                                                        |
| 2.20.x  | Whole-app sweep                    | Audits of every area, performance, accessibility, languages                                                                                                                      |
| 2.21+   | Whatever the maintainer finds next | Feedback from real phones and computers                                                                                                                                          |
| 3.0.0   | River 3.0                          | When the sweeps find nothing left to fix                                                                                                                                         |

## What stays out

The list in [telegram-parity.md](telegram-parity.md) still applies: no phone numbers or
contact uploads, no "last seen" stored on a server, nothing that takes money, and no
server-side translation or GIF search that would send what you type off your device.
