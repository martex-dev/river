# River on phones

River for Android ships from 1.1.0, River for iPhone from 1.3.0. Design: [ADR 0005](../architecture/decisions/0005-mobile-apps.md)
and [ARCHITECTURE.md §13](../../ARCHITECTURE.md#13-mobile-architecture-stage-2).

## Install (Android)

Download `River-android.apk` from the
[latest release](https://github.com/martex-dev/river/releases/latest) on the
phone and open it (Android asks to allow installing from the browser once).
Phones with older 32-bit processors use `River-<version>-android-arm32.apk`.
Android 8.0 or newer.

Updates: River updates itself (Settings → Updates). It checks GitHub Releases
at start and about every six hours, takes only a release whose manifest is
signed by River's release key (Beta and Nightly only if you chose them),
downloads the APK for your phone's processor, checks its SHA-256 against the
signed manifest and that it is signed with the same Android key as the River
you have, then opens Android's installer, which asks you to confirm. The first
time, Android asks you to allow River to install apps.

A release signed with a different Android key (the early preview builds were)
cannot be installed as an update: River says so and links the download page.
Uninstalling deletes River's data on the phone, so make a backup first
(Settings → Backup). You can still install a newer APK over the old one by
hand, or let Obtainium watch the releases.

iPhone: a sideloaded app cannot replace itself; install the new IPA as below.

## Install (iPhone)

Without an Apple Developer account River cannot be in the App Store or
TestFlight, so the release has an **unsigned** app, `River-ios-unsigned.ipa`,
that you install yourself with a free Apple ID:

1. On a computer, install [Sideloadly](https://sideloadly.io) or
   [AltStore](https://altstore.io).
2. Download `River-ios-unsigned.ipa` from the
   [latest release](https://github.com/martex-dev/river/releases/latest).
3. Connect the iPhone, open the .ipa with Sideloadly (or AltStore) and sign in
   with your Apple ID. It signs River for your phone and installs it.
4. On the iPhone: Settings → General → VPN & Device Management → trust your
   Apple ID. iOS 16 or newer.

Apps signed with a free Apple ID run for **7 days**; AltStore renews them
automatically while your computer is on the same Wi-Fi. River's data stays when
you reinstall the same app. With the Apple Developer account (ROADMAP, open
decisions) River can go to TestFlight and the App Store instead.

## What works on a phone

- Everything in communities: channels, messages, replies, reactions, threads,
  files, roles, invites, voice channels.
- Direct messages and calls (libsignal, the same as the desktop).
- Encrypted local storage: SQLCipher, its key held by the Android Keystore or
  the iOS Keychain. Lock River asks for your fingerprint, face or screen lock.
- One account on your phone and your computer (linked devices, 1.2): link with
  the QR code shown in Settings → Account → Devices on the computer.
- Notifications, with replies right from the notification (1.4). On Android,
  **Stay connected** (Settings → System) keeps River connected while closed,
  with a quiet permanent notification — River uses no Google or Apple push
  service.
- Calls keep going with the screen off on Android, ring while River is in the
  background (1.7), and have a speaker button (2.0.1).
- Android rings like a phone call (2.11): the phone's ringtone and vibration, a
  call screen over the lock screen with Answer and Decline, and Android's call
  notification when another app is in front. Stay connected is on for new
  installs (existing ones are asked once); a watchdog checks the connection
  every ~15 minutes with the screen off and the service restarts after a
  reboot. Settings → System → Calls and notifications shows battery
  optimization, full-screen calls and notification permission as Android
  reports them, each with a button to fix it.
- iPhone: without Apple's push service (it needs a paid Apple developer
  account) River cannot notify or ring while iOS has paused it; messages and
  calls wait until River is opened. Settings → System says so.
- Share → River from other apps (Android); swipe between the list and the
  conversation.
- Watching and pointing at someone's shared screen (remote assistance).
- "Open in River" links on invite pages.

Not yet: hosting and sharing your own screen (computer features), the system's
own telephony integration (CallKit / Telecom ConnectionService: River's call
screen is its own), link previews.

## How it is built

| Part                           | What it is                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/ui`               | The desktop's React UI, plus the phone layout (`phone.ts`, `phone.css`) and `window.river` over the app bridge   |
| `apps/mobile/core`             | The desktop's client core (`apps/desktop/src/main`) bundled for a phone; `shims/` replace Node and Electron      |
| `apps/mobile/core/native.ts`   | The native interface the shims call — see [native-contract.md](native-contract.md)                               |
| `apps/mobile/android`          | The Android app (Capacitor 8): `core/` is the native interface in Java, `CoreHost` runs the core's own WebView   |
| `tests/mobile`                 | The core bundle against a real server and the desktop client, with a Node implementation of the native interface |
| `tests/android`, `android.yml` | The debug APK on an Android emulator in CI, driven through its WebViews                                          |

Build locally (needs JDK 21 and the Android SDK):

```
npm run sync -w @river/mobile
cd apps/mobile/android && ./gradlew assembleDebug
```

Release APKs are built and signed by the Release workflow with the key from
`scripts/release/create-android-key.py` (GitHub secrets `RIVER_ANDROID_*`).
