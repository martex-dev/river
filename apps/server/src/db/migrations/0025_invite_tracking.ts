import type { Kysely } from 'kysely';

/**
 * 1.0.31: invite tracking. Invites get a public ID, who made them and when;
 * members remember which invite they joined with. Codes stay hashed.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('invites').addColumn('id', 'text').execute();
  await db.schema.alterTable('invites').addColumn('created_by', 'text').execute();
  await db.schema.alterTable('invites').addColumn('created_at', 'text').execute();
  await db.schema.alterTable('community_members').addColumn('invite_id', 'text').execute();
}
