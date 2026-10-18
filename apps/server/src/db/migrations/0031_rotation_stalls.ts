import type { Kysely } from 'kysely';

/**
 * Security audit (2.20): a member could stall key rotation by claiming each new epoch and never
 * handing out its key, until the server stopped asking after three retries. The members whose
 * claim ran out without anyone receiving the key (a JSON list of River IDs) now stand aside until
 * a rotation succeeds, so another member rotates, and a stuck claim always expires (later each
 * time) instead of holding the community on a key nobody has.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('communities')
    .addColumn('rotation_stalled', 'text', (c) => c.notNull().defaultTo('[]'))
    .execute();
}
