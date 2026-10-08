# Building River

## Installers for your own platform

```bash
npm ci
npm run dist
```

Output in `apps/desktop/release/`:

| Platform | Files                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------- |
| Windows  | `River-Setup-<v>.exe` (NSIS, per-user), `.blockmap`, `latest.yml`                              |
| macOS    | `River-<v>-{x64,arm64}.dmg`, `River-<v>-{x64,arm64}.zip`, `latest-mac.yml`                     |
| Linux    | `River-<v>-x86_64.AppImage`, `River-<v>-amd64.deb`, `River-<v>-x86_64.rpm`, `latest-linux.yml` |

Building the `.rpm` on Debian/Ubuntu needs `sudo apt install rpm`.
Cross-building macOS installers on other systems is not supported.

## Official releases

Official releases are built only by GitHub Actions
([`.github/workflows/release.yml`](.github/workflows/release.yml)) when a tag is
pushed, so anyone can see exactly how each installer was produced:

1. **verify** — tag matches the version, changelog entry exists, lint,
   typecheck, unit tests, production dependency audit.
2. **build** — Windows, macOS and Linux installers in parallel.
3. **publish** — CycloneDX SBOM, `SHA256SUMS`, Ed25519-signed
   `river-release-manifest.json`, then the GitHub Release (marked pre-release
   for `-beta.N` / `-alpha.N`).

The maintainer process is in [docs/deployment/releasing.md](docs/deployment/releasing.md).

## Code signing status

| Platform                          | Status                                                                |
| --------------------------------- | --------------------------------------------------------------------- |
| River update signature (Ed25519)  | ✅ every release                                                      |
| Windows Authenticode              | ❌ not yet (SmartScreen warning on first install)                     |
| macOS Developer ID + notarization | ❌ not yet (ad-hoc signed; Gatekeeper prompt; no silent auto-install) |

Reproducible builds are a goal; currently builds are deterministic in inputs
(locked dependencies, pinned actions) but not yet byte-for-byte reproducible.
