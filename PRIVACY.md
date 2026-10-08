# River Privacy

River is a privacy-first, end-to-end encrypted platform designed to minimise
unnecessary metadata and keep communication contents inaccessible to the
server. It is **not** an anonymity network and does not claim to make anyone
untraceable. This document lists, plainly, what is collected and why.

## What River does not collect

- No advertising SDKs, behavioural advertising, session recording or tracking pixels.
- No analytics or telemetry. If telemetry is ever added it will be opt-in,
  documented here first, and contain no content or identifiers.
- No phone number, e-mail address or real name is required to create an account.
- No address-book upload.
- Message, file, post, story and call **content** never reaches the server in
  readable form.

## What the River desktop app sends today (0.0.x)

| Request         | Destination                                    | Contents                                                                                | Why                                            |
| --------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Update check    | `github.com` / `objects.githubusercontent.com` | Standard HTTPS request (your IP address and a generic user agent are visible to GitHub) | Find new versions on your selected channel     |
| Update download | same                                           | —                                                                                       | Download the installer and its signed manifest |

You can disable automatic update checks in **Settings → Updates**. GitHub's own
privacy policy applies to these requests.

## What River keeps on your computer

Your identity key pair, display name and settings, inside River's encrypted
local database. Nothing about your identity is sent anywhere in 0.0.x.

## What a River server stores (from 0.1.0)

See the full table in [THREAT_MODEL.md §5](THREAT_MODEL.md#5-what-the-server-can-see).
Today (0.1.0): your River ID, your public identity key, your signed device list
(device IDs and public device keys), the day the account and each device were
created, hashed session tokens until they expire, and one-time login challenges
for five minutes. No name, phone number, e-mail, IP address or last-seen time.

Planned as features arrive: account ID, optional username, public keys, device list, encrypted
profile, queued encrypted messages until delivered (max 30 days), encrypted
attachments until expiry, and community/group membership needed for delivery.

The reference server does **not** write IP addresses, message metadata or
request bodies to logs. Operators who place a reverse proxy in front must
configure it the same way; the deployment guide shows how.

## Notifications

Desktop notifications default to "New River message" without sender or
content. You can choose to show the sender, or sender and preview. Mobile push
messages (Stage 2) never contain content; the app wakes up and decrypts locally.

## Your controls (planned, 0.1.3)

Who can find me, message me, add me, follow me, see my profile, posts, stories,
online status and last-active time, add me to groups and call me — each set to
Everyone / Contacts / Selected people / Nobody.

## Self-hosting

River's server is open source. Anyone can run their own; the operator then
holds the metadata listed above for their users, and still cannot read content.
