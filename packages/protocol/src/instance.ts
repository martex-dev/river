import { z } from 'zod';

/**
 * A server's identity and its signed address notes (see apps/server/src/routes/instance.ts).
 * Apps pin `publicKey` while connected and only follow notes it verifies.
 */
export const instanceResponseSchema = z.object({
  id: z.string().min(1).max(64),
  /** Ed25519 public key, raw 32 bytes in base64. */
  publicKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  /** Where the server announces new addresses, if it does. */
  beacon: z
    .object({
      relay: z.url({ protocol: /^https$/ }),
      topic: z.string().regex(/^river-[A-Za-z0-9_-]{24}$/),
    })
    .nullable(),
  /** The public address River Host last announced, if this server runs under River Host. */
  address: z
    .url({ protocol: /^https?$/ })
    .max(300)
    .nullable()
    .default(null),
});
export type InstanceInfo = z.infer<typeof instanceResponseSchema>;

export const instanceAddressRequestSchema = z
  .object({ url: z.url({ protocol: /^https?$/ }).max(300) })
  .strict();

/** One note on the relay: "server <id> is at <url> since <issuedAt>", signed by the server. */
export const beaconNoteSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(300),
  issuedAt: z.iso.datetime(),
  sig: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
});
export type BeaconNote = z.infer<typeof beaconNoteSchema>;

/** The exact bytes a server signs for an address note. */
export function beaconMessage(instanceId: string, url: string, issuedAt: string): Uint8Array {
  return new TextEncoder().encode(`river-beacon-v1\n${instanceId}\n${url}\n${issuedAt}`);
}
