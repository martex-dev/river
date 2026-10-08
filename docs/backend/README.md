# River server

Fastify + Kysely over SQLite (single node) or PostgreSQL, forward-only
transactional migrations, Docker image. The server stores and routes
ciphertext only. Design: [ARCHITECTURE.md §5](../../ARCHITECTURE.md#5-server-architecture).

```
apps/server/src/
  main.ts             start-up, migrations, graceful shutdown
  app.ts              HTTP app: headers, rate limit, logging, errors, routes
  config.ts           RIVER_* environment variables (validated)
  db/database.ts      SQLite/PostgreSQL connection, migration runner
  db/migrations/      0001_… forward-only migrations (never edit a released one)
  db/schema.ts        Kysely table types
  cli/migrate.ts      apply migrations without starting
```

Run locally: `npm run dev -w @river/server` (SQLite in `apps/server/data/`).
Deploy: [docs/deployment/self-hosting.md](../deployment/self-hosting.md).
