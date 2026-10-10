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
      RIVER_LOG_LEVEL: 'silent',
      RIVER_DATABASE_URL: `sqlite:${join(dir, 'river.sqlite')}`,
      RIVER_ATTACHMENT_DIR: join(dir, 'attachments'),
    });
    const server = await startServer({ ...config, port: 0 });
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
});
