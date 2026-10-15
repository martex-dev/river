# ADR 0006 — Linked devices: one account on phone and computer

Status: accepted (2026-10-15), for 1.3.x.

## Context

Until 1.3 every River install is its own account. With phones (1.1, 1.2)
people want the same account — the same River ID, friends, communities and
direct messages — on their computer and their phone.

The protocol already has the pieces: an account's **device list** is signed by
its identity key and lists up to 10 devices, each with its own authentication
key and registration ID; sessions and prekeys are per device; senders already
encrypt direct messages for every device of a recipient and retry when the
server reports `device_mismatch`. What is missing is a way to add a device.

## Decision

**Linking** (a new device joins an existing account):

1. The new device creates a fresh libsignal key pair for the link (`linkKey`)
   and its own device authentication key. It posts a hello — its device
   authentication key and registration ID — to a short-lived **link mailbox**
   on the server and shows a link code: the server address, the mailbox ID and
   `linkKey`'s public key (as text and as a `river://link?...` link).
2. On a device that is already linked, the person enters or opens that code.
   That device reads the hello, shows what will be linked, and on
   confirmation:
   - signs a new device list (identity key, XEdDSA, as today) that adds the
     new device, and uploads it (`PUT /v1/accounts/me/devices`, a new route;
     the server checks the signature and that the caller's device is kept);
   - seals the **provisioning message** to `linkKey` with libsignal's HPKE
     (`PublicKey.seal`, RFC 9180) and posts it to the mailbox. It carries the
     River ID, the identity key pair, the assigned device ID, community keys
     and the person's display name.
3. The new device opens the provisioning message (`PrivateKey.open`), stores
   the identity, signs in as its own device and uploads its own prekeys.

The mailbox holds at most two small blobs for ten minutes and is rate-limited;
the server only ever sees the hello (public keys) and the sealed message.
The link key is used once and never stored.

**Afterwards**: everyone's direct messages reach every device (they already
encrypt per device). A device's own sent messages are copied to its other
devices as `sent` transcripts over the same libsignal sessions (to its own
account). Communities need nothing new: membership is per account, and the
community keys travel in the provisioning message; later rotations reach all
devices like any member's.

**Removing** a device: any linked device can sign a device list without it;
the removed device's sessions end when its authentication key is no longer
listed.

## Why

- No new cryptography: libsignal's XEdDSA, HPKE and sessions, as elsewhere.
- The server stays blind: it relays public keys and ciphertext only.
- Works across desktop, Android and iOS with the shared client core.

## Limits

- History is not copied (as Signal): new devices start with new messages.
- Up to 10 devices per account (the device list limit).
