# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

**Status:** River has applied for SignPath Foundation's free open-source signing.
Until the project is accepted, Windows installers are unsigned and Windows shows
a "Windows protected your PC" prompt on first install. This page will say when
signing is active.

## What is signed

- The Windows installer, `River-Setup-<version>.exe`, attached to each
  [GitHub Release](https://github.com/martex-dev/river/releases).
- Every signed file is built from this repository's source by the
  [Release workflow](.github/workflows/release.yml) on GitHub Actions. Nothing
  built on a personal computer is ever signed.
- Only River's own code is signed. Third-party components keep their authors'
  signatures (or none).

Separately, every release and update is also signed with River's own Ed25519
release key and verified by the app before it installs anything
([docs/security/release-signing.md](docs/security/release-signing.md)).

## Team roles

| Role      | Members                                     | Responsibility                                                |
| --------- | ------------------------------------------- | ------------------------------------------------------------- |
| Committer | [martex-dev](https://github.com/martex-dev) | May change the source code without further review             |
| Reviewer  | [martex-dev](https://github.com/martex-dev) | Reviews every pull request from people who are not committers |
| Approver  | [martex-dev](https://github.com/martex-dev) | Approves each signing request in SignPath, release by release |

Everyone in these roles uses multi-factor authentication for GitHub and SignPath.

## Privacy

River only connects to other computers for things you ask it to do: the River
server you or your community use, the people you call, update checks on GitHub
Releases, and — only on a PC that hosts a server — the tunnel provider that gives
it a public address (Cloudflare or Tailscale). See [PRIVACY.md](PRIVACY.md) for
what is sent where. River does not collect analytics or telemetry.

## Uninstalling

Windows: Settings → Apps → River → Uninstall. Your data stays in
`%APPDATA%\River` until you delete that folder.
