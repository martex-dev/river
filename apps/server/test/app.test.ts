import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { errorResponseSchema, healthResponseSchema, versionResponseSchema } from '@river/protocol';
import { buildApp, SERVER_VERSION } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../src/db/database.ts';

const testBlobDir = (): string => join(tmpdir(), `river-blobs-${Math.random().toString(36).slice(2)}`);

let app: FastifyInstance | undefined;
let database: RiverDatabase | undefined;

async function start(env: Record<string, string> = {}): Promise<{ app: FastifyInstance; logs: string[] }> {
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      logs.push(chunk.toString());
      cb();
    },
  });
  database = openDatabase('sqlite::memory:');
  await migrateToLatest(database.db);
  const config = loadConfig({ RIVER_ATTACHMENT_DIR: testBlobDir(), RIVER_LOG_LEVEL: 'info', ...env });
  app = await buildApp({ config, database, logStream: stream });
  return { app, logs };
}

afterEach(async () => {
  await app?.close();
  await database?.close();
  app = undefined;
  database = undefined;
});

describe('River server HTTP API', () => {
  it('GET /v1/health', async () => {
    const { app } = await start();
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(healthResponseSchema.parse(res.json())).toEqual({ status: 'ok' });
  });

  it('GET /v1/version reports server and protocol versions', async () => {
    const { app } = await start();
    const res = await app.inject({ method: 'GET', url: '/v1/version' });
    const body = versionResponseSchema.parse(res.json());
    expect(body.version).toBe(SERVER_VERSION);
    expect(body.protocol.current).toBeGreaterThanOrEqual(body.protocol.min);
    expect(res.headers['x-river-protocol']).toBe(String(body.protocol.current));
  });

  it('sends security headers and never caches', async () => {
    const { app } = await start();
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('enables HSTS when a public https URL is configured', async () => {
    const { app } = await start({ RIVER_PUBLIC_URL: 'https://river.example.org' });
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['strict-transport-security']).toContain('max-age=');
  });

  it('returns uniform JSON errors for unknown routes', async () => {
    const { app } = await start();
    const res = await app.inject({ method: 'GET', url: '/v1/does-not-exist?secret=abc' });
    expect(res.statusCode).toBe(404);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('not_found');
  });

  it('rejects oversized bodies', async () => {
    const { app } = await start();
    app.post('/v1/echo-test', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/echo-test',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ x: 'a'.repeat(300 * 1024) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('payload_too_large');
  });

  it('hides internal error details', async () => {
    const { app } = await start();
    app.get('/v1/explode-test', async () => {
      throw new Error('database password is hunter2');
    });
    const res = await app.inject({ method: 'GET', url: '/v1/explode-test' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('hunter2');
    expect(res.json()).toEqual({ error: { code: 'internal', message: 'Internal server error' } });
  });

  it('rate-limits per client', async () => {
    const { app } = await start({ RIVER_RATE_LIMIT_PER_MINUTE: '3' });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++)
      codes.push((await app.inject({ method: 'GET', url: '/v1/health' })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.json().error.code).toBe('rate_limited');
  });

  it('never writes IP addresses, query strings or headers to logs', async () => {
    const { app, logs } = await start();
    await app.inject({
      method: 'GET',
      url: '/v1/health?user=alice',
      remoteAddress: '203.0.113.77',
      headers: { authorization: 'Bearer top-secret-token', 'user-agent': 'RiverTest/1' },
    });
    await app.inject({ method: 'GET', url: '/v1/nope', remoteAddress: '203.0.113.78' });
    const all = logs.join('\n');
    expect(all).toContain('"route":"/v1/health"');
    expect(all).not.toContain('203.0.113');
    expect(all).not.toContain('alice');
    expect(all).not.toContain('top-secret-token');
    expect(all).not.toContain('RiverTest');
    expect(all).not.toContain('remoteAddress');
  });
});
