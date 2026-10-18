import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrateToLatest, openDatabase } from '../src/db/database.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('metadata retention (2.13)', () => {
  it('RIVER_MAILBOX_TTL_DAYS: 30 by default, 1–90 allowed', () => {
    expect(loadConfig({}).mailboxTtlMs).toBe(30 * DAY);
    expect(loadConfig({ RIVER_MAILBOX_TTL_DAYS: '7' }).mailboxTtlMs).toBe(7 * DAY);
    expect(() => loadConfig({ RIVER_MAILBOX_TTL_DAYS: '0' })).toThrow();
    expect(() => loadConfig({ RIVER_MAILBOX_TTL_DAYS: '365' })).toThrow();
  });

  it('expired mail, sessions, holds and sign-up codes go at start and every hour', async () => {
    const database = openDatabase('sqlite::memory:');
    await migrateToLatest(database.db);
    const now = new Date('2026-10-18T12:00:00.000Z');
    const at = (msAgo: number): string => new Date(now.getTime() - msAgo).toISOString();
    const db = database.db;
    const riverId = '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e4b71';
    const envelope = (id: string, receivedAt: string) => ({
      id: id.padEnd(22, 'x'),
      recipient: riverId,
      recipient_device: 1,
      sender: riverId,
      sender_device: 1,
      type: 2,
      body: 'AAAA',
      received_at: receivedAt,
    });
    await db
      .insertInto('mailbox')
      .values([envelope('old', at(8 * DAY)), envelope('new', at(6 * DAY))])
      .execute();
    await db
      .insertInto('username_holds')
      .values([
        { username: 'gone', river_id: riverId, until: at(1000) },
        { username: 'held', river_id: riverId, until: at(-DAY) },
      ])
      .execute();
    await db
      .insertInto('signups')
      .values([
        { code_hash: 'a', username: 'x', created_at: at(8 * DAY), expires_at: at(DAY) },
        { code_hash: 'b', username: 'y', created_at: at(DAY), expires_at: at(-DAY) },
      ])
      .execute();
    await db
      .insertInto('auth_challenges')
      .values({ challenge_hash: 'c', purpose: 'login', expires_at: at(1000) })
      .execute();

    // Started: the first collection runs before the server answers anything.
    const app = await buildApp({
      config: loadConfig({
        RIVER_LOG_LEVEL: 'silent',
        RIVER_MAILBOX_TTL_DAYS: '7',
        RIVER_ATTACHMENT_DIR: join(tmpdir(), `river-retention-${Math.random().toString(36).slice(2)}`),
      }),
      database,
      now: () => now,
    });
    await app.ready();
    const ids = (await db.selectFrom('mailbox').select('id').execute()).map((r) => r.id.replace(/x+$/, ''));
    expect(ids).toEqual(['new']);
    expect(
      (await db.selectFrom('username_holds').select('username').execute()).map((r) => r.username),
    ).toEqual(['held']);
    expect((await db.selectFrom('signups').select('code_hash').execute()).map((r) => r.code_hash)).toEqual([
      'b',
    ]);
    expect(await db.selectFrom('auth_challenges').selectAll().execute()).toEqual([]);
    await app.close();
  });
});
