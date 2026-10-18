import { gunzipSync } from 'node:zlib';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { acceptsGzip, compressJson, COMPRESS_MIN_BYTES } from '../src/compress.ts';

const big = {
  items: Array.from({ length: 400 }, (_, i) => ({ id: `item-${i}`, body: 'c2VhbGVk'.repeat(8) })),
};
let app: FastifyInstance;

async function start(): Promise<FastifyInstance> {
  app = Fastify();
  app.addHook('onSend', compressJson);
  app.get('/big', async () => big);
  app.get('/small', async () => ({ ok: true }));
  app.post('/big', async () => big);
  app.get('/file', async (_req, reply) =>
    reply.type('application/octet-stream').send(Buffer.alloc(64 * 1024)),
  );
  return app;
}

afterEach(async () => {
  await app?.close();
});

describe('compressed answers', () => {
  it('gzips a large JSON answer to GET for a client that asks, and it reads back the same', async () => {
    await start();
    const res = await app.inject({ method: 'GET', url: '/big', headers: { 'accept-encoding': 'gzip, br' } });
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(String(res.headers.vary)).toContain('accept-encoding');
    expect(res.rawPayload.length).toBeLessThan(JSON.stringify(big).length / 2);
    expect(JSON.parse(gunzipSync(res.rawPayload).toString('utf8'))).toEqual(big);
  });

  it('leaves alone clients that do not ask, small answers, other methods and files', async () => {
    await start();
    const plain = await app.inject({ method: 'GET', url: '/big' });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.json()).toEqual(big);
    expect(JSON.stringify(big).length).toBeGreaterThan(COMPRESS_MIN_BYTES);
    for (const [method, url] of [
      ['GET', '/small'],
      ['POST', '/big'],
      ['GET', '/file'],
    ] as const) {
      const res = await app.inject({ method, url, headers: { 'accept-encoding': 'gzip' } });
      expect(res.headers['content-encoding'], `${method} ${url}`).toBeUndefined();
    }
  });

  it('reads Accept-Encoding', () => {
    expect(acceptsGzip('gzip, deflate, br')).toBe(true);
    expect(acceptsGzip('br;q=1, gzip;q=0.5')).toBe(true);
    expect(acceptsGzip('gzip;q=0')).toBe(false);
    expect(acceptsGzip('identity')).toBe(false);
    expect(acceptsGzip('*')).toBe(true);
    expect(acceptsGzip(undefined)).toBe(false);
  });
});
