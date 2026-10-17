import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.ts';
import type { Hub } from '../communities/hub.ts';
import type { CommunityOps } from '../routes/communities.ts';
import { USERNAME_HOLD_MS } from './usernames.ts';

/** WebSocket close code for "your account was suspended or removed". */
export const CLOSE_SUSPENDED = 4403;

/**
 * Removes an account from the server: it leaves every community (communities
 * it owns are deleted), and its keys, devices, sessions, reactions, bans,
 * blocks and undelivered mail go. Messages it already sent stay in their
 * channels as they are (ciphertext), like a departed member's. What stays is a
 * tombstone (River ID and identity key: the ID returns only with that key) and
 * a 30-day hold on the username.
 */
export async function purgeAccount(
  db: Kysely<Database>,
  hub: Hub,
  ops: CommunityOps,
  id: string,
): Promise<void> {
  hub.disconnect(id, CLOSE_SUSPENDED);
  await ops.removeEverywhere(id);
  const account = await db
    .selectFrom('accounts')
    .select(['identity_key', 'username'])
    .where('river_id', '=', id)
    .executeTakeFirst();
  const now = new Date();
  await db.transaction().execute(async (trx) => {
    if (account) {
      // The River ID can come back only with this identity key (same person, e.g. after the
      // operator removed the account); its username stays theirs to take back for a while.
      await trx
        .insertInto('account_tombstones')
        .values({
          river_id: id,
          identity_key: account.identity_key,
          deleted_on: now.toISOString().slice(0, 10),
        })
        .onConflict((oc) => oc.column('river_id').doUpdateSet({ identity_key: account.identity_key }))
        .execute();
      if (account.username) {
        const until = new Date(now.getTime() + USERNAME_HOLD_MS).toISOString();
        await trx
          .insertInto('username_holds')
          .values({ username: account.username, river_id: id, until })
          .onConflict((oc) => oc.column('username').doUpdateSet({ river_id: id, until }))
          .execute();
      }
    }
    await trx.deleteFrom('prekeys').where('river_id', '=', id).execute();
    await trx.deleteFrom('signed_prekeys').where('river_id', '=', id).execute();
    await trx.deleteFrom('kyber_prekeys').where('river_id', '=', id).execute();
    await trx.deleteFrom('message_reactions').where('river_id', '=', id).execute();
    await trx.deleteFrom('community_event_rsvps').where('river_id', '=', id).execute();
    await trx.deleteFrom('community_reports').where('reporter', '=', id).execute();
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
