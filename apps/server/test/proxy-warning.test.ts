import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../src/db/database.ts';

let app: FastifyInstance;
let database: RiverDatabase;
afterEach(async () => {
  await app.close();
  await database.close();
});

async function start(trust: string) {
  database = openDatabase('sqlite::memory:');
  await migrateToLatest(database.db);
  app = await buildApp({
    config: loadConfig({
      RIVER_LOG_LEVEL: 'silent',
      RIVER_TRUST_PROXY: trust,
      RIVER_ATTACHMENT_DIR: join(tmpdir(), `river-blobs-${Math.random().toString(36).slice(2)}`),
    }),
    database,
  });
  return vi.spyOn(app.log, 'warn');
}

describe('trusting a proxy', () => {
  it('warns once when a proxy on another machine forwards addresses that are not believed', async () => {
    const warn = await start('true');
    const hit = (remoteAddress: string) =>
      app.inject({
        method: 'GET',
        url: '/healthz',
        remoteAddress,
        headers: { 'x-forwarded-for': '203.0.113.7' },
      });
    await hit('127.0.0.1');
    expect(warn).not.toHaveBeenCalled();
    await hit('172.18.0.1');
    await hit('172.18.0.1');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/RIVER_TRUST_PROXY/);
  });

  it('says nothing when the proxy is named', async () => {
    const warn = await start('172.18.0.0/16');
    await app.inject({
      method: 'GET',
      url: '/healthz',
      remoteAddress: '172.18.0.1',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
