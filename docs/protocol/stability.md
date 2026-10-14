# Protocol v1: stability and test vectors

From 1.1.0 the River client–server protocol is **v1 and frozen**. Desktop, iOS
and Android clients, and every server, can rely on what is described here.

## What is frozen

| Artifact                                                                                         | Role                                                                                                           |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [`packages/protocol/schema/v1.json`](../../packages/protocol/schema/v1.json)                     | JSON Schema of every request, response and realtime message (generated from the zod schemas)                   |
| [`packages/protocol/vectors/identity-v1.json`](../../packages/protocol/vectors/identity-v1.json) | Cross-language test vectors for identity keys, fingerprints, verification words, safety numbers and signatures |

Both files are checked by tests (`schema-freeze.test.ts`, `vectors.test.ts`).
A change that alters either file fails CI until it is made deliberately.

## Rules

1. **Additive only within v1.** New optional fields, new endpoints and new
   realtime event types are allowed. Clients must ignore fields and event types
   they do not know; servers must ignore unknown optional request fields.
2. **Never changed within v1:** the meaning, type or requiredness of an existing
   field, an endpoint's path or method, an error code's meaning, any value in
   the test vectors, any cryptographic construction.
3. **Breaking change = protocol v2.** `PROTOCOL_VERSION` is bumped, the old
   version stays in `MIN_PROTOCOL_VERSION` until clients have migrated, and
   `GET /v1/version` advertises both so old and new clients keep working.
4. **Regenerating the schema** (`node packages/protocol/scripts/export-schemas.ts`)
   is allowed only for additive changes, and the diff must be reviewed as a
   wire change. The vectors are regenerated only for a new major version
   (`generate-vectors.ts` refuses to overwrite without `--force`).

## For other-language clients

A client in Swift or Kotlin is conformant when it:

- validates messages against `schema/v1.json`;
- reproduces every value in `identity-v1.json`: public key from private key,
  fingerprint (SHA-256 of the 33-byte public key, truncated to 16 bytes),
  Bytewords verification words, the 60-digit safety number from either side
  (libsignal numeric fingerprint, 5200 iterations, version 2), and the scannable
  form from each side;
- accepts the frozen XEdDSA signature and rejects any altered message or
  signature.

The keys in the vectors are test-only and must never be used for real accounts.
