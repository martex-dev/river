import { z } from 'zod';

/** Every exported `*Schema` of the protocol package as JSON Schema, sorted by name. */
export async function exportSchemas(): Promise<Record<string, unknown>> {
  const modules = await Promise.all([
    import('../src/index.ts'),
    import('../src/permissions.ts'),
    import('../src/admin.ts'),
    import('../src/relay.ts'),
  ]);
  const out: Record<string, unknown> = {};
  for (const mod of modules) {
    for (const [name, value] of Object.entries(mod)) {
      if (!name.endsWith('Schema') || !(value instanceof z.ZodType)) continue;
      out[name] = z.toJSONSchema(value, { unrepresentable: 'any', io: 'input' });
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
