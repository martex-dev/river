import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Minimal local logger. Logs stay on this device (never uploaded) and must
 * never contain message content, keys or tokens — log events, not data.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

const MAX_BYTES = 1024 * 1024;

export function createFileLogger(dir: string, name = 'main.log'): Logger {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);

  function write(level: string, message: string): void {
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${redact(message)}\n`;
    try {
      if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) {
        renameSync(file, `${file}.1`);
      }
      appendFileSync(file, line, { mode: 0o600 });
    } catch {
      // Logging must never crash the app.
    }
    if (level === 'ERROR') console.error(line.trimEnd());
    else if (level === 'WARN') console.warn(line.trimEnd());
  }

  return {
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
    debug: (m) => write('DEBUG', m),
  };
}

/** Defensive scrubbing for things that should never be logged even by mistake. */
export function redact(message: string): string {
  return message
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[redacted key]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g, '[redacted token]')
    .replace(/(authorization|token|password|secret)(["':=\s]+)([^\s"',}]+)/gi, '$1$2[redacted]');
}

export const nullLogger: Logger = { info() {}, warn() {}, error() {}, debug() {} };
