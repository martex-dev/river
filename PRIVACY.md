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

## Who the River desktop app talks to

River only connects to other computers for things you use. Nothing is sent to
the River project itself.

| Request                        | Destination                                     | Contents                                                                                        | Why                                                   |
| ------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Your River server              | The server you or your community use            | End-to-end encrypted messages, files and keys; your account ID. The server sees your IP address | Accounts, communities, delivering messages            |
| Calls                          | The people in the call (directly, peer to peer) | Encrypted audio and video (DTLS-SRTP). Participants see each other's IP address                 | Voice and video                                       |
| Following a moved server       | `ntfy.sh`                                       | Nothing about you: River reads the server's signed "this is my new address" note                | Reconnect when a home-hosted server changes address   |
| Invite pages                   | `martex-dev.github.io` (GitHub Pages)           | Standard HTTPS request when you open an invite link in a browser                                | Show install steps and the "Open in River" button     |
| Link previews (off by default) | The website you link to                         | Standard HTTPS request from your computer, only when you send a link                            | A title and description inside your encrypted message |
| Update check and download      | `github.com` / `objects.githubusercontent.com`  | Standard HTTPS request (your IP address and a generic user agent are visible to GitHub)         | Find and download new versions                        |

**Only on a PC that hosts a server:** River downloads `cloudflared` from GitHub
once and opens a Cloudflare tunnel, or — if you installed and signed in to
Tailscale — a Tailscale Funnel address. Members' connections pass through that
provider in encrypted form; it sees their IP addresses, not their messages.
Cloudflare's and Tailscale's own privacy policies apply to those connections.

You can disable automatic update checks in **Settings → Updates**. GitHub's own
privacy policy applies to these requests.

## What River keeps on your computer

Your identity key pair, messages, display name and settings, inside River's
encrypted local database. In **Settings → System → Privacy** you can have this
device delete direct and group messages older than a day, a week, 30 days, 90
days or a year, and give chats you start a disappearing-messages timer by
default (2.13).

## Hiding your IP address (computers, 2.13)

**Settings → System → Privacy → Connect through a proxy** sends River's
connections (to your server, the address relay and update checks) through a
SOCKS5 proxy such as Tor (`127.0.0.1:9050`, or `9150` for Tor Browser) or an
HTTP proxy. The server then sees the proxy's address instead of yours; it still
sees your account and who you talk to. Calls never connect directly while it is
on, link previews are off, and River does not connect at all when the proxy is
down. **Test connection** checks that your server answers through it.

## Photos

Before a JPEG, PNG or WebP picture is encrypted and sent, River removes its
hidden metadata (location, camera, time, descriptions), keeping only which way
up it is. Videos and other files are sent as they are.

## What a River server stores (from 0.1.0)

See the full table in [THREAT_MODEL.md §5](THREAT_MODEL.md#5-what-the-server-can-see).
Today (0.1.0): your River ID, your public identity key, your signed device list
(device IDs and public device keys), the day the account and each device were
created, hashed session tokens until they expire, and one-time login challenges
for five minutes. No name, phone number, e-mail, IP address or last-seen time.
After an account is deleted the server keeps its River ID, public identity key
and the day (so the ID cannot be taken over under another key), and holds the
username for 30 days (2.11).

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
