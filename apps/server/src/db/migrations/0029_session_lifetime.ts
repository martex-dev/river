import { sql, type Kysely } from 'kysely';

/**
 * Security audit (2.20): a session kept in use was renewed forever. Each session now has an
 * absolute end (`not_after`, set at sign-in from RIVER_SESSION_MAX_DAYS): renewing never moves
 * its expiry past it, and after it the device signs in again with its device key. Sessions that
 * exist when the server is updated end 90 days after the update.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('sessions').addColumn('not_after', 'varchar(32)').execute();
  const end = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  await sql`UPDATE sessions SET not_after = ${end} WHERE not_after IS NULL`.execute(db);
}
