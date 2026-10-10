# River Threat Model

This document states what River protects, against whom, and — just as
important — what it does **not** protect against. It is reviewed at every minor
release and before 1.0.0 and 2.0.0.

## 1. Assets

| Asset                                                   | Where it lives                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| Message, post, story and file **content**               | Clients (plaintext), server (ciphertext only)                  |
| Call audio/video                                        | Clients; relays see SRTP/frame-encrypted packets               |
| Private keys (identity, device, prekeys, session state) | Client only, encrypted at rest                                 |
| Social graph (who talks to whom)                        | Partially visible to the server (see §5)                       |
| Account existence, username, public profile fields      | Server (by design; profile content is encrypted where private) |
| Integrity of River software                             | GitHub, CI, the release signing key                            |

## 2. Adversaries

| ID  | Adversary                                                            | Capabilities                                        |
| --- | -------------------------------------------------------------------- | --------------------------------------------------- |
| A1  | Passive network observer (ISP, Wi-Fi operator)                       | Sees traffic timing, sizes, IP addresses            |
| A2  | Active network attacker                                              | Can intercept/modify traffic, run fake servers      |
| A3  | Malicious or compromised River server operator                       | Full control of server code, DB, logs               |
| A4  | Other River users (spammers, harassers, malicious community members) | Can message, join communities, send files           |
| A5  | Thief with a powered-off / locked device                             | Physical access to disk                             |
| A6  | Malware running as the user on an unlocked device                    | Arbitrary code as the user                          |
| A7  | Supply-chain attacker                                                | Compromises a dependency, CI, or the GitHub account |
| A8  | Remote-assistance abuser (Stage 2)                                   | Social-engineers a victim into a session            |

## 3. Security goals

| Goal                                             | Against            | Mechanism                                                                                 |
| ------------------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------- |
| G1 Confidentiality of content                    | A1, A2, A3         | libsignal E2EE, encrypted attachments, E2EE call frames                                   |
| G2 Integrity/authenticity of content             | A1–A4              | Double Ratchet MACs, sender certificates, signed device lists                             |
| G3 Forward secrecy & post-compromise security    | A3 after key theft | Double Ratchet; prekey rotation                                                           |
| G4 Detect identity substitution (MITM by server) | A3                 | Safety numbers, QR verification, key-change warnings, identity-signed device lists        |
| G5 Minimise metadata                             | A1, A3             | Sealed sender, no contact upload, no IP retention, minimal logs                           |
| G6 Protect data at rest                          | A5                 | SQLCipher DB, key wrapped by OS keystore, encrypted media cache                           |
| G7 Software integrity                            | A7                 | Ed25519-signed release manifests, pinned CI actions, SBOM, checksums, reviewable source   |
| G8 Abuse resistance                              | A4                 | Message-request gating, privacy settings, block/report, rate limits, community moderation |
| G9 Consent for remote control                    | A8                 | Explicit approval, always-visible indicator, instant termination, no unattended mode      |

## 4. Non-goals / out of scope

River does **not** claim to defend against:

- **A6 malware on an unlocked device.** Malware running as the user can read the
  screen, keystrokes and the unlocked database. No messenger can prevent this.
- **Global passive adversaries** correlating traffic timing across the internet.
  River is not an anonymity network. Users who need network anonymity should
  route River through Tor or a VPN; River will not claim to make anyone
  "untraceable".
- **Compromised operating systems or hardware.**
- **The other party.** Recipients can screenshot, photograph or forward content.
  Disappearing messages are a convenience, not a security boundary.
- **Legal compulsion of the operator** to hand over what the server has. The
  design goal is that what the server has is minimal and contains no content.

## 5. What the server can see

| Data                                                 | Visible to server?                                                                                              | Notes                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Message / post / file / call content                 | **No**                                                                                                          | E2EE                                                                        |
| Account River ID, username, device list, public keys | Yes                                                                                                             | Needed for routing and key distribution                                     |
| Display name, avatar, bio                            | No for private profiles (encrypted with a profile key shared with contacts); yes for fields a user marks public | 0.1.x                                                                       |
| Who sends to whom                                    | Yes for direct messages (sealed sender not implemented yet); block lists too                                    | Timing correlation remains possible                                         |
| Group/community membership and roles                 | Yes                                                                                                             | Needed to route and enforce permissions                                     |
| Message timestamps and sizes                         | Yes (server receive time, padded sizes)                                                                         | Padding planned                                                             |
| IP addresses                                         | Seen while connected; **not stored** by River                                                                   | Reverse proxies must be configured likewise; documented in deployment guide |
| Push tokens (Stage 2)                                | Yes                                                                                                             | Pushes carry no content                                                     |
| Contact lists / address book                         | **No**                                                                                                          | River never uploads address books                                           |

### 5a. Address relay (River Host, 1.0.8)

A server hosted on a home PC behind a quick tunnel posts signed notes of its
current public address to a relay (ntfy.sh by default; operators can turn it
off). The relay learns the server's and members' IP addresses and when they post
or read notes. It learns no content, names or membership beyond "these IPs
read this topic". Apps follow only notes signed by the server key they pinned
while connected, and only to an address that answers with that same key, so a
relay or a forger cannot redirect anyone to another server.

### 5b. Hosting from the River app (1.0.11)

When the user hosts communities on their PC, River runs the same server code in
an Electron utility process (separate from the window and from the user's own
encrypted data, which it never opens), listening on loopback only. Members
reach it through a Cloudflare quick tunnel run by `cloudflared`:

- River runs `cloudflared` only from a system install location (never `PATH`)
  or from its own copy of a pinned release, downloaded from Cloudflare's GitHub
  releases and checked against a SHA-256 built into River before first use and
  on every start (macOS: the archive is pinned, and the unpacked binary's hash
  is recorded).
- Cloudflare terminates TLS for the tunnel and sees members' IP addresses and
  connection times; content stays end-to-end encrypted.
- The address announcement endpoint accepts only the per-start secret River
  hands the server process, from loopback, without proxy headers (§5a).
- Taking over an older River Host stops a process only after its command line
  confirms it is `river-host.ts`, so a reused process id can never make River
  stop an unrelated program.
- Hosted data and daily backups sit unencrypted-at-rest in River's hosting
  folder (they contain only ciphertext and routing metadata, as on any River
  server); protect the PC's disk as you would a server's.

### 5c. River's home server and the operator (1.0.12)

River ships with one built-in home server (`apps/desktop/src/shared/home-server.ts`):
its instance ID, Ed25519 public key and announcement topic. New installs find
its current address from notes on the relay signed by that key, check the
address answers with that identity, and create their account there.

- A forged note, or a different server at the announced address, is refused,
  so nobody can steer new accounts elsewhere without the server's signing key.
  Whoever holds that key (the operator's server database) decides where new
  accounts are created; content stays end-to-end encrypted regardless.
- **The operator** (whoever runs the server) can list accounts with their
  creation date, device and community counts and online state; list
  communities with owner, member and channel counts; suspend (timeout or ban),
  remove accounts and delete communities. The server holds no names or
  content, so the operator sees names only where their own app already knows
  them (people they share a community or conversation with). This is the same
  power any server operator has over the data on their server; River makes it
  visible and explicit.
- Operator endpoints exist only with `RIVER_HOST_TOKEN`, answer only loopback
  requests without proxy headers, and need the per-start token, which never
  leaves the hosting app's main process.

### 5d. Usernames (1.0.13)

Usernames are public on their server, like on Discord: the server stores the
lowercase username next to the account so people can find each other and the
operator can tell accounts apart. Display names stay end-to-end encrypted;
usernames are not secret and are not content. Lookup and bulk-resolve
endpoints need a valid session. Operator-created accounts are one-time sign-up
codes (hashed at rest, 7-day expiry) that carry a chosen username; in
invite-only mode registration requires one.

## 6. Key threats and mitigations (STRIDE summary)

| Threat          | Example                                | Mitigation                                                                                                                              | Status                                                 |
| --------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Spoofing        | Server injects a fake device for Alice | Device list signed by Alice's identity key; clients verify on every connect and stop trusting a server that serves an unsigned list     | ✅ 0.1.0 (own list); other users' lists with messaging |
| Spoofing        | Server swaps Bob's identity key        | Safety numbers, key-change warnings, sending blocked for verified contacts until re-verified; key cross-checked with community profiles | ✅ 0.5.0                                               |
| Tampering       | Modified ciphertext                    | AEAD/MAC in libsignal and attachment format                                                                                             | ✅ 0.4.0 / 0.5.0                                       |
| Tampering       | Malicious update                       | Ed25519 manifest signature verified before install                                                                                      | **0.0.1**                                              |
| Repudiation     | —                                      | River intentionally offers deniable 1:1 messaging (Signal property)                                                                     | —                                                      |
| Info disclosure | DB stolen from disk                    | SQLCipher + OS keystore-wrapped key, or Argon2id passphrase where no keystore exists                                                    | ✅ 0.0.3                                               |
| Info disclosure | Notification previews on lock screen   | Previews off by default for sensitive content; content-free pushes                                                                      | 0.2.x / Stage 2                                        |
| Info disclosure | Sensitive logging                      | Log scrubbing helpers, no content in logs, CI lint rule                                                                                 | ongoing                                                |
| DoS             | Message flooding                       | Per-account/per-device rate limits, message requests                                                                                    | 0.2.x                                                  |
| Elevation       | Renderer XSS → key theft               | Sandboxed renderer, CSP, keys only in main process, validated IPC                                                                       | **0.0.1**                                              |
| Elevation       | Malicious file/attachment              | Attachments never auto-executed; previews rendered in sandbox; filename sanitisation; path traversal checks                             | ✅ 0.4.0                                               |
| Elevation       | Remote-assistance abuse                | Consent flow, visible banner, scam warnings ("River staff will never ask for remote access")                                            | Stage 2                                                |

## 7. Residual risks (current)

- **No independent audit yet.** River's own reviews do not replace a
  professional audit; this is stated in SECURITY.md.
- **macOS builds are not notarized** (no Apple Developer ID yet). Gatekeeper
  warns on first launch and automatic installation is disabled on macOS.
- **Windows builds are not Authenticode-signed** yet; SmartScreen warns. River's
  own Ed25519 update signatures still protect the update path.
- **Release signing key** is held as a GitHub Actions secret. Compromise of the
  maintainer's GitHub account plus that secret would allow a malicious update.
  The plan to move to a hardware key and then threshold signing is in
  [docs/security/release-signing.md](docs/security/release-signing.md); its
  first steps need the maintainer (repository settings and a hardware key).
