import type { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { buildApp, SERVER_VERSION } from './app.ts';
import type { ServerConfig } from './config.ts';
import { migrateToLatest, openDatabase } from './db/database.ts';

export { loadConfig, ConfigError, type ServerConfig } from './config.ts';
export { SERVER_VERSION };

export interface RunningServer {
  app: FastifyInstance;
  /** The port it listens on (useful when the config asked for port 0). */
  port: number;
  /** SQLite only: a consistent copy of the live database (see RiverDatabase.backup). */
  backup?(path: string): Promise<void>;
  /** Stops accepting requests, finishes open ones and closes the database. */
  close(): Promise<void>;
}

/**
 * Opens the database, applies migrations and starts listening. Used by the
 * standalone server (main.ts) and by the River app when it hosts communities
 * on the user's own PC.
 */
export async function startServer(
  config: ServerConfig,
  options: { logStream?: Writable } = {},
): Promise<RunningServer> {
  const database = openDatabase(config.databaseUrl);
  const migrated = await migrateToLatest(database.db);
  const app = await buildApp({
    config,
    database,
    ...(options.logStream ? { logStream: options.logStream } : {}),
  });
  const applied = migrated.results?.filter((r) => r.status === 'Success').map((r) => r.migrationName) ?? [];
  app.log.info(
    { version: SERVER_VERSION, dialect: database.dialect, migrationsApplied: applied },
    'River server starting',
  );
  await app.listen({ host: config.host, port: config.port });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  let closed = false;
  return {
    app,
    port,
    ...(database.backup ? { backup: database.backup } : {}),
    close: async () => {
      if (closed) return;
      closed = true;
      await app.close();
      await database.close();
    },
  };
}
