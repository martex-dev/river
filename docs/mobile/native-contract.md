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
