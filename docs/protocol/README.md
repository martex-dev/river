# River protocol

Specification of the River client–server API and the end-to-end layer.
Implemented incrementally from 0.0.2; the protocol is frozen as **v1** in 1.1.x
with cross-language test vectors for the desktop, iOS and Android clients.

Planned documents:

- `transport.md` — HTTPS/WSS, versioning, authentication (0.0.2–0.1.0)
- [`accounts.md`](accounts.md) — River ID, keys, signed device lists, registration and sessions (**0.1.0, implemented**)
- `messaging.md` — envelopes, prekeys, sessions, receipts (0.2.0)
- `groups.md` — sender keys, membership changes (0.4.0)
- `attachments.md` — encrypted blobs (0.5.0)
- `calls.md` — signalling and media keys (0.8.0)

See [ARCHITECTURE.md §6](../../ARCHITECTURE.md#6-protocol-overview-planned) for the overview.
