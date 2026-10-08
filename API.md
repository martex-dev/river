# River APIs

River has two kinds of interface. Both are versioned and validated at the boundary.

## 1. Desktop IPC (`window.river`) — implemented

The sandboxed UI talks to the trusted main process only through the API exposed
by the preload script. Types: [`apps/desktop/src/shared/ipc.ts`](apps/desktop/src/shared/ipc.ts).

| Call                                   | Returns          | Notes                                                                                                       |
| -------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `app.info()`                           | `AppInfo`        | Version, channel, platform, runtime versions                                                                |
| `settings.get()`                       | `Settings`       |                                                                                                             |
| `settings.update(patch)`               | `Settings`       | Patch validated with zod (strict; unknown keys rejected)                                                    |
| `updates.status()` / `updates.check()` | `UpdateStatus`   | State machine: idle → checking → downloading → verifying → ready, or up-to-date / manual / error / disabled |
| `updates.install()`                    | —                | Refuses unless a signature-verified update is ready                                                         |
| `updates.openDownloadPage()`           | —                | Opens the release page for the pending version                                                              |
| `updates.onStatus(listener)`           | unsubscribe fn   | Push notifications of status changes                                                                        |
| `security.status()`                    | `SecurityStatus` | What the Security Center shows                                                                              |
| `links.open(id)`                       | —                | Opens one of a fixed set of project URLs; arbitrary URLs are never accepted                                 |

Main rejects any IPC call whose sender is not River's own top-level UI frame.

## 2. River server API

HTTPS JSON API under `/v1` plus an authenticated WebSocket at `/v1/ws` (0.2.0).
Every response carries `X-River-Protocol`; errors are `{ "error": { "code", "message" } }`.
The full specification will live in [`docs/protocol/`](docs/protocol/README.md)
with machine-readable schemas in `packages/protocol`. Planned resources:

| Resource                                           | Purpose                                                | Milestone |
| -------------------------------------------------- | ------------------------------------------------------ | --------- |
| `GET /v1/version`                                  | Server and protocol version                            | 0.0.2     |
| `GET /v1/health`                                   | Liveness                                               | 0.0.2     |
| `POST /v1/accounts`                                | Register (identity key, device key, username optional) | 0.1.0     |
| `POST /v1/auth/challenge`, `POST /v1/auth/session` | Device challenge–response login                        | 0.1.0     |
| `PUT /v1/devices/list`                             | Upload identity-signed device list                     | 0.1.0     |
| `PUT /v1/profile`                                  | Encrypted profile                                      | 0.1.1     |
| `PUT /v1/keys`, `GET /v1/keys/{account}/{device}`  | Prekey upload and fetch                                | 0.2.0     |
| `PUT /v1/messages/{account}`                       | Send encrypted envelopes                               | 0.2.0     |
| `WS /v1/ws`                                        | Receive envelopes, acks                                | 0.2.0     |
| `POST /v1/attachments`                             | Upload encrypted blob                                  | 0.5.0     |
