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
| Who is in a call together, and when (2.18)           | Yes for voice channels, relayed calls and group calls (their room, not the group or the call's name)            | CRYPTOGRAPHY.md §8a                                                         |
| Message timestamps and sizes                         | Yes (server receive time, padded sizes)                                                                         | Size buckets since 2.15 (CRYPTOGRAPHY.md §4)                                |
| IP addresses                                         | Seen while connected; **not stored** by River. Hidden from the server by Settings → Privacy → Proxy (2.15)      | Reverse proxies must be configured likewise; documented in deployment guide |
| Push tokens (Stage 2)                                | Yes                                                                                                             | Pushes carry no content                                                     |
| Contact lists / address book                         | **No**                                                                                                          | River never uploads address books                                           |

### 5n. What the server keeps, and for how long (audit, 2.15)

| Kept                                                                                               | How long                                                                                                    |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Direct-message envelopes: sender, sender device, recipient device, receive time, padded ciphertext | Until the device collects them (then deleted at once), else `RIVER_MAILBOX_TTL_DAYS` (default 30) days      |
| Typing and other short-lived signals                                                               | Never stored (relayed to connected devices only)                                                            |
| Read and delivery receipts                                                                         | Ordinary encrypted envelopes, padded like messages: the server cannot tell them from messages               |
| Sessions (hashed token, device, expiry)                                                            | Until expiry; renewing a session in use moves its expiry, which shows roughly when the device was last used |
| Sign-in challenges, sign-up codes, username holds                                                  | Until they expire (5 minutes, 7 days, 30 days); deleted at start and hourly since 2.15                      |
| Attachments: padded size, uploader, upload time, the message they belong to                        | Unattached: 24 hours; direct-message files: 31 days; community files: as long as their message              |
| Community messages, reactions, membership, roles                                                   | As long as the community; the audit log 90 days                                                             |
| Presence, voice participants, who is online                                                        | In memory only, while connected                                                                             |
| Push tokens                                                                                        | None: River does not use Google's or Apple's push services                                                  |
| IP addresses, request bodies, identifiers in logs                                                  | Never: request logs hold method, route template, status and duration only                                   |

Since 2.15 the hourly clean-up also runs when the server starts, so a server
restarted more often than hourly (a home PC) still deletes expired mail. What
the server can still see while it runs: which account sends a direct message
to which (sealed sender is not implemented), when, roughly how large (bucket
sizes), who is online, and community membership and activity. A proxy (Tor)
hides your IP address from it, not your account.

### 5o. Proxy and photos (2.13, computers)

With Settings → System → Privacy → Proxy on, River's connections to its
server, the address relay and update checks go through a SOCKS5 (Tor) or HTTP
proxy, host names resolved by the proxy. If the proxy is unreachable River does
not connect (no direct fallback). Calls send no UDP outside the proxy
(Chromium's `disable_non_proxied_udp`), so there is no direct peer-to-peer
media: voice goes through TURN over TCP or River's server relay, and the people
in a call do not learn the computer's address; video and screen sharing need a
TURN relay. Link previews are not made. Hosting a server on the PC is not
proxied. The proxy operator (a Tor exit, or the HTTP proxy) sees that you
connect to your River server, and when; TLS keeps the content from it. Phones
have no proxy setting yet.

Photos (JPEG, PNG, WebP) lose Exif, XMP, IPTC, comments, text chunks and
appended images before they are encrypted (only the orientation is kept).
Videos and other files are sent as they are, and file names are kept.

### 5p. Server hardening (security audit, 2.20)

- **Sessions end.** A session kept alive by an open connection used to renew
  forever, so a stolen token stayed good as long as the device stayed
  connected. Since 2.20 every session ends 90 days after sign-in
  (`RIVER_SESSION_MAX_DAYS`) however often it was renewed, and the app signs in
  again with its device key. River signs out when it quits
  (`DELETE /v1/sessions/current`, which also ends the connections that used the
  session); removing a device ends its sessions and connection at once. A token
  stolen from memory of a running River is still good until one of these
  happens.
- **Manage roles stays within what you hold.** A member with Manage roles
  could give anyone (themselves included) a lower role that carries
  Administrator or another permission they lack. Since 2.20 a role can be
  given, taken, edited, moved, deleted or offered for self-assignment only if
  it is below your highest role and carries no permission you do not have;
  creating or editing a role still cannot grant one. Owners and administrators
  hold every permission, so only the position rule applies to them.
- **A timeout holds everywhere.** A timed-out member could still edit their
  old messages, rename their threads and pin. Since 2.20 a timeout (and a
  screened community's rules not yet accepted) also stops editing, renaming a
  thread and pinning, besides posting, reacting, starting threads, inviting and
  voice (the seat ends when the timeout starts). Reading, taking back your own
  reaction and moderating others stay possible; owners and administrators are
  never timed out. Profiles can still be republished: the app must reseal them
  after a key rotation.
- **Voice follows access.** Someone whose role or a channel's (or category's)
  overwrites stopped letting them see or connect to the voice channel they were
  in stayed in it. Since 2.20 the server ends their seat at once and tells
  their app, as for a deleted channel; a temporary role that runs out is
  noticed within a minute.
- **Mailboxes and disks have limits per sender.** One sender could fill a
  device's mailbox (5000 envelopes of up to 128 KB) and so shut everyone else
  out, and uploads could fill the disk. Since 2.20 one sender may have at most
  2500 envelopes and half of 100 MB waiting for one device
  (`RIVER_MAILBOX_PER_SENDER`, `RIVER_MAILBOX_MAX_MB`; the size counts for the
  device as a whole too), and uploads are refused while less than 1 GB would
  stay free (`RIVER_MIN_FREE_DISK_MB`) or past an optional server-wide total
  (`RIVER_ATTACHMENT_TOTAL_MB`). Many accounts working together can still fill
  a mailbox up to its cap; the 30-day expiry and the device's next collection
  empty it.
- **One-time prekeys cannot be drained by one account.** Every key-bundle
  fetch takes one of the person's one-time prekeys, so anyone could fetch
  again and again until none were left (first messages then lose the extra
  forward secrecy those keys give). Since 2.20 one account takes at most ten an
  hour from another; further fetches get the signed and last-resort keys only,
  with which sessions still start. Many accounts can still use them up
  together; the app tops them up when it next connects.
- **Key rotation cannot be stalled by one member.** A member could claim each
  new community epoch and never hand out its key; after three retries the
  server stopped asking, and the community stayed on a key nobody else had.
  Since 2.20 a member whose claim reached nobody stands aside (the server
  refuses their next claim while another member could rotate) until a rotation
  succeeds, and a stuck claim always expires, after a wait that doubles past
  the third retry (at most a day). Keys still need the proof they did before
  (CRYPTOGRAPHY.md §4a). Several accounts working together can still delay a
  rotation by one round each, and a member's second account could report the
  key as received when it was not.

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
- When Tailscale is installed and signed in on the hosting PC (1.0.43), River
  serves the same loopback server through Tailscale Funnel instead. TLS ends
  on the PC itself, so Tailscale's relays see members' IP addresses, timing and
  volume but not even the transport-level content. River runs Tailscale's CLI
  only from its install locations, accepts only a `*.ts.net` name as the
  address, and opens the "allow Funnel" page only when Tailscale printed it and
  it is on `login.tailscale.com`.
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
invite-only mode registration requires one. A username someone changes or
whose account is deleted is held for 30 days (only they may take it back), so
nobody else can pick it up and be taken for them (2.11).

### 5e. Voice reliability (1.0.16) and the voice relay (1.0.17)

The server keeps a member's voice seat for 45 seconds after their connection
drops (shown to others as "reconnecting"), and announces them offline only
after 15 seconds. For members who cannot connect directly it forwards
end-to-end encrypted voice frames (CRYPTOGRAPHY.md §8): it learns that two
members are talking through it, when, and roughly how much (frame sizes and
timing), but not what is said. Frames go only to members of the sender's own
voice channel, are rate-limited per connection, dropped for slow readers, and
never stored.

### 5f. Scheduled events (1.0.18)

An event's name, description and place are sealed with the community key.
The server stores when it starts and ends (to order and list them), which
voice channel it is in (an ID), who created it and who marked themselves
interested.

### 5g. Deleting your account (1.0.18)

`DELETE /v1/accounts/me` needs a valid session **and** a fresh one-time
challenge signed by one of the account's device keys under its own signing
context (`river-delete-account-v1`), so a leaked session token cannot delete
an account. Deletion leaves every community (owned communities are deleted)
and removes keys, devices, sessions, reactions, event interest, bans, blocks
and undelivered mail. Messages already sent remain as ciphertext. Since 2.11 a
tombstone stays — the River ID, its public identity key and the day — so the
River ID can be registered again only with that same key (never by someone
else posing as the person contacts knew), and the username is held for 30 days.

### 5h. Custom emoji (1.0.19)

Each emoji's name and picture are sealed with the community key. The server
stores the sealed blob (it learns its size), who added it and when. Using an
emoji in a message or a reaction is inside the sealed message or reaction.

### 5i. Reports (1.0.21)

A report's reason and its copy of the message (as the reporter saw it) are
sealed with the community key, so only members can read them; the River
client shows them only to people with _Manage messages_ in that channel, and
the server only lists them to those people. The server learns which message
was reported, by whom, about whom, when, and its status. Because the copy is
the reporter's, moderators are told to check the original message when it
still exists. Each person can report a message once and have at most 20 open
reports per community.

### 5j. Incoming webhooks (1.0.32, ADR 0004)

A webhook's name and posting key are sealed with the community key; the
server stores only the channel, the creator, the creation time and a SHA-256
hash of the posting token. The token and key travel only in the part of the
webhook address after `#`, which River and HTTP clients do not send. The
outside service seals each post itself, so the server sees ciphertext, the
webhook ID, the time and the size — as for any message. Whoever holds the
address can post (not read) until the webhook is deleted, which disables the
token at once; deleted webhooks keep their sealed key so earlier posts stay
readable. A member removed later may still know a webhook key, but reading
posts also needs membership; deleting and recreating the webhook removes even
that. Webhook posts cannot be edited, and they carry a visible WEBHOOK badge.
There are no outgoing webhooks: the server cannot forward what it cannot read.

### 5k. Phones (1.1 Android, 1.3 iPhone)

The phone apps run the desktop's client core in a private WebView with the
same native protections: libsignal, SQLCipher with the key in the Android
Keystore or the iOS Keychain, and an untrusted interface that only sends the
same validated calls. "Stay connected" (Android) keeps that connection open
with a visible notification instead of using Google's or Apple's push
services, so neither learns when you get messages. Notifications follow the
preview setting; replies typed into a notification are encrypted by the core
like any message.

### 5l. Linked devices (1.2, ADR 0006)

A new device gets the account's identity key and community keys sealed to it
(HPKE) through a short-lived mailbox; the server sees public keys, sealed
blobs and timing. The device list is signed by the identity key, and clients
refuse lists older than one they have seen. Removing a device makes the server
end its sessions and connection, and since 2.20 the account's other devices
stop encrypting copies to it at once (they never use an own-device list older
than the one they hold); a removed device keeps what it already had
(including keys), so against a lost device the server's cooperation matters.

### 5m. Remote assistance (1.8, ADR 0007)

Screen sharing in a call needs a pick in River's picker and a "Share your
screen?" question asked by main; an always-on-top bar outside the window says
who can see it and stops it. Viewers can point (a ring on the shared screen);
there is no remote control and no unattended mode. The server relays the
encrypted call and point signals and sees who takes part, as for any call.

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
| Elevation       | Remote-assistance abuse                | Consent asked by main per share, always-visible bar with Stop outside the window, no control or unattended mode (ADR 0007)              | ✅ 1.8.0                                               |

## 7. Residual risks (current)

- **The server decides community membership.** A removed member whom a
  malicious server keeps listing still gets the next community key from the
  rotating member, and can then prove the epoch after it. Since 2.18 River
  accepts no key without a proof, so someone who held a genuine key only long
  ago can no longer hand out one of their own; members the server adds
  without ever holding a key get nothing (CRYPTOGRAPHY.md §4a–4b).
- **Which community a channel belongs to** comes from the server. Since 2.18 a
  channel stays with the community it was first seen in during a run of River;
  on the first look after River starts, a server listing a channel under a
  community whose key it knows shows it there (with a placeholder name unless
  it knows that key) rather than in its own community.
- **A call answered on Android's lock screen** shows only the call there
  (2.18). Group call screens that are not River's full-screen call show
  nothing until the phone is unlocked.
- **Trust on first use.** Without verified safety numbers or a shared
  community, a server can still present a different identity key for a
  contact; River shows the change but cannot tell it from a reinstall. With a
  shared community the key in that person's sealed profile is checked both
  ways: for a first message to them, and since 2.20 for a first message from
  them.
- **Community messages sealed with v1 associated data** (everything sent
  before 2.12, and anything from Rivers not yet on 2.12) can still be
  re-attributed to another sender or replayed under a new ID by the server;
  receivers keep opening v1 so old history stays readable.

- **Linked devices are not revoked cryptographically.** A removed device keeps
  the identity and community keys it had; the server ends its access. Leaving
  and rejoining a community rotates that community's key.
- **Android preview signing, unsigned iPhone app.** Until the maintainer
  creates River's permanent Android key, APKs use a one-off key (the first
  permanent build needs a reinstall); the iPhone app is an unsigned .ipa.
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
