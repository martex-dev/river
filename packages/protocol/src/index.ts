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

/**
 * Features of protocol v1 that a server may or may not have, in the order they shipped. Request
 * schemas are strict, so a client sends a feature's new request fields only to a server that lists
 * it here. Names are append-only: a capability is never renamed or reused for something else.
 */
export const SERVER_CAPABILITIES = [
  'attachments',
  'community-key-epochs',
  'voice-relay',
  'delete-account',
  /** 1.3: PUT /v1/accounts/me/devices and the link mailbox (docs/architecture/decisions/0006). */
  'linked-devices',
  /** 2.13: voice relay frames to everyone in a call (RELAY_FRAME_ALL) and the active-speaker cap. */
  'voice-relay-all',
  /**
   * 2.18: group calls and call links — `call.group` (a call room whose members are told who is in
   * it), `call.watch` and the `call.roster` event (packages/protocol/src/communities.ts).
   */
  'group-calls',
] as const;
export type ServerCapability = (typeof SERVER_CAPABILITIES)[number];

/** Response of `GET /v1/version`. Contains nothing about users or the deployment. */
export const versionResponseSchema = z.object({
  product: z.literal('river-server'),
  version: z.string().min(1).max(64),
  protocol: z.object({
    current: z.number().int().positive(),
    min: z.number().int().positive(),
  }),
  /** Optional features this server supports (see SERVER_CAPABILITIES). Servers before 1.1 omit it. */
  capabilities: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/))
    .max(64)
    .default([]),
});
export type VersionResponse = z.infer<typeof versionResponseSchema>;

/** True if the server advertises `capability`. Unknown capabilities of newer servers are ignored. */
export function serverSupports(
  info: Pick<VersionResponse, 'capabilities'>,
  capability: ServerCapability,
): boolean {
  return info.capabilities.includes(capability);
}

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
export * from './admin.ts';
export * from './communities.ts';
export * from './instance.ts';
export * from './messaging.ts';
export * from './permissions.ts';
export * from './relay.ts';
