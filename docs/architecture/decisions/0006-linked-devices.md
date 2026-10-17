# ADR 0006 — Linked devices: one account on phone and computer

Status: accepted (2026-10-15), built for 1.3.0.

## Context

Until 1.3 every River install is its own account. With phones (1.1, 1.2)
people want the same account — the same River ID, friends, communities and
direct messages — on their computer and their phone.

The protocol already has the pieces: an account's **device list** is signed by
its identity key and lists up to 10 devices, each with its own authentication
key and registration ID; sessions and prekeys are per device; senders already
encrypt direct messages for every device of a recipient and retry when the
server reports `device_mismatch`. What was missing is a way to add a device.

## Decision

**Linking** (a new device joins an existing account):

1. On a device that is already linked, the person chooses _Link a new device_.
   It makes an 80-bit **link secret** and shows it as a code
   (`XXXX-XXXX-XXXX-XXXX`, Crockford base32) and as a link
   (`river://link?s=<server>&c=<code>`). The secret never reaches the server.
2. The new device takes the code (typed — on River's own server the code alone
   is enough — or pasted as the link). It makes its device authentication key,
   a registration ID and a one-time **link key** (libsignal), and posts a
   _hello_ with their public halves to the **link mailbox**
   `PUT /v1/link/:id`, where `id = HMAC-SHA256(secret, "river-link-mailbox-v1")`
   (first 16 bytes). The hello carries `mac = HMAC-SHA256(secret,
"river-link-hello-v1|" ‖ fields)`.
3. The linked device finds the hello in the mailbox, checks the `mac` (a hello
   from anyone without the code is refused and the attempt ends), and asks the
   person: _Link “Pixel 9” to your account?_
4. On confirmation it signs a new device list with the identity key (XEdDSA, as
   at registration) that adds the new device — `PUT /v1/accounts/me/devices`
   (new; the version must grow, the calling device must stay with its key,
   listed devices never change keys) — and posts the **provisioning message**
   to the mailbox: the River ID, the identity key pair, the new device's ID,
   the display name and the community keys, sealed to the link key with
   libsignal's HPKE (RFC 9180, `PublicKey.seal`), with associated data
   `"river-link-provision-v1|" ‖ id ‖ "|" ‖ secret`.
5. The new device opens it (`PrivateKey.open`), shows whose account it is
   (_Is this you?_) and, once the person agrees, adopts the identity with its own
   registration ID, signs in as its own device and uploads its own prekeys.
   If the person cancels instead, it posts a **decline** to the mailbox,
   `PUT /v1/link/:id/decline` with `mac = HMAC-SHA256(secret,
"river-link-decline-v1|" ‖ deviceId ‖ "|" ‖ authKey)`. The linked device keeps
   watching the mailbox until it expires; a decline whose `mac` checks out makes
   it sign a device list without the new device again. The server cannot forge a
   decline (it lacks the secret) — at most it can withhold one, which leaves the
   device on the list as before, to be removed by hand.

The mailbox lives ten minutes in the server's memory; each part is written
once. The server relays public keys and ciphertext only, and because the hello
and the provisioning message are both bound to the secret it can neither pose
as the new device nor hand it someone else's account.

**Afterwards**: people's direct messages reach every device (they already
encrypt per device; the server's `device_mismatch` makes them pick up the new
one). A message sent from one device is copied to the account's other devices
as a `sync` message over the account's own libsignal sessions, and accepted
only from the account itself. Communities need nothing new: membership is per
account, and the community keys travel in the provisioning message; later
rotations reach all devices like any member's.

**Removing** a device: any linked device signs a device list without it; the
server deletes its sessions, prekeys and queued messages, and it can no longer
sign in.

## Why

- No new cryptography: libsignal's XEdDSA, HPKE and sessions, HMAC-SHA256.
- The server stays blind and cannot insert itself.
- Works across desktop, Android and iOS with the shared client core.
- The phone usually is the new device: a 16-character code is easy to type.

**Removal, honestly.** Removing a device makes the server delete its session,
keys and mail and close its open connection (1.3.1), and other people's apps
stop encrypting to it once they see the newer signed device list (they never
accept an older one). A removed device keeps what it already received and,
like every linked device, holds the identity key and the community keys; River
does not rotate those on removal. Against a lost or stolen device the server's
cooperation is therefore needed, and leaving and rejoining sensitive
communities rotates their keys.

## Limits

- History is not copied (as Signal): new devices start with new messages.
- Up to 10 devices per account (the device list limit).
- Device names are only shown while linking; the device list has no names.
