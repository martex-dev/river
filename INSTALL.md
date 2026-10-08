# Installing River

Download the file for your computer from the
[latest release](https://github.com/martex-dev/river/releases/latest).
You install River once; after that it keeps itself up to date.

## Windows 10 / 11

1. Download `River-Setup-<version>.exe`.
2. Double-click it. River installs for your user account (no administrator
   password needed) and starts.
3. **"Windows protected your PC"?** River's installer is not yet signed with a
   paid Microsoft code-signing certificate, so SmartScreen warns about it. Click
   **More info → Run anyway**. You can confirm the file is genuine by comparing
   its SHA-256 with `SHA256SUMS` in the release (see _Verifying a download_ below).

Updates install automatically when you quit River, or immediately with
**Settings → Updates → Restart and update**.

## macOS (11 Big Sur or newer)

1. Download `River-<version>-arm64.dmg` for Apple silicon (M1/M2/M3/M4…) or
   `River-<version>-x64.dmg` for Intel Macs.
2. Open the DMG and drag **River** into **Applications**.
3. The first time, **right-click River → Open → Open**. macOS asks because
   River is not yet notarized with an Apple Developer ID.
   If macOS says River "is damaged", run once in Terminal:
   `xattr -cr /Applications/River.app`

**Updates on macOS:** until River has an Apple Developer ID, macOS will not let
an app replace itself silently. River checks for updates, tells you when one is
available, and opens the download page — install it the same way (drag to
Applications, replace).

## Linux

Pick one:

- **AppImage** (any distribution): download `River-<version>-x86_64.AppImage`,
  then `chmod +x River-*.AppImage` and run it. Updates install automatically.
- **Debian / Ubuntu**: `sudo apt install ./River-<version>-amd64.deb`
- **Fedora / openSUSE**: `sudo dnf install ./River-<version>-x86_64.rpm`

deb/rpm installs update through River (it asks for your password via
`pkexec` to install the new package).

## Choosing a release channel

**Settings → Updates → Release channel**

| Channel | Gets                                                       |
| ------- | ---------------------------------------------------------- |
| Stable  | Tested releases (recommended)                              |
| Beta    | Pre-releases tagged `-beta.N`, plus every stable release   |
| Nightly | Development builds tagged `-alpha.N`, plus beta and stable |

River never downgrades. If you move from Beta back to Stable you stay on your
current version until a newer stable release exists.

## Verifying a download (optional)

Every release contains:

- `SHA256SUMS` — SHA-256 of every file.
- `river-release-manifest.json` and `river-release-manifest.json.sig` — the same
  list, signed with River's Ed25519 release key (key ID `626D B4CB B389 FC32`).

Windows (PowerShell): `Get-FileHash .\River-Setup-<version>.exe -Algorithm SHA256`
macOS / Linux: `shasum -a 256 <file>` or `sha256sum <file>`

Compare the result with the line for that file in `SHA256SUMS`.

## iOS and Android

Mobile apps arrive with River 2.0 (Stage 2). See the [roadmap](ROADMAP.md).

## Uninstalling

- Windows: Settings → Apps → River → Uninstall.
- macOS: drag River from Applications to the Bin.
- Linux: delete the AppImage, or `sudo apt remove river` / `sudo dnf remove river`.

Your local River data stays in your user profile
(`%APPDATA%\River`, `~/Library/Application Support/River`, `~/.config/River`)
until you delete it.
