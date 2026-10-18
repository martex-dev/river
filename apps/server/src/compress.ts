import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';
import type { FastifyReply, FastifyRequest } from 'fastify';

const gzip = promisify(gzipCallback);

/** Smaller answers go as they are: compressing them saves little and costs a round of CPU. */
export const COMPRESS_MIN_BYTES = 8 * 1024;

/** Does the client take gzip (and not say `gzip;q=0`)? */
export function acceptsGzip(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header.join(',') : (header ?? '');
  return value.split(',').some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (name !== 'gzip' && name !== '*') return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  });
}

/**
 * Speed (2.21): large JSON answers to GET requests (the community list with its members, pages
 * of history) are gzipped for clients that ask, about 40 % smaller even though most of them is
 * ciphertext (base64 and JSON compress; the ciphertext itself does not). Only GET answers, which
 * carry no session tokens; sealed content is encrypted on the device with fresh nonces, so what
 * a client sends cannot be matched against anyone else's plaintext by the compressed size.
 */
export async function compressJson(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  if (request.method !== 'GET' || reply.statusCode !== 200) return payload;
  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
  if (reply.hasHeader('content-encoding')) return payload;
  const type = String(reply.getHeader('content-type') ?? '');
  if (!type.startsWith('application/json')) return payload;
  if (Buffer.byteLength(payload) < COMPRESS_MIN_BYTES) return payload;
  const vary = reply.getHeader('vary');
  reply.header('vary', vary ? `${String(vary)}, accept-encoding` : 'accept-encoding');
  if (!acceptsGzip(request.headers['accept-encoding'])) return payload;
  const body = await gzip(payload, { level: 5 });
  reply.header('content-encoding', 'gzip');
  reply.removeHeader('content-length');
  return body;
}
