import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';

/**
 * Server-level key/value metadata (e.g. the random instance ID used later to
 * scope sealed-sender certificates). Contains nothing about users.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('server_meta')
    .addColumn('key', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('value', 'text', (c) => c.notNull())
    .execute();
  await (db as Kysely<{ server_meta: { key: string; value: string } }>)
    .insertInto('server_meta')
    .values({ key: 'instance_id', value: randomUUID() })
    .execute();
}
