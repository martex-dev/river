import rateLimit from '@fastify/rate-limit';
import type { Writable } from 'node:stream';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { API_PREFIX, MIN_PROTOCOL_VERSION, PROTOCOL_VERSION, type ErrorResponse } from '@river/protocol';
import type { ServerConfig } from './config.ts';
import type { RiverDatabase } from './db/database.ts';
import { registerAccountRoutes } from './routes/accounts.ts';
import { HttpError } from './http-error.ts';
import { registerCommunityRoutes } from './routes/communities.ts';
import serverPackage from '../package.json' with { type: 'json' };

export const SERVER_VERSION: string = serverPackage.version;

export interface AppDeps {
  config: ServerConfig;
  database: RiverDatabase;
  /** Log destination (default stdout). Tests capture it to prove no IPs or identifiers are written. */
  logStream?: Writable;
  /** Clock (tests). */
  now?: () => Date;
}

function errorBody(code: string, message: string): ErrorResponse {
  return { error: { code, message } };
}

/**
 * Builds the River HTTP application. Privacy rules enforced here:
 * - request logs contain method, route template, status and duration only —
 *   never IP addresses, headers, query strings, bodies or identifiers;
 * - error responses never include stack traces or internal messages.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: {
      level: config.logLevel,
      base: null,
      ...(deps.logStream ? { stream: deps.logStream } : {}),
      serializers: {
        req: () => ({}),
        res: () => ({}),
      },
      redact: { paths: ['req', 'res', 'headers', '*.headers', '*.authorization', '*.cookie'], remove: true },
    },
    // Fastify's built-in request logs include URLs and client IPs; River logs its own minimal line instead.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 256 * 1024,
    trustProxy: config.trustProxy,
    return503OnClosing: true,
  });

  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
    // Counters live in memory only and expire with the window.
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: ctx.statusCode,
      ...errorBody('rate_limited', 'Too many requests. Try again shortly.'),
    }),
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    if (!reply.hasHeader('content-security-policy')) {
      reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    }
    reply.header('cache-control', 'no-store');
    reply.header('x-river-protocol', String(PROTOCOL_VERSION));
    if (config.publicUrl) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    reply.removeHeader('x-powered-by');
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url ?? 'unmatched',
        status: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
      },
      'request',
    );
  });

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send(errorBody('not_found', 'Not found'));
  });

  app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, request, reply) => {
    if (error instanceof HttpError) {
      void reply.code(error.status).send(errorBody(error.code, error.message));
      return;
    }
    const status = error.statusCode ?? 500;
    if (status === 429) {
      void reply.code(429).send(errorBody('rate_limited', 'Too many requests. Try again shortly.'));
      return;
    }
    if (status >= 500) {
      request.log.error({ err: { type: error.name, message: error.message } }, 'request failed');
      void reply.code(500).send(errorBody('internal', 'Internal server error'));
      return;
    }
    const code = error.validation ? 'bad_request' : status === 413 ? 'payload_too_large' : 'bad_request';
    void reply.code(status).send(errorBody(code, status === 413 ? 'Request body too large' : 'Bad request'));
  });

  app.get(`${API_PREFIX}/health`, async () => ({ status: 'ok' as const }));

  app.get(`${API_PREFIX}/version`, async () => ({
    product: 'river-server' as const,
    version: SERVER_VERSION,
    protocol: { current: PROTOCOL_VERSION, min: MIN_PROTOCOL_VERSION },
  }));

  const now = deps.now ?? (() => new Date());
  registerAccountRoutes(app, { config, database: deps.database, now });
  await registerCommunityRoutes(app, { config, database: deps.database, now });

  return app;
}
