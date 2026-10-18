import type { Kysely } from 'kysely';

/**
 * Speed (2.21) for big servers, on SQLite and PostgreSQL alike:
 * - Every request opens its community, which reads its channels and roles: by community, not by
 *   reading every channel and role on the server.
 * - A page of channel history (top-level messages, newest first, by time then ID) is read straight
 *   from one index, however far back it is, without sorting.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createIndex('channels_by_community')
    .on('channels')
    .columns(['community_id', 'position'])
    .execute();
  await db.schema
    .createIndex('roles_by_community')
    .on('roles')
    .columns(['community_id', 'position'])
    .execute();
  await db.schema
    .createIndex('messages_channel_page')
    .on('messages')
    .columns(['channel_id', 'thread_id', 'sent_at', 'id'])
    .execute();
}
