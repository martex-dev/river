# River on phones

River for Android ships from 1.1.0; iOS follows in 1.4.x (it needs the Apple
decision in ROADMAP). Design: [ADR 0005](../architecture/decisions/0005-mobile-apps.md)
and [ARCHITECTURE.md §13](../../ARCHITECTURE.md#13-mobile-architecture-stage-2).

## Install (Android)

Download `River-android.apk` from the
[latest release](https://github.com/martex-dev/river/releases/latest) on the
phone and open it (Android asks to allow installing from the browser once).
Phones with older 32-bit processors use `River-<version>-android-arm32.apk`.
Android 8.0 or newer.

Updates: install the newer APK over the old one (same signing key, so your
data stays). Obtainium can watch the GitHub releases and do it for you.

## What works on a phone (1.1.0)

- Everything in communities: channels, messages, replies, reactions, threads,
  files, roles, invites, voice channels.
- Direct messages and calls (libsignal, the same as the desktop).
- Encrypted local storage: SQLCipher, its key held by the Android Keystore.
- Notifications for new messages while River is open in the background.
- "Open in River" links on invite pages.

Not yet: hosting (a computer feature), screen sharing, push notifications when
River has been closed (1.2.x), one account on phone and computer together
(1.3.x — a phone is its own account until then), link previews.

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
