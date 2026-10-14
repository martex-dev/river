import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exportSchemas } from '../scripts/schemas.ts';

describe('protocol v1 schema freeze', () => {
  it('matches the committed schema/v1.json exactly', async () => {
    const frozen = JSON.parse(readFileSync(new URL('../schema/v1.json', import.meta.url), 'utf8'));
    const current = JSON.parse(JSON.stringify(await exportSchemas()));
    // A wire change must be additive and documented in docs/protocol/stability.md;
    // then regenerate with `node packages/protocol/scripts/export-schemas.ts`.
    expect(current).toEqual(frozen);
  });

  it('covers every protocol area', async () => {
    const names = Object.keys(await exportSchemas());
    expect(names.length).toBeGreaterThan(40);
    expect(names).toContain('versionResponseSchema');
    expect(names).toContain('errorResponseSchema');
  });
});
