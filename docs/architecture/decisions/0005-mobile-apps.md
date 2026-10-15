# ADR 0005 — Mobile apps: one client core, native crypto underneath

Status: **accepted for Android** (2026-10-15, the maintainer asked for "the
easiest and fastest working way"). iOS follows the same design once the Apple
decision is made (it costs money). Built in 1.1.0; see docs/mobile.

## Context

ARCHITECTURE.md §13 planned two new native apps (SwiftUI and Jetpack Compose),
each re-implementing River's client: accounts, signed device lists,
communities, sealed community messages, direct messages over libsignal,
social, voice, backup. That is the roadmap's 1.3–1.7 — several months of work
for two code bases that must stay byte-compatible with the desktop app.

The desktop client is already split in a way that travels well:

- the **UI** is a React app that runs in an untrusted renderer and talks to
  everything else through one validated API (`window.river`);
- the **client core** (~12,000 lines of TypeScript in `apps/desktop/src/main`)
  holds the protocol, storage and networking;
- the core's use of **libsignal** is small: key pairs, signatures, prekeys
  (including Kyber), sessions, encrypt/decrypt and fingerprints — about twenty
  calls, all of which libsignal also ships for Android (Java) and iOS (Swift).

## Decision (proposed)

Build the phone apps from the same UI and the same client core, with only the
platform pieces native:

1. **Shell**: a Capacitor app per platform. The existing React UI runs in the
   system WebView, laid out for phones (one column: rail → sidebar → chat,
   swiping between them, like Discord's mobile app).
2. **Core**: the TypeScript client core runs inside the app's JavaScript
   context. Electron-only pieces sit behind small interfaces that already
   exist or are easy to add (storage, secret storage, notifications, file
   picking, fetch/WebSocket).
3. **Native underneath**, as Capacitor plugins:
   - libsignal through **libsignal-android** / **libsignal Swift**, exposing
     the same calls the core uses today;
   - the encrypted database through SQLCipher;
   - the database key in **Android Keystore** / **iOS Keychain**;
   - pushes that carry no content (as §13 already says).
4. **Calls**: WebRTC in the WebView (supported on Android and on iOS 14.3+),
   the same mesh and encrypted relay as desktop. CallKit / ConnectionService
   come later.
5. Both apps pass the same protocol test vectors as desktop before release.

## Why

- One protocol implementation instead of three: a fix lands everywhere.
- Desktop, Android and iOS interoperate from day one; nothing to keep in sync.
- The roadmap's 1.3–1.7 shrink from months to weeks.

## Costs and limits

- **iOS**: installing on an iPhone needs an Apple Developer account
  ($99/year) for TestFlight/App Store, or a Mac plus a free Apple ID for
  7-day sideloading. Building can use GitHub's free macOS runners.
- **Android**: free. Signed APK on GitHub Releases; Google Play needs a
  one-time $25 developer account (optional).
- WebView performance is fine for chat and voice; heavy video calls may need
  native rendering later.
- Background delivery on phones needs push: content-free wake-ups through
  FCM/UnifiedPush (Android) and APNs (iOS, needs the Apple account).

## Plan

| Step | Delivers                                                                              |
| ---- | ------------------------------------------------------------------------------------- |
| 1    | Core runs outside Electron (interfaces for storage, secrets, sockets); tested in Node |
| 2    | Android shell + libsignal-android + SQLCipher plugins; sign up, join, text chat (APK) |
| 3    | Phone layout of the UI (one column, swipe), notifications                             |
| 4    | Voice in the WebView; DMs; files                                                      |
| 5    | iOS shell with the same plugins (needs the Apple decision)                            |
| 6    | Content-free push; background reconnect; parity checks → 2.0.0                        |

## As built (1.1.0)

- The client core runs in its **own WebView** (not in the UI's): the UI stays
  untrusted exactly as Electron's renderer, and only the core's WebView has the
  native interface.
- The native interface is **synchronous** (an Android JavaScript interface),
  because the desktop core uses synchronous SQLite and crypto. The shims in
  `apps/mobile/core/shims` provide the node:crypto, node:fs, better-sqlite3,
  Electron and libsignal APIs the core uses over it.
- libsignal session operations run natively over per-call stores; River's
  trust rules (TOFU, verified contacts) stay in the shared TypeScript.
- Each phone is its own River account until multi-device linking (1.3.x).
