import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig, startServer } from '../src/embedded.ts';

const dir = mkdtempSync(join(tmpdir(), 'river-embedded-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('startServer', () => {
  it('listens on a free port, answers, backs up and closes', async () => {
    const config = loadConfig({
      RIVER_PORT: '0',
      RIVER_LOG_LEVEL: 'silent',
      RIVER_DATABASE_URL: `sqlite:${join(dir, 'river.sqlite')}`,
      RIVER_ATTACHMENT_DIR: join(dir, 'attachments'),
    });
    const server = await startServer(config);
    try {
      expect(server.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${server.port}/v1/health`);
      expect(await res.json()).toEqual({ status: 'ok' });
      await server.backup!(join(dir, 'backup.sqlite'));
    } finally {
      await server.close();
      await server.close(); // closing twice is harmless
    }
    await expect(fetch(`http://127.0.0.1:${server.port}/v1/health`)).rejects.toThrow();
  });

  it('lets go of its database and timers when the port is taken, so the caller can try another', async () => {
    const env = { RIVER_LOG_LEVEL: 'silent', RIVER_ATTACHMENT_DIR: join(dir, 'attachments-busy') };
    const first = await startServer(
      loadConfig({ ...env, RIVER_PORT: '0', RIVER_DATABASE_URL: `sqlite:${join(dir, 'first.sqlite')}` }),
    );
    const timers = (): number => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    const before = timers();
    try {
      const busy = join(dir, 'busy.sqlite');
      await expect(
        startServer(
          loadConfig({ ...env, RIVER_PORT: String(first.port), RIVER_DATABASE_URL: `sqlite:${busy}` }),
        ),
      ).rejects.toMatchObject({ code: 'EADDRINUSE' });
      // No garbage-collection or pruning timers left behind by the server that never started.
      expect(timers()).toBeLessThanOrEqual(before);
      // The database file is closed: it can be removed at once (an open handle blocks this on Windows).
      for (const f of [busy, `${busy}-wal`, `${busy}-shm`]) rmSync(f, { force: true });
    } finally {
      await first.close();
    }
  });
});
