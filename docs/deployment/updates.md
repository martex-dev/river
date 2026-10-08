# Automatic updates

How an installed River finds, verifies and installs a new version.

## Flow

```
check (every ~4 h, and on demand)
  └─ electron-updater reads the GitHub releases feed for the user's channel
      └─ River policy: version strictly newer? channel allowed?   ── no → up to date
          └─ download installer (differential via .blockmap when possible)
              └─ electron-updater: SHA-512 matches latest*.yml
                  └─ River: fetch river-release-manifest.json(.sig) for vX.Y.Z
                      ├─ Ed25519 signature valid under a pinned key?
                      ├─ manifest.version == X.Y.Z?
                      └─ SHA-512 of the downloaded file listed?   ── any no → blocked, nothing installed
                          └─ "ready": install on quit or "Restart and update"
```

Implementation: `apps/desktop/src/main/updater/` and `packages/release/`.

## Why a second signature?

`latest.yml` and the installer come from the same GitHub release, so the
SHA-512 check alone only protects against corrupted downloads. River's
manifest is signed by a key that is not on GitHub's servers in usable form
(only as an Actions secret) and whose public half is compiled into the app.
An attacker who can upload files to the release page still cannot produce a
valid signature.

## Downgrade protection

electron-updater silently enables `allowDowngrade` whenever a channel is set;
River resets it and independently refuses any version that is not strictly
newer than the running one, so old signed releases cannot be replayed.

## Platform behaviour

| Platform                 | Install mechanism                              | Status                                              |
| ------------------------ | ---------------------------------------------- | --------------------------------------------------- |
| Windows (NSIS, per-user) | Silent install on quit or restart              | ✅ automatic                                        |
| Linux AppImage           | Replaces the AppImage                          | ✅ automatic                                        |
| Linux deb / rpm          | `pkexec` package install (asks for password)   | ✅ automatic                                        |
| macOS                    | Squirrel.Mac requires a Developer ID signature | ⚠ manual: River notifies and opens the release page |

Builds made with `RIVER_MAC_SIGNED=true` (once the project has an Apple
Developer ID and notarization in CI) enable automatic installation on macOS.

## Failure handling

- Network failure → status "Could not reach the update server", retried at the next check.
- Download failure → nothing changes, retried later.
- Verification failure → update blocked, user informed (toast + Settings), nothing installed.
- Installer failure → the previous version remains installed (NSIS installs atomically per-user).
- Not yet implemented: automatic rollback if a _verified_ update installs but then
  fails to start (tracked in TODO.md).

## Upgrade paths

Every release can update from any earlier release: the updater always fetches
the newest release for the channel directly, so a user on 0.0.1 jumps straight
to the latest version without installing intermediate releases. Data
migrations (from 0.0.3 on) are cumulative and tested from every earlier schema.
