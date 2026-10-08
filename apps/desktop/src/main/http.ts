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
