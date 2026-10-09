import type { z } from 'zod';

/** Downloads a URL into memory, refusing responses larger than `maxBytes`. */
export type FetchBytes = (url: string, maxBytes: number) => Promise<Uint8Array>;

/**
 * fetch()-based implementation with a hard size cap and a timeout, so a slow
 * or hostile server can neither exhaust memory nor hang the caller.
 */
export function createFetchBytes(fetchImpl: typeof fetch, options: { timeoutMs?: number } = {}): FetchBytes {
  const timeoutMs = options.timeoutMs ?? 30_000;
  return async (url, maxBytes) => {
    const res = await fetchImpl(url, {
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > maxBytes) throw new Error(`Response too large from ${url}`);
    const reader = res.body?.getReader();
    if (!reader) return new Uint8Array(await res.arrayBuffer());
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response too large from ${url}`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Connection-level failure (DNS, refused, timeout, TLS) as opposed to an API error. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export type RequestJson = <T>(
  url: string,
  options: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; token?: string },
  schema: z.ZodType<T>,
) => Promise<T>;

/**
 * JSON request with a size cap, a timeout and schema validation of the
 * response. Non-2xx responses become ApiError with the server's error code.
 */
export function createRequestJson(
  fetchImpl: typeof fetch,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): RequestJson {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 256 * 1024;
  return async (url, req, schema) => {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: req.method,
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          ...(req.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(req.token ? { authorization: `Bearer ${req.token}` } : {}),
        },
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      });
    } catch (err) {
      throw new NetworkError((err as Error).message);
    }
    const text = await readCapped(res, maxBytes);
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError(res.status, 'invalid_response', 'The server sent an invalid response');
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      throw new ApiError(
        res.status,
        typeof err?.code === 'string' ? err.code.slice(0, 64) : 'http_error',
        typeof err?.message === 'string' ? err.message.slice(0, 300) : `HTTP ${res.status}`,
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new ApiError(res.status, 'invalid_response', 'The server sent an unexpected response');
    return parsed.data;
  };
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new ApiError(res.status, 'too_large', 'Response too large');
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError(res.status, 'too_large', 'Response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
