import { z } from 'zod';

/**
 * River protocol version. Bumped only for incompatible changes; additive
 * changes keep the number. Clients refuse servers whose supported range does
 * not include their own version, and vice versa.
 */
export const PROTOCOL_VERSION = 1;
/** Oldest protocol version this code base can still speak. */
export const MIN_PROTOCOL_VERSION = 1;

export const API_PREFIX = '/v1';

/** Response of `GET /v1/version`. Contains nothing about users or the deployment. */
export const versionResponseSchema = z.object({
  product: z.literal('river-server'),
  version: z.string().min(1).max(64),
  protocol: z.object({
    current: z.number().int().positive(),
    min: z.number().int().positive(),
  }),
});
export type VersionResponse = z.infer<typeof versionResponseSchema>;

/** Response of `GET /v1/health`. */
export const healthResponseSchema = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Uniform error body for every non-2xx response. Never contains stack traces or internals. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(64),
    message: z.string().max(500),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export type Compatibility = 'compatible' | 'client-too-old' | 'server-too-old';

/** Decides whether a client speaking `clientVersion` (supporting down to `clientMin`) can use a server. */
export function checkCompatibility(
  server: VersionResponse['protocol'],
  client: { current: number; min: number } = { current: PROTOCOL_VERSION, min: MIN_PROTOCOL_VERSION },
): Compatibility {
  if (client.current < server.min) return 'client-too-old';
  if (server.current < client.min) return 'server-too-old';
  return 'compatible';
}
export * from './accounts.ts';
export * from './communities.ts';
export * from './permissions.ts';
