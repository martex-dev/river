import { buildApp, SERVER_VERSION } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';
import { migrateToLatest, openDatabase } from './db/database.ts';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }

  const database = openDatabase(config.databaseUrl);
  const migrated = await migrateToLatest(database.db);
  const app = await buildApp({ config, database });
  const applied = migrated.results?.filter((r) => r.status === 'Success').map((r) => r.migrationName) ?? [];
  app.log.info(
    { version: SERVER_VERSION, dialect: database.dialect, migrationsApplied: applied },
    'River server starting',
  );

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await database.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err: unknown) => {
  console.error('River server failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
