// Regenerates packages/protocol/schema/v1.json from the zod schemas.
//   node packages/protocol/scripts/export-schemas.ts
// The committed file is the frozen v1 wire contract; test/schema-freeze.test.ts fails on any drift.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportSchemas } from './schemas.ts';

const out = fileURLToPath(new URL('../schema/v1.json', import.meta.url));
writeFileSync(out, JSON.stringify(await exportSchemas(), null, 2) + '\n');
process.stdout.write(`wrote ${out}\n`);
