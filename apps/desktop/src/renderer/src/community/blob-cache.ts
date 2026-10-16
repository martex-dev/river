/**
 * Decrypted files as object URLs, kept for this session so scrolling back does not decrypt again
 * (2.10.12). Bounded: past `maxEntries` or `maxBytes` the least recently used URLs are revoked —
 * never one still on screen (each shown copy holds a reference) — and asking for a file that is
 * already being decrypted waits for that instead of decrypting it twice.
 */

interface Entry {
  url: string;
  bytes: number;
  refs: number;
}

export interface BlobCacheOptions {
  maxEntries: number;
  maxBytes: number;
  /** Injected for tests; URL.createObjectURL / revokeObjectURL in the app. */
  create?(blob: Blob): string;
  revoke?(url: string): void;
}

export class BlobUrlCache {
  private readonly entries = new Map<string, Entry>();
  private readonly loading = new Map<string, Promise<string>>();
  private total = 0;
  private readonly create: (blob: Blob) => string;
  private readonly revoke: (url: string) => void;
  private readonly options: BlobCacheOptions;

  constructor(options: BlobCacheOptions) {
    this.options = options;
    this.create = options.create ?? ((blob) => URL.createObjectURL(blob));
    this.revoke = options.revoke ?? ((url) => URL.revokeObjectURL(url));
  }

  /** The URL if it is ready (and marks it recently used). */
  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.url;
  }

  /** The URL, decrypting (`make`) only if it is neither ready nor on its way. */
  load(key: string, make: () => Promise<Blob>): Promise<string> {
    const ready = this.get(key);
    if (ready) return Promise.resolve(ready);
    const pending = this.loading.get(key);
    if (pending) return pending;
    const promise = make()
      .then((blob) => {
        const url = this.create(blob);
        this.entries.set(key, { url, bytes: blob.size, refs: 0 });
        this.total += blob.size;
        this.evict(key);
        return url;
      })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, promise);
    return promise;
  }

  /** Keeps the URL alive while something shows it; call the returned function when it no longer does. */
  retain(key: string): () => void {
    const entry = this.entries.get(key);
    if (!entry) return () => undefined;
    entry.refs++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.refs = Math.max(0, entry.refs - 1);
      this.evict();
    };
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.total;
  }

  /** Revokes the least recently used URLs nothing shows until within the limits (`keep` stays). */
  private evict(keep?: string): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.options.maxEntries && this.total <= this.options.maxBytes) return;
      if (entry.refs > 0 || key === keep) continue;
      this.entries.delete(key);
      this.total -= entry.bytes;
      this.revoke(entry.url);
    }
  }
}
