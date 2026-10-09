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

| Variable                      | Default                           | Meaning                                               |
| ----------------------------- | --------------------------------- | ----------------------------------------------------- |
| `RIVER_HOST`                  | `127.0.0.1` (`0.0.0.0` in Docker) | Listen address                                        |
| `RIVER_PORT`                  | `8787`                            | Listen port                                           |
| `RIVER_DATABASE_URL`          | `sqlite:./data/river.sqlite`      | `sqlite:<path>` or `postgres://user:pass@host/db`     |
| `RIVER_LOG_LEVEL`             | `info`                            | `fatal` … `debug`, or `silent`                        |
| `RIVER_TRUST_PROXY`           | `false`                           | Trust `X-Forwarded-For` (only behind your own proxy)  |
| `RIVER_RATE_LIMIT_PER_MINUTE` | `300`                             | Per-client request limit (in-memory counters)         |
| `RIVER_PUBLIC_URL`            | —                                 | Public `https://` URL; enables HSTS                   |
| `RIVER_ATTACHMENT_DIR`        | `./data/attachments`              | Encrypted file blobs (back this up with the database) |
| `RIVER_MAX_ATTACHMENT_MB`     | `25`                              | Largest encrypted file accepted                       |

Invalid values stop the server at start-up with a list of every problem.

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
