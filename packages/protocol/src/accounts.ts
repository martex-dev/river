import { z } from 'zod';

/**
 * Accounts and device authentication (protocol v1).
 *
 * Every signature covers `context || payload` with a distinct ASCII context, so
 * a signature made for one purpose can never be replayed for another. Signed
 * structures (the device list) are transmitted as the exact signed bytes
 * (base64) and parsed only after verification — no JSON canonicalisation.
 */
export const SIGNING_CONTEXT = {
  register: 'river-register-v1\n',
  session: 'river-session-v1\n',
  deviceList: 'river-device-list-v1\n',
  /** Proof for deleting your own account (1.0.18): a fresh challenge signed by a device key. */
  deleteAccount: 'river-delete-account-v1\n',
} as const;

export const CHALLENGE_BYTES = 32;
export const MAX_DEVICES = 10;
export const MAX_DEVICE_LIST_BYTES = 8 * 1024;

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Standard base64 that decodes to exactly `n` bytes (or any length when n is undefined). */
export function base64Bytes(n?: number, max = 64 * 1024) {
  return z
    .string()
    .max(Math.ceil((max * 4) / 3) + 4)
    .regex(B64, 'must be base64')
    .refine(
      (s) => {
        const len = Buffer.from(s, 'base64').length;
        return (
          Buffer.from(s, 'base64').toString('base64') === s &&
          (n === undefined ? len > 0 && len <= max : len === n)
        );
      },
      n === undefined ? 'invalid base64' : `must encode ${n} bytes`,
    );
}

/** libsignal-serialised Curve25519 public key: 33 bytes, type byte 0x05. */
export const publicKeySchema = base64Bytes(33).refine(
  (s) => Buffer.from(s, 'base64')[0] === 0x05,
  'not a key',
);
export const signatureSchema = base64Bytes(64);
export const challengeSchema = base64Bytes(CHALLENGE_BYTES);
export const riverIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'must be a lowercase UUIDv4',
  );
export const deviceIdSchema = z.number().int().min(1).max(64);
export const registrationIdSchema = z.number().int().min(1).max(0x3fff);

// ---- Device list (the signed structure) -------------------------------------------------------

export const deviceListSchema = z
  .object({
    version: z
      .number()
      .int()
      .min(1)
      .max(2 ** 31),
    riverId: riverIdSchema,
    devices: z
      .array(
        z.object({
          deviceId: deviceIdSchema,
          authKey: publicKeySchema,
          registrationId: registrationIdSchema,
          addedAt: z.iso.datetime(),
        }),
      )
      .min(1)
      .max(MAX_DEVICES),
  })
  .strict()
  .refine((l) => new Set(l.devices.map((d) => d.deviceId)).size === l.devices.length, 'duplicate device IDs');
export type DeviceList = z.infer<typeof deviceListSchema>;

// ---- Requests / responses -------------------------------------------------------------------

export const challengeRequestSchema = z.object({ purpose: z.enum(['register', 'session']) }).strict();
export const challengeResponseSchema = z.object({ challenge: challengeSchema, expiresAt: z.iso.datetime() });
export type ChallengeResponse = z.infer<typeof challengeResponseSchema>;

export const registerRequestSchema = z
  .object({
    identityKey: publicKeySchema,
    deviceId: deviceIdSchema,
    /** base64 of the exact device-list bytes that `deviceListSignature` covers. */
    deviceList: base64Bytes(undefined, MAX_DEVICE_LIST_BYTES),
    /** Identity key over SIGNING_CONTEXT.deviceList || deviceList bytes. */
    deviceListSignature: signatureSchema,
    challenge: challengeSchema,
    /** Identity key over SIGNING_CONTEXT.register || challenge || deviceList bytes. */
    identitySignature: signatureSchema,
    /** The new device's auth key over the same message (proof of possession). */
    deviceSignature: signatureSchema,
    /** A one-time sign-up code from the server's operator (1.0.13); it comes with a username. */
    signupCode: z
      .string()
      .regex(/^[A-Za-z0-9_-]{22}$/)
      .optional(),
  })
  .strict();
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/**
 * A username: what people find each other by (1.0.13). 3–32 characters, lowercase letters,
 * digits, "_" and "." (not first or last). Usernames are public on their server, like on
 * Discord; display names stay end-to-end encrypted.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_][a-z0-9_.]{1,30}[a-z0-9_]$/, 'Use 3–32 letters, numbers, "_" or "."');

export const setUsernameRequestSchema = z.object({ username: usernameSchema }).strict();
export const usernameResponseSchema = z.object({ username: z.string(), riverId: riverIdSchema });
export const usernamesRequestSchema = z.object({ riverIds: z.array(riverIdSchema).max(500) }).strict();
export const usernamesResponseSchema = z.object({ usernames: z.record(z.string(), z.string()) });

export const sessionResponseSchema = z.object({
  token: z.string().min(40).max(64),
  expiresAt: z.iso.datetime(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const registerResponseSchema = z.object({
  riverId: riverIdSchema,
  deviceId: deviceIdSchema,
  session: sessionResponseSchema,
});
export type RegisterResponse = z.infer<typeof registerResponseSchema>;

// ---- Linked devices (1.3, capability "linked-devices") ---------------------------------------

/**
 * `PUT /v1/accounts/me/devices`: a new device list signed by the identity key. Its `version`
 * must be higher than the stored one; the calling device must stay in it with the same auth key,
 * and devices already listed keep their auth keys.
 */
export const updateDevicesRequestSchema = z
  .object({
    deviceList: base64Bytes(undefined, MAX_DEVICE_LIST_BYTES),
    deviceListSignature: signatureSchema,
  })
  .strict();
export type UpdateDevicesRequest = z.infer<typeof updateDevicesRequestSchema>;

export const MAX_LINK_PROVISION_BYTES = 256 * 1024;
/** A link mailbox: derived from the link secret, so only the two devices know it. */
export const linkIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
/** HMAC-SHA256 under the link secret, base64url. */
export const linkMacSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/**
 * What a device that wants to be linked tells the device that links it (all public). It is
 * authenticated with the link secret from the code the person entered (`mac`), so the server
 * cannot swap in a device of its own.
 */
export const linkHelloSchema = z
  .object({
    /** The new device's authentication key. */
    authKey: publicKeySchema,
    registrationId: registrationIdSchema,
    /** libsignal public key the provisioning message is sealed to (HPKE). */
    linkKey: publicKeySchema,
    /** A name for the device, shown when approving ("Pixel 9", "Windows PC"). */
    deviceName: z.string().trim().min(1).max(64),
  })
  .strict();
export type LinkHello = z.infer<typeof linkHelloSchema>;

/** `PUT /v1/link/:id` (no account needed, once): the new device posts its hello. */
export const putLinkHelloRequestSchema = z.object({ hello: linkHelloSchema, mac: linkMacSchema }).strict();

/** `GET /v1/link/:id`: what the mailbox holds so far. */
/** How many declines the server keeps for one link (a bogus one cannot pre-empt the real one). */
export const MAX_LINK_DECLINES = 3;

export const linkStateResponseSchema = z.object({
  hello: linkHelloSchema.nullable(),
  mac: linkMacSchema.nullable(),
  /** base64 of libsignal HPKE ciphertext, or null while waiting. */
  provision: z
    .string()
    .max(Math.ceil(MAX_LINK_PROVISION_BYTES / 3) * 4 + 4)
    .nullable(),
  /** The device ID the new device was given, once linked. */
  deviceId: deviceIdSchema.nullable(),
  /**
   * The new device did not take the account ("Is this you?" → Cancel): HMAC under the link
   * secret, so the linked device knows it really came from the new device and takes it off the
   * device list again. Older servers never set it.
   */
  declined: linkMacSchema.nullable().optional(),
  /**
   * Every decline written so far (2.11.2), at most MAX_LINK_DECLINES: the server cannot check a
   * MAC, so a bogus one written first must not shut out the new device's real one. `declined` is
   * the first of them, for older apps. Older servers never set it.
   */
  declines: z.array(linkMacSchema).max(MAX_LINK_DECLINES).optional(),
  expiresAt: z.iso.datetime(),
});
export type LinkState = z.infer<typeof linkStateResponseSchema>;

/** `PUT /v1/link/:id/decline` (no account needed, once, after provisioning): the new device said no. */
export const declineLinkRequestSchema = z.object({ mac: linkMacSchema }).strict();

/** `PUT /v1/link/:id/provision` (signed in, on the account the device was added to). */
export const provisionLinkRequestSchema = z
  .object({
    deviceId: deviceIdSchema,
    provision: base64Bytes(undefined, MAX_LINK_PROVISION_BYTES),
  })
  .strict();

export const sessionRequestSchema = z
  .object({
    riverId: riverIdSchema,
    deviceId: deviceIdSchema,
    challenge: challengeSchema,
    /** Device auth key over SIGNING_CONTEXT.session || challenge || "<riverId>:<deviceId>". */
    signature: signatureSchema,
  })
  .strict();
export type SessionRequest = z.infer<typeof sessionRequestSchema>;

export const accountResponseSchema = z.object({
  riverId: riverIdSchema,
  identityKey: publicKeySchema,
  deviceList: base64Bytes(undefined, MAX_DEVICE_LIST_BYTES),
  deviceListSignature: signatureSchema,
  /** 1.0.13; absent until one is chosen (and on older servers). */
  username: z.string().nullable().optional(),
});
export type AccountResponse = z.infer<typeof accountResponseSchema>;

// ---- Signed message construction (shared by every client and the server) ---------------------

const utf8 = (s: string): Buffer => Buffer.from(s, 'utf8');

export function deviceListMessage(deviceListBytes: Uint8Array): Uint8Array {
  return Buffer.concat([utf8(SIGNING_CONTEXT.deviceList), deviceListBytes]);
}

export function registrationMessage(challenge: Uint8Array, deviceListBytes: Uint8Array): Uint8Array {
  if (challenge.length !== CHALLENGE_BYTES) throw new Error('bad challenge');
  return Buffer.concat([utf8(SIGNING_CONTEXT.register), challenge, deviceListBytes]);
}

export function sessionMessage(challenge: Uint8Array, riverId: string, deviceId: number): Uint8Array {
  if (challenge.length !== CHALLENGE_BYTES) throw new Error('bad challenge');
  return Buffer.concat([utf8(SIGNING_CONTEXT.session), challenge, utf8(`${riverId}:${deviceId}`)]);
}

export function deleteAccountMessage(challenge: Uint8Array, riverId: string, deviceId: number): Uint8Array {
  if (challenge.length !== CHALLENGE_BYTES) throw new Error('bad challenge');
  return Buffer.concat([utf8(SIGNING_CONTEXT.deleteAccount), challenge, utf8(`${riverId}:${deviceId}`)]);
}

export const deleteAccountRequestSchema = z
  .object({
    challenge: challengeSchema,
    deviceId: z.number().int().min(1).max(1000),
    signature: base64Bytes(64),
  })
  .strict();

/** Parses device-list bytes (call only after the signature has been verified). */
export function parseDeviceList(bytes: Uint8Array): DeviceList {
  if (bytes.length > MAX_DEVICE_LIST_BYTES) throw new Error('device list too large');
  return deviceListSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
}
