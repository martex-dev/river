import type { Kysely } from 'kysely';

/**
 * 1.0.29: a community's picture and banner, sealed with the community key
 * ({ icon, banner } as small image data URLs). The server sees only the size.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('communities').addColumn('art', 'text').execute();
}
