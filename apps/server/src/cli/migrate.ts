// Applies pending database migrations and exits.
//   RIVER_DATABASE_URL=… node src/cli/migrate.ts
import { loadConfig } from '../config.ts';
import { migrateToLatest, openDatabase } from '../db/database.ts';

const config = loadConfig();
const database = openDatabase(config.databaseUrl);
try {
  const result = await migrateToLatest(database.db);
  const applied = result.results?.filter((r) => r.status === 'Success').map((r) => r.migrationName) ?? [];
  console.warn(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
} finally {
  await database.close();
}
