import type { LookupAddress, LookupOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { isPrivateAddress, type PreviewDeps } from './link-preview.ts';

/**
 * The network side of link previews on computers (phones make none): every
 * connection goes only to addresses checked at the moment it is made.
 */

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A DNS lookup for sockets that refuses to connect anywhere non-public: every
 * address the name resolves to is checked, at connection time. Checking first
 * and letting the request resolve the name again would let a rebinding DNS
 * server answer "public" to the check and "127.0.0.1" to the connection.
 */
export function publicOnlyLookup(
  hostname: string,
  options: LookupOptions | number | undefined,
  callback: LookupCallback,
  resolve: (host: string) => Promise<LookupAddress[]> = (host) => lookup(host, { all: true }),
): void {
  const all = typeof options === 'object' && options !== null && options.all === true;
  const asked = typeof options === 'number' ? options : (options?.family ?? 0);
  const family = asked === 'IPv4' ? 4 : asked === 'IPv6' ? 6 : asked;
  resolve(hostname).then(
    (found) => {
      const usable = found.filter((a) => family === 0 || a.family === family);
      if (!usable.length || found.some((a) => isPrivateAddress(a.address))) {
        const err: NodeJS.ErrnoException = new Error(
          `Refusing to connect to ${hostname}: not a public address`,
        );
        err.code = 'ENOTFOUND';
        callback(err, all ? [] : '', 0);
        return;
      }
      if (all) callback(null, usable);
      else callback(null, usable[0]!.address, usable[0]!.family);
    },
    (err: NodeJS.ErrnoException) => callback(err, all ? [] : '', 0),
  );
}

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/**
 * fetch() for previews over node:http(s), connecting only to the addresses
 * publicOnlyLookup approved (no redirects followed here; no proxy).
 */
export const pinnedFetch: typeof fetch = (input, init) =>
  new Promise<Response>((done, fail) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        headers: {
          ...Object.fromEntries(new Headers(init?.headers).entries()),
          'accept-encoding': 'identity',
        },
        lookup: publicOnlyLookup as never,
        ...(init?.signal ? { signal: init.signal } : {}),
      },
      (res) => {
        const headers = new Headers();
        const raw = res.rawHeaders;
        for (let i = 0; i + 1 < raw.length; i += 2) headers.append(raw[i]!, raw[i + 1]!);
        const status = res.statusCode ?? 0;
        try {
          const body = NULL_BODY.has(status) ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
          if (!body) res.resume();
          done(new Response(body, { status, headers }));
        } catch (err) {
          res.destroy();
          fail(err as Error);
        }
      },
    );
    request.on('error', fail);
    request.end();
  });

/** What desktop River fetches previews with. */
export const pinnedPreviewDeps: PreviewDeps = {
  fetch: pinnedFetch,
  resolve: async (host) => (await lookup(host, { all: true })).map((r) => r.address),
};
