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
7. Tag and push:
   ```bash
   git tag -a vX.Y.Z -m "River X.Y.Z"
   git push origin vX.Y.Z
   ```
8. Watch **Actions → Release**. It verifies, builds all platforms, signs and
   publishes. Check the release page has installers for all three OSes,
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
