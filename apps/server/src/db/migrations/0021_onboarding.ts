import type { Kysely } from 'kysely';

/**
 * 1.0.24: onboarding. `onboarding` is sealed with the community key (rules
 * and a welcome note); `screening` makes new members accept the rules before
 * they can take part; `self_roles` lists role IDs members may give
 * themselves. Existing members count as having accepted.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('communities').addColumn('onboarding', 'text').execute();
  await db.schema
    .alterTable('communities')
    .addColumn('screening', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema
    .alterTable('communities')
    .addColumn('self_roles', 'text', (c) => c.notNull().defaultTo('[]'))
    .execute();
  await db.schema
    .alterTable('community_members')
    .addColumn('accepted', 'integer', (c) => c.notNull().defaultTo(1))
    .execute();
}
