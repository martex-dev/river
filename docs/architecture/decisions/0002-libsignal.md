# 0002 — libsignal for end-to-end encryption

**Status:** accepted (0.0.1, used from 0.0.4)

**Context.** River must not invent cryptography. Options: libsignal, Olm/Megolm
(vodozemac), MLS (OpenMLS), or implementing the Double Ratchet from the spec.

**Decision.** libsignal: PQXDH + Double Ratchet for sessions, Sender Keys for
groups, sealed sender for metadata reduction, libsignal fingerprints for safety
numbers. It has official Node, Swift and Java bindings, matching River's
desktop, iOS and Android clients.

**Consequences.** libsignal is AGPL-3.0, so River is licensed AGPL-3.0-only —
appropriate for a network service whose users deserve the source. MLS remains
under evaluation for very large communities (1.x).
