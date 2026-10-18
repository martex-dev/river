# Protocol v1: stability and test vectors

The River client–server protocol is **v1 and frozen**. Desktop, iOS
and Android clients, and every server, can rely on what is described here.

## What is frozen

| Artifact                                                                                         | Role                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`packages/protocol/schema/v1.json`](../../packages/protocol/schema/v1.json)                     | JSON Schema of every request, response and realtime message (generated from the zod schemas)                                                                             |
| [`packages/protocol/vectors/identity-v1.json`](../../packages/protocol/vectors/identity-v1.json) | Cross-language test vectors for identity keys, fingerprints, verification words, safety numbers and signatures                                                           |
| [`packages/protocol/vectors/formats-v1.json`](../../packages/protocol/vectors/formats-v1.json)   | Vectors for the attachment format, the recovery phrase and backup file, and device-list signing (the exact signed bytes for registration, sessions and account deletion) |

All of these are checked by tests (`schema-freeze.test.ts`, `vectors.test.ts`,
`tests/integration/format-vectors.test.ts`). A change that alters any of them
fails CI until it is made deliberately.

## Rules

1. **Additive only within v1.** New optional response fields, new endpoints and
   new realtime event types are allowed. Clients must ignore response fields
   and server event types they do not know (the desktop client drops an event
   it cannot parse and logs a warning). **Request** schemas are strict today
   (an unknown field is a 400), so a client may send a new optional request
   field only to a server whose `GET /v1/version` lists the matching
   `capabilities` entry (older servers list none). Capability names are
   append-only and never reused.
2. **Never changed within v1:** the meaning, type or requiredness of an existing
   field, an endpoint's path or method, an error code's meaning, any value in
   the test vectors, any cryptographic construction.
3. **Breaking change = protocol v2.** `PROTOCOL_VERSION` is bumped, the old
   version stays in `MIN_PROTOCOL_VERSION` until clients have migrated, and
   `GET /v1/version` advertises both so old and new clients keep working.
4. **Regenerating the schema** (`node packages/protocol/scripts/export-schemas.ts`)
   is allowed only for additive changes, and the diff must be reviewed as a
   wire change. The vectors are regenerated only for a new major version
   (`packages/crypto/scripts/generate-vectors.ts` and
   `tests/scripts/generate-format-vectors.ts` refuse to overwrite without `--force`).

## Additive changes so far

- **2.13 — voice relay to everyone in a call** (capability `voice-relay-all`):
  the `ready` event may carry `relayAll: true`; such a server also accepts the
  binary relay frame `[0x02][payload]` ("to everyone else in my voice channel
  or call room", `packages/protocol/src/relay.ts`) and forwards relayed voice
  from at most `MAX_RELAY_SPEAKERS` people of one call at a time. Clients send
  `0x02` frames only to servers that said `relayAll`; older servers drop them.

## For other-language clients

A client in Swift or Kotlin is conformant when it:

- validates messages against `schema/v1.json`;
- reproduces every value in `identity-v1.json`: public key from private key,
  fingerprint (SHA-256 of the 33-byte public key, truncated to 16 bytes),
  Bytewords verification words, the 60-digit safety number from either side
  (libsignal numeric fingerprint, 5200 iterations, version 2), and the scannable
  form from each side;
- accepts the frozen XEdDSA signature and rejects any altered message or
  signature;
- decrypts the attachment blob in `formats-v1.json` (AES-256-CBC + HMAC-SHA256,
  IV ‖ ciphertext ‖ MAC, zero padding to the size bucket) and rejects a changed
  bit, digest or key;
- turns the recovery secret into the same 18-word phrase, derives the same
  backup key (HKDF-SHA256, info `river-backup-v1`), opens the backup file and
  rejects a wrong secret or damaged file;
- builds the device-list, registration, session and account-deletion messages
  byte for byte, and verifies the frozen device-list signature, which must not
  verify against any other message domain.

The keys in the vectors are test-only and must never be used for real accounts.
