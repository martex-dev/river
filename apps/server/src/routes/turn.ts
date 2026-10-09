import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { API_PREFIX } from '@river/protocol';
import { authenticate } from '../accounts/auth-store.ts';
import type { ServerConfig } from '../config.ts';
import type { RiverDatabase } from '../db/database.ts';

const TTL_SECONDS = 6 * 60 * 60;

/**
 * Short-lived TURN credentials for calls, in coturn's "TURN REST API" format
 * (use-auth-secret): username = "<expiry>:<riverId>", password =
 * base64(HMAC-SHA1(secret, username)). Relays only see encrypted media.
 */
export function registerTurnRoutes(
  app: FastifyInstance,
  deps: { config: ServerConfig; database: RiverDatabase; now: () => Date },
): void {
  const requireSession = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = token ? await authenticate(deps.database.db, token, deps.now()) : null;
    if (!session) {
      await reply.code(401).send({ error: { code: 'unauthorized', message: 'A valid session is required' } });
      return;
    }
    request.session = session;
  };

  app.get(`${API_PREFIX}/turn`, { preHandler: requireSession }, async (request) => {
    const turn = deps.config.turn;
    if (!turn || !turn.urls.length) return { iceServers: [], ttl: 0 };
    const expiry = Math.floor(deps.now().getTime() / 1000) + TTL_SECONDS;
    const username = `${expiry}:${request.session!.riverId}`;
    const credential = createHmac('sha1', turn.secret).update(username).digest('base64');
    return { iceServers: [{ urls: turn.urls, username, credential }], ttl: TTL_SECONDS };
  });
}
