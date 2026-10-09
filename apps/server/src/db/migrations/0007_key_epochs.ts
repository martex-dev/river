import type { Kysely } from 'kysely';

/**
 * Community key epochs. When a member is removed the community key is replaced
 * (by a member's client, delivered over libsignal sessions); the server only
 * keeps a counter so exactly one rotation wins, and a flag saying one is due.
 * Invites can carry a check value sealed with the key in the link.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('communities')
    .addColumn('key_epoch', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema
    .alterTable('communities')
    .addColumn('rotation_needed', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.alterTable('invites').addColumn('check', 'text').execute();
}
