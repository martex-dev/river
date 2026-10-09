# Release signing — current setup and hardening plan

River's updater installs a release only if its manifest carries a valid
Ed25519 signature from a key in `packages/release/src/trusted-keys.ts`
(`TRUSTED_RELEASE_KEYS`). This document says where that key lives today, what
an attacker would need, and how the setup gets stronger.

## Today (1.0.0)

- One Ed25519 release key. The private key exists in two places only: the
  `RIVER_RELEASE_SIGNING_KEY` GitHub Actions secret, used by the tag-driven
  Release workflow, and an offline backup held by the maintainer.
- Installed apps pin the public key. A release signed by anything else, a
  modified manifest or a modified installer is refused, and the running
  version keeps running.
- Updates never downgrade, and each channel only accepts its own releases.

**Residual risk.** Someone who controls the maintainer's GitHub account (or
the repository's Actions) can run the Release workflow and ship a signed
malicious update. This is documented in [THREAT_MODEL.md](../../THREAT_MODEL.md).

## Plan

Each step keeps old installs updating, because the trust list is a list: a new
key is added in one release and the old key is removed in a later one.

| Step | What                                                                                                                                                                                      | Needs                                                  | When                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------ |
| 1    | Put the signing secret in a protected `release` GitHub environment that requires the maintainer's manual approval, and require a hardware security key or passkey for the GitHub account. | Maintainer (repository and account settings)           | As soon as possible      |
| 2    | Generate a new Ed25519 key **on a hardware security key** (OpenPGP or PIV applet). Sign the manifest on the maintainer's machine; CI builds but no longer holds a signing key.            | A hardware security key (maintainer purchase)          | 1.1.x                    |
| 3    | Ship a release that trusts both keys, then a release that trusts only the hardware key. Destroy the CI secret.                                                                            | Steps 1–2                                              | The two releases after 2 |
| 4    | Threshold signing: manifests carry several signatures and the updater requires two of three independent keys held by different people.                                                    | Additional maintainers; signature-list manifest format | Before 2.0.0             |

Steps 1–3 need decisions and hardware only the maintainer can provide; they
are listed in the open decisions at the end of [ROADMAP.md](../../ROADMAP.md).
Step 4 changes the manifest format and is planned with the 1.1.x protocol freeze.
