# Self-hosting the River server

The River server stores and routes **ciphertext only**. Whoever runs it learns
the metadata listed in [THREAT_MODEL.md §5](../../THREAT_MODEL.md#5-what-the-server-can-see)
and nothing else. As of 0.0.2 the server only answers `/v1/health` and
`/v1/version`; accounts arrive in 0.1.0.

## Quick start (Docker)

```bash
git clone https://github.com/martex-dev/river.git && cd river
docker compose -f deploy/docker-compose.yml up -d
curl http://127.0.0.1:8787/v1/version
```

The compose file runs the container read-only, without Linux capabilities,
bound to localhost, with data in the `river-data` volume.

## Without Docker

Requires Node.js 24.

```bash
npm ci --omit=dev --workspace @river/server
RIVER_DATABASE_URL=sqlite:/var/lib/river/river.sqlite npm start -w @river/server
```

## Configuration

| Variable                      | Default                           | Meaning                                                                                                                  |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `RIVER_HOST`                  | `127.0.0.1` (`0.0.0.0` in Docker) | Listen address                                                                                                           |
| `RIVER_PORT`                  | `8787`                            | Listen port                                                                                                              |
| `RIVER_DATABASE_URL`          | `sqlite:./data/river.sqlite`      | `sqlite:<path>` or `postgres://user:pass@host/db`                                                                        |
| `RIVER_LOG_LEVEL`             | `info`                            | `fatal` … `debug`, or `silent`                                                                                           |
| `RIVER_TRUST_PROXY`           | `false`                           | Trust `X-Forwarded-For` (only behind your own proxy)                                                                     |
| `RIVER_RATE_LIMIT_PER_MINUTE` | `300`                             | Per-client request limit (in-memory counters)                                                                            |
| `RIVER_PUBLIC_URL`            | —                                 | Public `https://` URL; enables HSTS                                                                                      |
| `RIVER_ATTACHMENT_DIR`        | `./data/attachments`              | Encrypted file blobs (back this up with the database)                                                                    |
| `RIVER_TURN_URLS`             | —                                 | TURN relays for calls (see [turn.md](turn.md))                                                                           |
| `RIVER_TURN_SECRET`           | —                                 | coturn `static-auth-secret`                                                                                              |
| `RIVER_MAX_ATTACHMENT_MB`     | `25`                              | Largest encrypted file accepted                                                                                          |
| `RIVER_MAILBOX_TTL_DAYS`      | `30`                              | Days undelivered direct messages wait for a device that does not collect them (1–90); delivered ones are deleted at once |
| `RIVER_SESSION_TTL_HOURS`     | `24`                              | Hours a session lasts without use; a session in use is renewed                                                           |
| `RIVER_SESSION_MAX_DAYS`      | `90`                              | Days after sign-in a session ends however often it was renewed (1–365); River then signs in again by itself              |
| `RIVER_MAILBOX_LIMIT`         | `5000`                            | Undelivered direct-message envelopes kept per device                                                                     |
| `RIVER_MAILBOX_PER_SENDER`    | `2500`                            | Of those, how many one sender may have waiting for one device (your own devices are not counted)                         |
| `RIVER_MAILBOX_MAX_MB`        | `100`                             | Stored size of a device's undelivered envelopes; one sender may use half                                                 |
| `RIVER_ATTACHMENT_QUOTA_MB`   | `2048`                            | Total size of the files one person keeps on the server                                                                   |
| `RIVER_ATTACHMENT_TOTAL_MB`   | `0` (no total)                    | Total size of all files on the server                                                                                    |
| `RIVER_MIN_FREE_DISK_MB`      | `1024`                            | Uploads are refused while less than this would stay free on the attachment folder's disk                                 |

Invalid values stop the server at start-up with a list of every problem.

The mailbox and file limits (2.20) keep one person, or a full disk, from taking
the server down: a direct message over a sender's share is refused with `429`
(`mailbox_full`), one over a device's size cap with `507`, and an upload while
the disk is nearly full or past `RIVER_ATTACHMENT_TOTAL_MB` with `507`
(`quota_exceeded`). The defaults let a few thousand messages wait for a friend
who is offline.

`RIVER_TRUST_PROXY=true` trusts only a proxy or tunnel on the same machine
(loopback), such as Tailscale Funnel or Caddy on the host: the client address is
the one it appends. Name a proxy elsewhere (another container or host) by
address or range instead, e.g. `RIVER_TRUST_PROXY=172.18.0.0/16`. River never
trusts every hop, or clients could pick their own address and escape the
per-address limits.

## TLS and reverse proxy

Expose River only over HTTPS. Example with Caddy (automatic certificates):

```
river.example.org {
  reverse_proxy 127.0.0.1:8787
  log {
    output discard
  }
}
```

**Keep proxy access logs off** (or strip IP addresses). River itself never
writes client IP addresses, headers, query strings or bodies to its logs; a
proxy that does would undo that.

## Database

- **SQLite** (default) — one file, WAL mode, `secure_delete` on. Back it up
  with `sqlite3 river.sqlite ".backup backup.sqlite"` while running.
- **PostgreSQL** — set `RIVER_DATABASE_URL=postgres://…`. Recommended for many users.

Migrations run automatically at start-up, forward-only, each batch in one
transaction. `npm run migrate -w @river/server` applies them without starting
the server.

## Pointing River at your server

River desktop → **Settings → Server** → enter `https://river.example.org` →
**Test connection**.
