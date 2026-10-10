import { z } from 'zod';

/**
 * Operator endpoints (/v1/admin/*): only the program hosting the server, on
 * the same machine, can call them. They show what the server already holds —
 * account ids, dates, counts — never names or content, which it does not have.
 */
const isoTime = z.string().max(40);
const riverId = z.string().min(1).max(64);

export const adminAccountSchema = z.object({
  riverId,
  createdOn: z.string().max(40),
  devices: z.number().int().min(0),
  communities: z.number().int().min(0),
  online: z.boolean(),
  /** Set while suspended; a ban is BANNED_UNTIL. */
  suspendedUntil: isoTime.nullable(),
  suspendReason: z.string().max(200).nullable(),
});
export type AdminAccount = z.infer<typeof adminAccountSchema>;

export const adminCommunitySchema = z.object({
  id: z.string().min(1).max(64),
  owner: riverId,
  members: z.number().int().min(0),
  channels: z.number().int().min(0),
  createdOn: z.string().max(40),
});
export type AdminCommunity = z.infer<typeof adminCommunitySchema>;

export const adminOverviewSchema = z.object({
  accounts: z.array(adminAccountSchema).max(100_000),
  communities: z.array(adminCommunitySchema).max(100_000),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const adminSuspendRequestSchema = z
  .object({
    /** ISO time the suspension ends; null bans until lifted. */
    until: z.iso.datetime().nullable(),
    reason: z.string().trim().max(200).optional(),
  })
  .strict();
export type AdminSuspendRequest = z.infer<typeof adminSuspendRequestSchema>;

/** A ban is a suspension that never runs out. */
export const BANNED_UNTIL = '9999-12-31T23:59:59.999Z';
