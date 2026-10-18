import { sql, type Kysely } from 'kysely';

/**
 * Security audit (2.20): mailbox caps per sender and by size. Each envelope remembers its stored
 * size, and one index answers "how much does this device hold, and how much of it from this
 * sender" without reading any envelope (an index-only scan on SQLite and PostgreSQL).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('mailbox')
    .addColumn('size', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
  await sql`UPDATE mailbox SET size = length(body)`.execute(db);
  await db.schema
    .createIndex('mailbox_usage')
    .on('mailbox')
    .columns(['recipient', 'recipient_device', 'sender', 'size'])
    .execute();
}
