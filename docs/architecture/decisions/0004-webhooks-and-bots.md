# ADR 0004 — Webhooks and bots without giving up end-to-end encryption

Status: accepted (1.0.32). Incoming webhooks shipped in 1.0.32. Bot
accounts need a small client library that speaks River's protocol
(libsignal sessions, community keys); they are planned after 1.0 and are not
available yet. Built-in slash commands have existed since 1.0.25.

## Context

Discord-style webhooks let an outside service post into a channel by sending
plain JSON to a URL. Bots are server-side programs that read every message.
Both assume the server can read content. River's server must never receive
plaintext content or private keys, so neither model can be copied as is.

## Decision

### Incoming webhooks: the poster encrypts

1. A member with `MANAGE_CHANNELS` creates a webhook for one channel. Their
   River app generates a random 32-byte **webhook key** and a random 32-byte
   **token**.
2. The server stores only the channel, a display name, `sha256(token)`, the
   creator and the creation time. It never sees the key.
3. The webhook key and name are sealed into the community (purpose
   `webhook:<id>`) so every member who can read the channel can read webhook
   posts.
4. The app shows one secret **webhook address**:
   `river-webhook://<server>/<id>#<token>.<key>` — the part after `#` is never
   sent anywhere by River.
5. The outside service seals each post with the existing community format
   (AES-256-GCM, AAD `river-community-v1|<community>|message:<channel>`)
   under the **webhook key**, and posts the ciphertext with the token as a
   bearer credential. A small reference script (`scripts/webhook/post.mjs`,
   Node `crypto` only) does this.
6. The server checks the token hash, the channel and a rate limit, then stores
   and fans out the ciphertext like any message, with author `webhook:<id>`.
   Apps open it with that webhook's key and label it **WEBHOOK**.
7. Deleting a webhook makes the token stop working at once (audited).

Consequences and limits, stated in the UI and threat model:

- Whoever holds the webhook address can post as that webhook (not read).
- The outside service sees what it posts, by definition.
- A removed member who copied a webhook key could read future webhook posts
  only if they also obtained the ciphertext, which needs membership; deleting
  and recreating the webhook removes even that.
- No outgoing webhooks: the server cannot forward content it cannot read.

### Bots: members you can see

A bot is a River account flagged as a bot by its owner. It joins with an
invite like anyone, receives the community key like any member and therefore
**reads whatever its roles let it read**. River does not pretend otherwise:

- Bots carry a **BOT** badge everywhere and cannot hide it.
- Adding one shows exactly which channels it will be able to read.
- Slash commands are ordinary encrypted messages with a command shape that
  apps render as a command and bots parse; replies are ordinary messages.
- Bots never get server-side superpowers; every permission check is the same.

## Alternatives rejected

- **Server-side plaintext webhooks** — breaks the core guarantee.
- **Giving outside services the community key** — lets them read everything.
- **Hidden or "trusted" server bots** — invisible readers; not acceptable.
