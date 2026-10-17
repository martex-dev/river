import rateLimit from '@fastify/rate-limit';
import type { Writable } from 'node:stream';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import {
  API_PREFIX,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  SERVER_CAPABILITIES,
  type ErrorResponse,
} from '@river/protocol';
import type { ServerConfig } from './config.ts';
import type { RiverDatabase } from './db/database.ts';
import { registerAccountRoutes } from './routes/accounts.ts';
import { HttpError } from './http-error.ts';
import { Hub } from './communities/hub.ts';
import { registerSelfRoutes } from './routes/self.ts';
import { registerAttachmentRoutes } from './routes/attachments.ts';
import { registerMessagingRoutes } from './routes/messaging.ts';
import { registerTurnRoutes } from './routes/turn.ts';
import { registerInstanceRoutes } from './routes/instance.ts';
import { registerCommunityRoutes } from './routes/communities.ts';
import { registerAdminRoutes } from './routes/admin.ts';
import { registerLandingRoutes } from './routes/landing.ts';
import serverPackage from '../package.json' with { type: 'json' };

export const SERVER_VERSION: string = serverPackage.version;

/**
 * Origins of River's own phone apps: the Android client core's WebView
 * (androidx WebViewAssetLoader) and Capacitor's app pages on Android and iOS.
 */
export const APP_ORIGINS: ReadonlySet<string> = new Set([
  'https://appassets.androidplatform.net',
  'https://localhost',
  'capacitor://localhost',
]);

export interface AppDeps {
  config: ServerConfig;
  database: RiverDatabase;
  /** Log destination (default stdout). Tests capture it to prove no IPs or identifiers are written. */
  logStream?: Writable;
  /** Clock (tests). */
  now?: () => Date;
  /** Outgoing requests to the address relay (tests). */
  fetch?: typeof fetch;
  /** How long a dropped member keeps their voice seat (tests shorten it). */
  voiceGraceMs?: number;
  /** How often an open realtime connection's session is checked again (tests shorten it). */
  sessionRecheckMs?: number;
  /** How often stuck key rotations are looked for at most (tests set 0). */
  rotationRecheckMs?: number;
  /** Bytes a realtime connection may have queued before it is closed (tests lower it). */
  maxEventBuffer?: number;
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

  // RIVER_TRUST_PROXY=true believes only a proxy on this machine (2.10.12). A proxy elsewhere (another
  // container, the Docker bridge) is no longer believed, so every client would share its address and
  // its rate limit: say so once, with what to set.
  if (config.trustProxy === 'loopback') {
    let warned = false;
    app.addHook('onRequest', async (request) => {
      if (warned || !request.headers['x-forwarded-for']) return;
      const peer = request.socket.remoteAddress ?? '';
      if (/^(127\.|::1$|::ffff:127\.)/.test(peer)) return;
      warned = true;
      app.log.warn(
        `A proxy at ${peer} forwards client addresses, but RIVER_TRUST_PROXY=true trusts only a proxy on this machine. ` +
          'Set RIVER_TRUST_PROXY to the address of that proxy or range (for example 172.18.0.0/16), or all clients share one rate limit.',
      );
    });
  }

  // River's phone apps run their client in a WebView with its own origin, so they need CORS.
  // The API authenticates with bearer tokens, never cookies: allowing these origins grants nothing
  // a script could not already do with its own token. Preflights are answered before rate limiting.
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin || !APP_ORIGINS.has(origin)) return;
    reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'origin');
    if (request.method === 'OPTIONS') {
      reply.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE');
      reply.header('access-control-allow-headers', 'authorization, content-type');
      reply.header('access-control-max-age', '600');
      // Chromium's Private Network Access: a phone reaching a River server on its own network.
      if (request.headers['access-control-request-private-network'] === 'true') {
        reply.header('access-control-allow-private-network', 'true');
      }
      await reply.code(204).send();
    }
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
    capabilities: [...SERVER_CAPABILITIES],
  }));

  const now = deps.now ?? (() => new Date());
  const hub = new Hub(deps.voiceGraceMs !== undefined ? { voiceGraceMs: deps.voiceGraceMs } : {});
  registerAccountRoutes(app, {
    config,
    database: deps.database,
    now,
    // A removed device's realtime connection ends at once, not when it next reconnects.
    onDevicesRemoved: (riverId, removed) => hub.disconnectDevices(riverId, removed),
  });
  app.addHook('onClose', async () => hub.close());
  const ops = await registerCommunityRoutes(app, {
    config,
    database: deps.database,
    now,
    hub,
    ...(deps.sessionRecheckMs !== undefined ? { sessionRecheckMs: deps.sessionRecheckMs } : {}),
    ...(deps.rotationRecheckMs !== undefined ? { rotationRecheckMs: deps.rotationRecheckMs } : {}),
    ...(deps.maxEventBuffer !== undefined ? { maxEventBuffer: deps.maxEventBuffer } : {}),
  });
  registerAdminRoutes(app, { config, database: deps.database, now, hub, ops });
  registerLandingRoutes(app);
  registerSelfRoutes(app, { database: deps.database, now, hub, ops });
  registerMessagingRoutes(app, { config, database: deps.database, now, hub });
  registerTurnRoutes(app, { config, database: deps.database, now });
  registerInstanceRoutes(app, {
    config,
    database: deps.database,
    now,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  await registerAttachmentRoutes(app, { config, database: deps.database, now });

  return app;
}
