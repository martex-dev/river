import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

export const databaseUrlSchema = z
  .string()
  .min(1)
  .refine(
    (v) => v === 'sqlite::memory:' || /^sqlite:.+/.test(v) || /^postgres(ql)?:\/\/.+/.test(v),
    'must be sqlite:<path>, sqlite::memory: or postgres://…',
  );

const envSchema = z.object({
  RIVER_HOST: z.string().min(1).default('127.0.0.1'),
  RIVER_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  RIVER_DATABASE_URL: databaseUrlSchema.default('sqlite:./data/river.sqlite'),
  RIVER_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
  /** Set only when running behind a reverse proxy you control; otherwise client IPs could be spoofed. */
  RIVER_TRUST_PROXY: bool.default(false),
  /** Requests per minute per client before 429. Counted in memory only; never stored. */
  RIVER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(300),
  /** 'open': anyone may create an account; 'closed': no new accounts. */
  RIVER_REGISTRATION: z.enum(['open', 'closed']).default('open'),
  RIVER_SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24),
  /** Where encrypted attachment blobs are stored. */
  RIVER_ATTACHMENT_DIR: z.string().min(1).default('./data/attachments'),
  /** Largest attachment (after encryption) in MiB. */
  RIVER_MAX_ATTACHMENT_MB: z.coerce.number().int().min(1).max(500).default(25),
  /** Public https URL of this server; enables HSTS. */
  RIVER_PUBLIC_URL: z.url({ protocol: /^https$/ }).optional(),
});

export interface ServerConfig {
  host: string;
  port: number;
  databaseUrl: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'silent';
  trustProxy: boolean;
  rateLimitPerMinute: number;
  publicUrl: string | undefined;
  registration: 'open' | 'closed';
  sessionTtlMs: number;
  attachmentDir: string;
  maxAttachmentBytes: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Reads configuration from environment variables. Throws ConfigError listing every problem. */
export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const relevant = Object.fromEntries(
    Object.entries(env).filter(([k, v]) => k.startsWith('RIVER_') && v !== undefined && v !== ''),
  );
  const result = envSchema.safeParse(relevant);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid configuration — ${problems}`);
  }
  const e = result.data;
  return {
    host: e.RIVER_HOST,
    port: e.RIVER_PORT,
    databaseUrl: e.RIVER_DATABASE_URL,
    logLevel: e.RIVER_LOG_LEVEL,
    trustProxy: e.RIVER_TRUST_PROXY,
    rateLimitPerMinute: e.RIVER_RATE_LIMIT_PER_MINUTE,
    publicUrl: e.RIVER_PUBLIC_URL,
    registration: e.RIVER_REGISTRATION,
    sessionTtlMs: e.RIVER_SESSION_TTL_HOURS * 60 * 60 * 1000,
    attachmentDir: e.RIVER_ATTACHMENT_DIR,
    maxAttachmentBytes: e.RIVER_MAX_ATTACHMENT_MB * 1024 * 1024,
  };
}
