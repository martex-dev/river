# The phone's native interface

River's client core on a phone has one way out of its WebView:

```
RiverNative.call(method, argsJson) → '{"v": result}' | '{"e": message, "code": "…"}'
```

It is synchronous (an Android `@JavascriptInterface`), because the shared client
core uses synchronous SQLite and crypto, exactly as on the desktop. Bytes are
standard base64. The authoritative list with types is
[`apps/mobile/core/native.ts`](../../apps/mobile/core/native.ts); there are two
implementations that must agree:

- Android: `apps/mobile/android/app/src/main/java/io/github/martexdev/river/core/`
- Tests: `tests/mobile/node-native.ts` (Node crypto, libsignal-client, SQLite)

| Group     | Methods                                                                        | Android                                       |
| --------- | ------------------------------------------------------------------------------ | --------------------------------------------- |
| Crypto    | `random`, `digest`, `hmac`, `hkdf`, `aesGcmSeal/Open`, `aesCbc`, `gzip/gunzip` | javax.crypto, libsignal HKDF, java.util.zip   |
| Files     | `fs.paths/read/write/stat/list/mkdir/rename/remove/copy`                       | app-private storage only; "Save as" documents |
| Keystore  | `keystore.usable/name/wrap/unwrap`                                             | Android Keystore, AES-256-GCM, non-exportable |
| Database  | `db.open/close/run/all`                                                        | SQLCipher 4, raw 32-byte key                  |
| libsignal | `sig.*` (keys, records, fingerprints, sessions)                                | libsignal-android 0.105.0                     |

Rules:

- **Nothing custom.** Every primitive is platform or libsignal code.
- **Trust stays shared.** libsignal session calls run over stores built for the
  call that accept any identity and report the one they saw; River's TOFU and
  verified-contact rules run in the shared TypeScript before anything is saved.
- **First messages ask for keys.** `sig.decryptPreKey` answers `{need: {kind, id}}`
  when libsignal asks for a prekey the caller did not pass; the caller loads it
  and calls again. Nothing is stored until a call succeeds.
- **Never log arguments**: they carry keys and message contents.

The app shell side (UI ↔ core messages, dialogs, notifications, files the person
saves) is described in [`apps/mobile/core/host.ts`](../../apps/mobile/core/host.ts).

## Updater asks (Android)

River for Android's updater ([`apps/mobile/core/updater.ts`](../../apps/mobile/core/updater.ts))
decides; the shell (`UpdateOps.java`) only does what a WebView cannot. These are
asks (asynchronous), not `RiverNative` calls:

| Ask               | Arguments          | Answer                                                                    |
| ----------------- | ------------------ | ------------------------------------------------------------------------- |
| `update.device`   | —                  | `{abis: Build.SUPPORTED_ABIS, versionCode, sdk}`                          |
| `update.download` | `{url, path, max}` | `{size, sha256}` (hex, MessageDigest)                                     |
| `update.progress` | `{path}`           | `{received, total}`                                                       |
| `update.signers`  | `{path}`           | `{installed, apk, packageName, ownPackage}` (certificate SHA-256s)        |
| `update.install`  | `{path}`           | `{status: success \| aborted \| conflict \| failed \| permission-needed}` |

- Downloads: HTTPS only, River's GitHub releases (and release list) only, into
  `files/updates/` only, never more than `max` bytes.
- Install: only an APK in `files/updates/` and only River's own package
  (PackageInstaller session with `setAppPackageName`). Android always asks the
  user to confirm; without the "install unknown apps" permission the shell opens
  that setting and answers `permission-needed`.
- The release manifest's signature, the APK's SHA-256 and the signing-certificate
  comparison are checked in the shared TypeScript before `update.install`.
