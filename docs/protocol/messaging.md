# Direct messages (protocol v1)

Implemented in River 0.5.0. Schemas: [`packages/protocol/src/messaging.ts`](../../packages/protocol/src/messaging.ts).
Crypto: [`packages/crypto/src/session.ts`](../../packages/crypto/src/session.ts).
Server: [`apps/server/src/routes/messaging.ts`](../../apps/server/src/routes/messaging.ts).
Client: [`apps/desktop/src/main/dm/dm-service.ts`](../../apps/desktop/src/main/dm/dm-service.ts).

## Cryptography

libsignal, unchanged: PQXDH session setup (X25519 + ML-KEM-1024 "Kyber"
prekeys) and the Double Ratchet. Plaintext is padded Signal-style (0x80 then
zeros to a multiple of 160 bytes) before encryption. River only provides the
storage (the SQLCipher database) and the wire encoding.

## Prekeys

| Endpoint                | Purpose                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /v1/keys`          | Upload a signed prekey, a Kyber last-resort key and up to 100 one-time EC and Kyber prekeys. Every signature must verify with the account identity key.     |
| `GET /v1/keys`          | Remaining one-time prekeys (clients top up below 25, to 100).                                                                                               |
| `GET /v1/keys/:riverId` | Identity key, the identity-signed device list, and one bundle per device. One-time keys are consumed; when none are left the Kyber last-resort key is used. |

Clients rotate the signed prekey (and Kyber last-resort key) weekly.

Before starting a session the sender checks that:

1. the device list is signed by the returned identity key and names the recipient;
2. each bundle's device and registration ID appear in that list;
3. if the recipient's identity key is known from a shared community profile
   (sealed with a community key the server cannot read), it is the same key —
   otherwise sending is refused;
4. the identity key matches the one seen before (trust on first use). A change
   is accepted with a warning, or refused for contacts the user had verified.

## Envelopes and the mailbox

`POST /v1/messages/:riverId` with `{ messages: [{ deviceId, registrationId, type, body }], ephemeral? }`.
There must be exactly one envelope per current device of the recipient; otherwise
the server answers `409 device_mismatch` with `missing`, `extra` and `stale`
device lists and the client refetches keys and retries once.

The server stores each envelope in the recipient device's mailbox and pushes it
over the WebSocket (`{ t: "dm", envelope }`). Clients fetch `GET /v1/messages`
on connect and delete delivered envelopes with `POST /v1/messages/ack`.
Undelivered envelopes expire after 30 days. `ephemeral` envelopes (typing, call
setup) are only pushed to online devices and never stored.

## Content (inside the encrypted envelope)

JSON with `v: 1` and a type `t`:

| `t`                | Meaning                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `msg`              | Text, optional reply and up to 10 attachment pointers (see CRYPTOGRAPHY §5)      |
| `edit`             | New text for one of the sender's messages                                        |
| `delete`           | Delete one of the sender's messages for everyone                                 |
| `react`            | Add/remove an emoji reaction                                                     |
| `receipt`          | `delivered` / `read` for message IDs                                             |
| `typing`           | Typing indicator (ephemeral)                                                     |
| `profile`          | Sender's display name and avatar (with `groupId`: shared only inside that group) |
| `group`            | Group state from an admin: `groupId`, name, members, admins                      |
| `groupLeave`       | The sender left the group                                                        |
| `ckey` / `ckeyReq` | A community key for an epoch / a request for one (see CRYPTOGRAPHY §4a)          |
| `call`             | 1:1 call setup: invite, accept, decline, busy, end, WebRTC signal (ephemeral)    |

Receivers validate every field; edits and deletes are applied only to messages
from the same sender. Messages from people you have not accepted arrive as
**requests**: no delivery or read receipts, no typing, no calls until accepted.

## Groups

Groups use pairwise libsignal sessions: a group message is encrypted separately
for every other member (fine for the 32-person limit; sender keys are a later
optimisation). `msg`, `edit`, `delete`, `react` and `typing` carry a `groupId`;
receivers accept them only from current members of a group they are in. Only
admins (initially the creator) change the name or membership; removed people
stop receiving messages because nobody encrypts to them any more. A group from
someone you have not accepted arrives as a request; your name is shared with
the group only once you accept. Groups have no read receipts or calls yet.

## Blocks

`PUT/DELETE /v1/blocks/:riverId`, `GET /v1/blocks`. A blocked person gets
"not found" for your keys and their envelopes are accepted (so they cannot tell)
and dropped. The server therefore knows your block list.

## What the server learns

Who messages whom and when, envelope sizes (padded), device counts, and block
lists. Not: content, names, avatars, reactions, receipts, typing or call setup.
Sealed sender (hiding the sender from the server) is planned.
