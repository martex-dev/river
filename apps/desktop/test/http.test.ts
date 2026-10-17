import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError, NetworkError, createRequestBytes, createRequestJson } from '../src/main/http.ts';

const answer =
  (res: () => Response): typeof fetch =>
  async () =>
    res();

/** A body that sends a few bytes, then the connection drops. */
const brokenBody = (): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"ok":'));
      controller.error(new TypeError('terminated'));
    },
  });

describe('requestJson', () => {
  const schema = z.object({ ok: z.boolean() });

  it('treats a tunnel or proxy saying the server is down as unreachable, not as a refusal', async () => {
    // Tailscale Funnel / a reverse proxy while the PC's server restarts, Cloudflare's 530 page.
    for (const [status, body] of [
      [502, 'Bad Gateway'],
      [503, '<html>Service Unavailable</html>'],
      [504, ''],
      [530, '<!doctype html>error code: 1033'],
      // Fastify's own answer while the server is closing (return503OnClosing): not a River error.
      [503, '{"statusCode":503,"error":"Service Unavailable","message":"Service Unavailable"}'],
    ] as const) {
      const request = createRequestJson(answer(() => new Response(body, { status })));
      await expect(request('https://river.example/v1/x', { method: 'GET' }, schema)).rejects.toBeInstanceOf(
        NetworkError,
      );
    }
  });

  it('keeps a River server’s own errors, 5xx included', async () => {
    const busy = createRequestJson(
      answer(() => Response.json({ error: { code: 'busy', message: 'Too many devices' } }, { status: 503 })),
    );
    await expect(busy('https://river.example/v1/x', { method: 'GET' }, schema)).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      code: 'busy',
    });
    const internal = createRequestJson(
      answer(() =>
        Response.json({ error: { code: 'internal', message: 'Internal server error' } }, { status: 500 }),
      ),
    );
    await expect(internal('https://river.example/v1/x', { method: 'GET' }, schema)).rejects.toBeInstanceOf(
      ApiError,
    );
    const garbled = createRequestJson(answer(() => new Response('<html>', { status: 200 })));
    await expect(garbled('https://river.example/v1/x', { method: 'GET' }, schema)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('reports a connection that drops while the answer is read as a network failure', async () => {
    const request = createRequestJson(answer(() => new Response(brokenBody(), { status: 200 })));
    await expect(request('https://river.example/v1/x', { method: 'GET' }, schema)).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});

describe('requestBytes', () => {
  it('reports a download that breaks off, and a gateway error, as network failures', async () => {
    const broken = createRequestBytes(answer(() => new Response(brokenBody(), { status: 200 })));
    await expect(
      broken('https://river.example/v1/attachments/a', { method: 'GET', maxBytes: 1024 }),
    ).rejects.toBeInstanceOf(NetworkError);
    const gateway = createRequestBytes(answer(() => new Response('Bad Gateway', { status: 502 })));
    await expect(
      gateway('https://river.example/v1/attachments/a', { method: 'GET', maxBytes: 1024 }),
    ).rejects.toBeInstanceOf(NetworkError);
    const gone = createRequestBytes(
      answer(() => Response.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 })),
    );
    await expect(
      gone('https://river.example/v1/attachments/a', { method: 'GET', maxBytes: 1024 }),
    ).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });
});
