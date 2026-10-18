# Accounts and device authentication (protocol v1)

Implemented in River 0.1.0. Schemas: [`packages/protocol/src/accounts.ts`](../../packages/protocol/src/accounts.ts).
Server: [`apps/server/src/routes/accounts.ts`](../../apps/server/src/routes/accounts.ts).
Client: [`apps/desktop/src/main/account/account-service.ts`](../../apps/desktop/src/main/account/account-service.ts).

## Keys

| Key                                                | Holder                                               | Use                                                         |
| -------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| Identity key (libsignal Curve25519)                | The account; private half only on the user's devices | Signs the device list and the registration                  |
| Device auth key (libsignal Curve25519, per device) | One device                                           | Proves possession at registration; signs session challenges |

All signatures are libsignal XEdDSA (64 bytes) over `context || payload`:

| Context                  | Signed by                           | Payload                                               |
| ------------------------ | ----------------------------------- | ----------------------------------------------------- |
| `river-device-list-v1\n` | identity key                        | exact device-list bytes                               |
| `river-register-v1\n`    | identity key **and** new device key | challenge (32 bytes) ‖ device-list bytes              |
| `river-session-v1\n`     | device key                          | challenge (32 bytes) ‖ UTF-8 `"<riverId>:<deviceId>"` |

## Device list

```json
{
  "version": 1,
  "riverId": "<uuidv4>",
  "devices": [{ "deviceId": 1, "authKey": "<b64>", "registrationId": 1234, "addedAt": "<iso>" }]
}
```

Sent and stored as the exact signed bytes (base64), never re-serialised.
Receivers verify the signature with the account's identity key **before**
parsing. Clients remember the highest version they have seen and refuse lower
versions (rollback) or lists not signed by the identity key (device injection).

## Flows

### Registration

1. `POST /v1/auth/challenge {"purpose":"register"}` → `{challenge, expiresAt}` (single use, 5 min).
2. Client creates a device key and the version-1 device list containing only this device.
3. `POST /v1/accounts` with identity key, device ID, device list + identity signature,
   the challenge, and both registration signatures.
4. Server consumes the challenge atomically, verifies all three signatures,
   requires list version 1 with exactly the named device, stores the account
   and device, and returns `201 {riverId, deviceId, session}`.

### Session

1. `POST /v1/auth/challenge {"purpose":"session"}`.
2. `POST /v1/auth/session {riverId, deviceId, challenge, signature}` → `{token, expiresAt}`.
   Unknown account/device and bad signature give the same `401` (no account enumeration).
3. Authenticated requests: `Authorization: Bearer <token>`. The server stores
   only SHA-256 of the token; default lifetime 24 h (`RIVER_SESSION_TTL_HOURS`).
   Clients keep tokens in memory only. A session kept in use (the realtime
   connection) is renewed, but never past 90 days after sign-in
   (`RIVER_SESSION_MAX_DAYS`, 2.20); then any request answers `401` and the app
   signs in again with its device key, without asking the person.
4. `DELETE /v1/sessions/current` (2.20) signs out: the bearer token's session
   ends at once, and so do realtime connections that signed in with it. Always
   `200 {ok: true}`, also for an unknown or expired token. River calls it when it
   quits. Removing a device from the signed device list ends that device's
   sessions.

### Account check

`GET /v1/accounts/me` returns the River ID, identity key and the signed device
list. The client verifies that the identity key is its own and the device list
signature is valid; otherwise it stops using the server and shows a security error.

## What the server stores

`accounts`: River ID, identity public key, device-list bytes + signature +
version, creation **day**. `devices`: device ID, device public key,
registration ID, creation day. `sessions`: token hash, device, expiry, absolute end.
`auth_challenges`: challenge hash, purpose, expiry. No IP addresses, names,
user agents or last-seen times.

## Error codes

`bad_request`, `invalid_challenge`, `bad_signature`, `account_exists`,
`registration_closed`, `unauthorized`, `rate_limited`.
