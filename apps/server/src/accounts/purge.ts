import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.ts';
import type { Hub } from '../communities/hub.ts';
import type { CommunityOps } from '../routes/communities.ts';

/** WebSocket close code for "your account was suspended or removed". */
export const CLOSE_SUSPENDED = 4403;

/**
 * Removes an account from the server: it leaves every community (communities
 * it owns are deleted), and its keys, devices, sessions, reactions, bans,
 * blocks and undelivered mail go. Messages it already sent stay in their
 * channels as they are (ciphertext), like a departed member's.
 */
export async function purgeAccount(
  db: Kysely<Database>,
  hub: Hub,
  ops: CommunityOps,
  id: string,
): Promise<void> {
  hub.disconnect(id, CLOSE_SUSPENDED);
  await ops.removeEverywhere(id);
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('prekeys').where('river_id', '=', id).execute();
    await trx.deleteFrom('signed_prekeys').where('river_id', '=', id).execute();
    await trx.deleteFrom('kyber_prekeys').where('river_id', '=', id).execute();
    await trx.deleteFrom('message_reactions').where('river_id', '=', id).execute();
    await trx.deleteFrom('community_event_rsvps').where('river_id', '=', id).execute();
    await trx.deleteFrom('bans').where('river_id', '=', id).execute();
    await trx
      .deleteFrom('blocks')
      .where((eb) => eb.or([eb('river_id', '=', id), eb('blocked', '=', id)]))
      .execute();
    await trx.deleteFrom('mailbox').where('recipient', '=', id).execute();
    // Devices and sessions go with the account (foreign keys).
    await trx.deleteFrom('accounts').where('river_id', '=', id).execute();
  });
}
