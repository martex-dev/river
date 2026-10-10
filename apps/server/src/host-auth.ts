import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { HttpError } from './http-error.ts';

/** A request that arrived straight from this machine, not through the tunnel or a proxy. */
export function fromThisMachine(request: FastifyRequest): boolean {
  const remote = request.socket.remoteAddress ?? '';
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const proxied = ['x-forwarded-for', 'cf-connecting-ip', 'forwarded', 'x-real-ip'].some(
    (h) => request.headers[h] !== undefined,
  );
  return loopback && !proxied;
}

export function sameSecret(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Only the program hosting this server (River on the operator's PC, or River
 * Host) may use operator endpoints: from this machine, never through the
 * tunnel, with the secret it started the server with. Anything else sees 404.
 */
export function requireHost(request: FastifyRequest, hostToken: string): void {
  if (!fromThisMachine(request)) throw new HttpError(404, 'not_found', 'Not found');
  const auth = request.headers.authorization?.replace(/^Bearer /, '');
  if (!sameSecret(auth, hostToken)) throw new HttpError(401, 'unauthorized', 'Wrong host token');
}
