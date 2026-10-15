# Realtime: WebSocket `/v1/ws`

One WebSocket per signed-in device carries presence, community events, call
signalling, end-to-end encrypted direct-message envelopes and relayed voice.
This page is the reference; the message shapes are frozen in
[`schema/v1.json`](../../packages/protocol/schema/v1.json) (`clientEventSchema`,
`serverEventSchema`), see [stability.md](stability.md). Source:
`packages/protocol/src/communities.ts` and `packages/protocol/src/relay.ts`.

## Connection

1. Open `wss://<server>/v1/ws`.
2. Send **within 10 seconds** a text frame `{"t":"auth","token":"<session token>"}`
   (optionally with `status`, the presence to start with, so people who chose
   to be invisible never flash online). The token comes from the challenge–
   response session flow in [accounts.md](accounts.md).
3. The server answers `{"t":"ready","riverId":"…"}`. Before that, no other event
   is accepted. A bad token gets `{"t":"error","code":"unauthorized"}` and the
   socket closes with code **4401**; no `auth` in time also closes with 4401.

Text frames are JSON, one event each. Binary frames are voice relay frames (see
below). The largest accepted frame is 64 KiB.

## Keeping it alive and limits

- The server sends a WebSocket-level ping every 25 seconds and drops a
  connection that does not answer the next one. Clients also may send
  `{"t":"ping"}` and receive `{"t":"pong"}`.
- Each socket may send about 40 text events per second with a burst of 400;
  above that the server closes it with code **4429** ("Too many events").
- A connection that cannot keep up stops receiving relay frames instead of
  growing an unbounded buffer.
- A malformed or unknown client event gets `{"t":"error","code":"bad_event"}`.
  Clients must ignore server event types they do not know: new event types are
  additive within v1 (see [stability.md](stability.md)).

## Client → server events

| `t`                    | Fields                                                                            | Purpose                                                                |
| ---------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `auth`                 | `token`, `status?`                                                                | Authenticate (first event)                                             |
| `presence.set`         | `status`                                                                          | Change your chosen presence                                            |
| `voice.join` / `leave` | `channelId` / –                                                                   | Enter or leave a voice channel                                         |
| `voice.state`          | `muted`, `deafened`, `streaming`, `handRaised?`                                   | Your voice flags (raise a hand on a stage)                             |
| `voice.moderate`       | `target`, `serverMuted?`, `serverDeafened?`, `speaker?`, `disconnect?`, `moveTo?` | Moderator actions; permission is checked by the server                 |
| `voice.sound`          | `soundId`                                                                         | Play a soundboard sound to your voice channel                          |
| `signal`               | `to`, `data` (sealed)                                                             | Call setup for one member; the server relays it and cannot read it     |
| `typing`               | `channelId`                                                                       | Typing indicator                                                       |
| `call.room`            | `room` or `null`                                                                  | Join or leave a private 1:1 call room (a hash of the call's secret ID) |
| `ping`                 | –                                                                                 | Keep-alive                                                             |

## Server → client events

| `t`                                                 | Fields                                | Meaning                                                                          |
| --------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| `ready`                                             | `riverId`                             | Authenticated                                                                    |
| `message` / `message.delete`                        | community, message / ids              | A channel message arrived or changed / was deleted                               |
| `member`, `channel`                                 | community and the changed object      | A member or channel changed                                                      |
| `community`                                         | `communityId`                         | Something structural changed (roles, settings, membership): refetch              |
| `removed`                                           | `communityId`, `reason`               | You were kicked, banned, left, or the community was deleted                      |
| `voice`                                             | channel, `participants`, `states?`    | Who is in a voice channel and their flags (`reconnecting` during a grace period) |
| `voice.disconnect`                                  | `moveTo?`                             | You were taken out of voice, or moved by a moderator                             |
| `voice.sound`                                       | community, channel, `from`, `soundId` | Someone played a soundboard sound                                                |
| `sounds`, `stickers`, `events`, `emojis`, `reports` | `communityId`                         | That community collection changed: fetch it again                                |
| `signal`                                            | `from`, `channelId`, `data` (sealed)  | Call setup from another member                                                   |
| `typing`                                            | community, channel, `riverId`         | Someone is typing                                                                |
| `presence`                                          | `riverId`, `online`, `status?`        | A person's presence                                                              |
| `dm`                                                | `envelope`                            | An end-to-end encrypted direct-message envelope for this device                  |
| `error`                                             | `code`                                | `unauthorized`, `bad_event`, `internal`, …                                       |
| `pong`                                              | –                                     | Reply to `ping`                                                                  |

Everything human-readable inside these events (message text, names, topics,
signals) is sealed end to end; the server sees only what it needs to enforce
permissions and route events. See [CRYPTOGRAPHY.md §4a](../../CRYPTOGRAPHY.md).

## Voice relay frames (binary)

When two members of a voice channel cannot connect directly, their apps send
voice through the server as binary frames over this same socket. The payload
is end-to-end encrypted by the sender (AES-256-GCM, per-call sender key
exchanged in sealed signals, see CRYPTOGRAPHY.md §8); the server learns only who
sends to whom, when, and how big.

```
Client → server:  [0x01][n: 1..24][n × 16-byte recipient River ID][payload]
Server → client:  [0x01][16-byte sender River ID][payload]
```

- At most **24 recipients** per frame; payload at most **1200 bytes**.
- A sender may relay about 120 frames per second with a burst of 240.
- The server forwards a frame only to recipients in the sender's own voice
  channel (or private call room) and never stores frames.
- `encodeRelayOut` / `decodeRelayOut` / `encodeRelayIn` / `decodeRelayIn` in
  `packages/protocol/src/relay.ts` are the reference implementation.
