import { z } from 'zod';
import { base64Bytes, riverIdSchema } from './accounts.ts';

/**
 * Direct messages (protocol v1): libsignal prekey distribution and an
 * offline mailbox of end-to-end encrypted envelopes.
 *
 * The server stores public prekeys and opaque ciphertext. It learns who sends
 * to whom and when (no sealed sender yet), never the content: text, receipts,
 * typing, reactions and call signalling are all inside the encrypted envelope.
 */
const keyId = z.number().int().min(1).max(0xffffff);
const ecPublicKey = base64Bytes(33, 33);
const kyberPublicKey = base64Bytes(undefined, 2000);
const signature = base64Bytes(64, 64);

export const signedPreKeySchema = z.object({ id: keyId, publicKey: ecPublicKey, signature }).strict();
export const kyberPreKeySchema = z.object({ id: keyId, publicKey: kyberPublicKey, signature }).strict();
export const oneTimePreKeySchema = z.object({ id: keyId, publicKey: ecPublicKey }).strict();

export const MAX_ONE_TIME_PREKEYS = 200;

export const preKeyUploadSchema = z
  .object({
    signedPreKey: signedPreKeySchema,
    kyberLastResort: kyberPreKeySchema,
    preKeys: z.array(oneTimePreKeySchema).max(100),
    kyberPreKeys: z.array(kyberPreKeySchema).max(100),
    /** First upload from a (re)installed device: drop every older prekey of this device. */
    replaceAll: z.boolean().optional(),
  })
  .strict();
export type PreKeyUploadWire = z.infer<typeof preKeyUploadSchema>;

export const preKeyCountSchema = z.object({ preKeys: z.number().int(), kyberPreKeys: z.number().int() });

export const deviceBundleSchema = z.object({
  deviceId: z.number().int().min(1).max(127),
  registrationId: z.number().int().min(1).max(0x3fff),
  signedPreKey: signedPreKeySchema,
  preKey: oneTimePreKeySchema.nullable(),
  kyberPreKey: kyberPreKeySchema,
});

/** Everything a sender needs to start sessions with all of a recipient's devices. */
export const keyBundleResponseSchema = z.object({
  riverId: riverIdSchema,
  identityKey: base64Bytes(33, 33),
  /** The identity-signed device list, so the sender can check the devices are genuine. */
  deviceList: z.string(),
  deviceListSignature: signature,
  devices: z.array(deviceBundleSchema),
});
export type KeyBundleResponse = z.infer<typeof keyBundleResponseSchema>;

export const MAX_ENVELOPE_BYTES = 96 * 1024;

export const outgoingEnvelopeSchema = z
  .object({
    deviceId: z.number().int().min(1).max(127),
    registrationId: z.number().int().min(1).max(0x3fff),
    /** 3 = PreKey (first message), 2 = Whisper (ratchet). */
    type: z.union([z.literal(2), z.literal(3)]),
    body: base64Bytes(undefined, MAX_ENVELOPE_BYTES),
  })
  .strict();

export const sendDirectRequestSchema = z
  .object({
    messages: z.array(outgoingEnvelopeSchema).min(1).max(20),
    /** Short-lived signals (typing) are delivered only to online devices and never stored. */
    ephemeral: z.boolean().optional(),
  })
  .strict();

export const deviceMismatchSchema = z.object({
  error: z.object({ code: z.literal('device_mismatch'), message: z.string() }),
  missing: z.array(z.number()),
  extra: z.array(z.number()),
  stale: z.array(z.number()),
});

export const envelopeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  sender: riverIdSchema,
  senderDevice: z.number().int().min(1).max(127),
  recipientDevice: z.number().int().min(1).max(127),
  type: z.union([z.literal(2), z.literal(3)]),
  body: z.string(),
  receivedAt: z.iso.datetime(),
});
export type EnvelopeWire = z.infer<typeof envelopeSchema>;

export const mailboxResponseSchema = z.object({ envelopes: z.array(envelopeSchema), more: z.boolean() });
export const ackRequestSchema = z
  .object({
    ids: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{22}$/))
      .min(1)
      .max(200),
  })
  .strict();

/** STUN/TURN servers for calls; TURN credentials are short-lived. */
export const iceServersResponseSchema = z.object({
  iceServers: z
    .array(
      z.object({
        urls: z.array(z.string().regex(/^(stun|turns?):[^\s]+$/)).max(10),
        username: z.string().max(200).optional(),
        credential: z.string().max(200).optional(),
      }),
    )
    .max(5),
  ttl: z.number().int().min(0),
});

export const blocksResponseSchema = z.object({ blocked: z.array(riverIdSchema) });
