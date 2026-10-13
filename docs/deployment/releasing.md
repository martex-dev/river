# Releasing River

Releases are produced only by GitHub Actions from a signed-off tag.

## Checklist

1. All tests pass on `main` (CI green). No known critical security issue.
2. Security review notes for anything security-relevant in this release are in
   `docs/security/` (mandatory before 1.0.0 and 2.0.0).
3. `CHANGELOG.md`: move `[Unreleased]` entries into `## [X.Y.Z] - YYYY-MM-DD`
   and update the compare links at the bottom.
4. Set the version and refresh the lockfile:
   ```bash
   npm run version:set -- X.Y.Z
   npm install
   ```
5. Update STATUS.md (current version, next milestone).
6. Commit: `build(release): prepare X.Y.Z`, push to `main`, wait for CI.
7. Tag and push, with the guarded script (it refuses unless the release PR is
   merged, `main`'s packages say X.Y.Z and the tag is new):
   ```bash
   bash scripts/release/tag-release.sh X.Y.Z <release PR number>
   ```
8. Watch **Actions → Release**. It verifies, builds all platforms, signs and
   publishes. Once SignPath signing is set up (see below), the Windows build
   waits for you to **approve the signing request** in SignPath (you get an
   e-mail); it waits up to four hours. Check the release page has installers for all three OSes,
   `latest*.yml`, `SHA256SUMS`, the SBOM and both manifest files.
9. Smoke-test: an installed previous version must detect, download, verify and
   offer the update (Settings → Updates).

## Version tags and channels

| Tag              | Channel | GitHub release |
| ---------------- | ------- | -------------- |
| `v1.2.3`         | Stable  | Latest release |
| `v1.2.3-beta.1`  | Beta    | Pre-release    |
| `v1.2.3-alpha.1` | Nightly | Pre-release    |

Any other pre-release identifier is rejected by `set-version.ts` and ignored by clients.

## The release signing key

- Ed25519, generated with `node scripts/release/generate-signing-key.ts <dir-outside-repo>`.
- Private key: GitHub secret `RIVER_RELEASE_SIGNING_KEY` + the maintainer's offline backup.
- Public key: `packages/release/src/trusted-keys.ts` (compiled into every client).
- The release job re-verifies its signature against the pinned keys and fails
  if the secret does not match — so a wrong secret can never ship an
  unverifiable release.

### Rotating the key

1. Generate a new key. Add its public entry to `trusted-keys.ts` _alongside_ the
   old one; release N with the **old** key.
2. Replace the secret with the new key; release N+1 onwards are signed with it.
3. Remove the old public key once every supported upgrade path has passed
   through release N or later.

If the key is **compromised**, remove it from `trusted-keys.ts` immediately and
ship a release signed with the new key; announce in a security advisory.

## Windows code signing (SignPath Foundation)

Free for open-source projects; see [CODE_SIGNING.md](../../CODE_SIGNING.md).

1. Apply at <https://signpath.org/apply> for `martex-dev/river` (AGPL-3.0).
2. When accepted, in SignPath: create project `river`, signing policy
   `release-signing` (manual approval by the maintainer), the GitHub Actions
   trusted build system for this repository, and artifact configuration
   `installer` with the contents of
   [.signpath/artifact-configurations/installer.xml](../../.signpath/artifact-configurations/installer.xml).
3. In GitHub → Settings → Secrets and variables → Actions: secret
   `SIGNPATH_API_TOKEN` (a SignPath CI user token) and variable
   `SIGNPATH_ORGANIZATION_ID`. Different slugs go in the variables
   `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG` and
   `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`.

From then on the Release workflow uploads the unsigned installer, waits for the
signed one, swaps it in, rewrites `latest.yml` and the `.blockmap` for it
(`scripts/release/use-signed-installer.ts`) and fails unless Windows reports
the signature as valid. Without the variable, releases stay unsigned as before.
