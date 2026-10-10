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
  /** 0 picks any free port (the River app does this when its preferred port is taken). */
  RIVER_PORT: z.coerce.number().int().min(0).max(65535).default(8787),
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
  /** Total size of the files one person can keep on the server, in MiB. */
  RIVER_ATTACHMENT_QUOTA_MB: z.coerce.number().int().min(10).max(1_000_000).default(2048),
  /** Undelivered envelopes kept per device; more are refused until it catches up. */
  RIVER_MAILBOX_LIMIT: z.coerce.number().int().min(100).max(1_000_000).default(5000),
  /** TURN relay URLs for calls (comma-separated), e.g. turn:turn.example.org:3478,turns:turn.example.org:5349 */
  RIVER_TURN_URLS: z.string().max(2000).optional(),
  /** coturn "static-auth-secret": the server hands out short-lived TURN credentials signed with it. */
  RIVER_TURN_SECRET: z.string().min(16).max(256).optional(),
  /** Public https URL of this server; enables HSTS. */
  RIVER_PUBLIC_URL: z.url({ protocol: /^https$/ }).optional(),
  /**
   * A public relay (ntfy-compatible, e.g. https://ntfy.sh) where the server posts signed notes
   * of its new address, for servers whose address changes (home PC behind a quick tunnel).
   */
  RIVER_BEACON_RELAY: z.url({ protocol: /^https$/ }).optional(),
  /** Secret River Host uses to tell the server its public address (from this machine only). */
  RIVER_HOST_TOKEN: z.string().min(32).max(256).optional(),
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
  turn: { urls: string[]; secret: string } | null;
  beaconRelay?: string;
  hostToken?: string;
  attachmentQuotaBytes: number;
  mailboxLimit: number;
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
    attachmentQuotaBytes: e.RIVER_ATTACHMENT_QUOTA_MB * 1024 * 1024,
    mailboxLimit: e.RIVER_MAILBOX_LIMIT,
    ...(e.RIVER_BEACON_RELAY ? { beaconRelay: e.RIVER_BEACON_RELAY.replace(/\/+$/, '') } : {}),
    ...(e.RIVER_HOST_TOKEN ? { hostToken: e.RIVER_HOST_TOKEN } : {}),
    turn:
      e.RIVER_TURN_URLS && e.RIVER_TURN_SECRET
        ? {
            urls: e.RIVER_TURN_URLS.split(',')
              .map((u) => u.trim())
              .filter((u) => /^turns?:[^\s]+$/.test(u)),
            secret: e.RIVER_TURN_SECRET,
          }
        : null,
  };
}
