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
  })
  .strict();
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

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

/** Parses device-list bytes (call only after the signature has been verified). */
export function parseDeviceList(bytes: Uint8Array): DeviceList {
  if (bytes.length > MAX_DEVICE_LIST_BYTES) throw new Error('device list too large');
  return deviceListSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
}
