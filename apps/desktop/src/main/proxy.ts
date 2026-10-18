import { Agent as HttpAgent, type ClientRequestArgs } from 'node:http';
import { connect as netConnect, isIP, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { checkServerIdentity, connect as tlsConnect, type ConnectionOptions } from 'node:tls';
import type { ProxySettings } from '../shared/settings.ts';

/**
 * Settings → Privacy → Proxy (2.15): River's own connections to its server — requests, the
 * realtime connection, files, update checks and following a moved server — go through a SOCKS5
 * proxy (Tor: 127.0.0.1:9050, Tor Browser: 9150) or an HTTP proxy (CONNECT), so the server sees
 * the proxy's address instead of yours.
 *
 * - Chromium's network stack (Electron `net.fetch`, the updater, the window) is pointed at the
 *   proxy with `session.setProxy`; SOCKS5 there sends host names to the proxy (no local DNS).
 * - The realtime WebSocket is Node's, which ignores Chromium's proxy, so with a proxy on it is
 *   opened through `ProxyAgent` below: a SOCKS5 or CONNECT tunnel (host names are resolved by the
 *   proxy), then TLS to the server inside it, verified as usual.
 * - Fail closed: if the proxy cannot be reached River does not connect at all; it never falls back
 *   to a direct connection. A server on this computer (localhost) is reached directly.
 *
 * Plain protocol code only (RFC 1928 and HTTP CONNECT); TLS is Node's.
 */

export type ActiveProxy = { mode: 'socks5' | 'http'; host: string; port: number };

/** The proxy to use, or null when it is off. */
export function activeProxy(p: ProxySettings | undefined): ActiveProxy | null {
  if (!p || p.mode === 'off') return null;
  return { mode: p.mode, host: p.host, port: p.port };
}

/** Hosts on this computer: reached directly, never through the proxy (as Chromium does). */
export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** What `session.setProxy` gets: the proxy, or back to the system's settings when it is off. */
export function chromiumProxyConfig(
  p: ProxySettings | undefined,
): { mode: 'system' } | { mode: 'fixed_servers'; proxyRules: string } {
  const active = activeProxy(p);
  if (!active) return { mode: 'system' };
  const scheme = active.mode === 'socks5' ? 'socks5' : 'http';
  return { mode: 'fixed_servers', proxyRules: `${scheme}://${active.host}:${active.port}` };
}

export class ProxyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProxyError';
  }
}

const SOCKS_REPLIES: Record<number, string> = {
  1: 'the proxy failed',
  2: 'the proxy does not allow this connection',
  3: 'the network is unreachable from the proxy',
  4: 'the server cannot be reached from the proxy',
  5: 'the server refused the connection',
  6: 'the connection timed out at the proxy',
  7: 'the proxy does not support this',
  8: 'the proxy does not support this address',
};

/** Reads exact amounts from a socket during a handshake; what is left over is put back. */
class HandshakeReader {
  private buffered = Buffer.alloc(0);
  private waiting: (() => void) | null = null;
  private failed: Error | null = null;
  private readonly socket: Socket;
  private readonly onData = (chunk: Buffer): void => {
    this.buffered = Buffer.concat([this.buffered, chunk]);
    this.wake();
  };
  private readonly onEnd = (): void => {
    this.failed ??= new ProxyError('The proxy closed the connection');
    this.wake();
  };
  private readonly onError = (err: Error): void => {
    this.failed ??= new ProxyError(`The proxy could not be reached (${err.message})`);
    this.wake();
  };

  constructor(socket: Socket) {
    this.socket = socket;
    socket.on('data', this.onData);
    socket.on('end', this.onEnd);
    socket.on('error', this.onError);
  }

  private wake(): void {
    const w = this.waiting;
    this.waiting = null;
    w?.();
  }

  private async until(ready: () => boolean): Promise<void> {
    while (!ready()) {
      if (this.failed) throw this.failed;
      await new Promise<void>((resolve) => (this.waiting = resolve));
    }
  }

  async read(n: number): Promise<Buffer> {
    await this.until(() => this.buffered.length >= n);
    const out = this.buffered.subarray(0, n);
    this.buffered = this.buffered.subarray(n);
    return out;
  }

  /** Reads up to and including `delimiter` (at most `max` bytes). */
  async readUntil(delimiter: string, max: number): Promise<Buffer> {
    await this.until(() => this.buffered.includes(delimiter) || this.buffered.length > max);
    const at = this.buffered.indexOf(delimiter);
    if (at < 0) throw new ProxyError('The proxy sent an invalid answer');
    return this.read(at + delimiter.length);
  }

  /** Stops reading. River's protocols (TLS, HTTP) speak first, so nothing may have arrived yet. */
  release(): void {
    this.socket.off('data', this.onData);
    this.socket.off('end', this.onEnd);
    this.socket.off('error', this.onError);
    if (this.buffered.length) throw new ProxyError('The proxy sent more than its answer');
  }
}

function socksAddress(host: string): Buffer {
  const bare = host.replace(/^\[|\]$/g, '');
  const kind = isIP(bare);
  if (kind === 4) return Buffer.from([0x01, ...bare.split('.').map(Number)]);
  if (kind === 6) {
    // Expand "::" and write the eight 16-bit groups.
    const [head = '', tail = ''] = bare.split('::');
    const h = head ? head.split(':') : [];
    const t = bare.includes('::') ? (tail ? tail.split(':') : []) : [];
    const groups = [...h, ...Array<string>(8 - h.length - t.length).fill('0'), ...t];
    const out = Buffer.alloc(17);
    out[0] = 0x04;
    groups.forEach((g, i) => out.writeUInt16BE(parseInt(g || '0', 16), 1 + i * 2));
    return out;
  }
  // A name: the proxy resolves it (no DNS request leaves this computer).
  const name = Buffer.from(bare, 'utf8');
  if (name.length < 1 || name.length > 255) throw new ProxyError('The server name is too long');
  return Buffer.concat([Buffer.from([0x03, name.length]), name]);
}

async function socks5(socket: Socket, reader: HandshakeReader, host: string, port: number): Promise<void> {
  socket.write(Buffer.from([0x05, 0x01, 0x00])); // version 5, one method: no authentication
  const choice = await reader.read(2);
  if (choice[0] !== 0x05) throw new ProxyError('This is not a SOCKS5 proxy');
  if (choice[1] !== 0x00) throw new ProxyError('The proxy wants a password, which River does not support');
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), socksAddress(host), portBytes]));
  const head = await reader.read(4);
  if (head[0] !== 0x05) throw new ProxyError('This is not a SOCKS5 proxy');
  if (head[1] !== 0x00) {
    throw new ProxyError(`Through the proxy: ${SOCKS_REPLIES[head[1]!] ?? 'the connection was refused'}`);
  }
  const atyp = head[3];
  const length = atyp === 0x01 ? 4 : atyp === 0x04 ? 16 : atyp === 0x03 ? (await reader.read(1))[0]! : -1;
  if (length < 0) throw new ProxyError('The proxy sent an invalid answer');
  await reader.read(length + 2); // bound address and port: not needed
}

async function httpConnect(
  socket: Socket,
  reader: HandshakeReader,
  host: string,
  port: number,
): Promise<void> {
  const target = `${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
  socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
  const head = (await reader.readUntil('\r\n\r\n', 16 * 1024)).toString('latin1');
  const status = /^HTTP\/1\.[01] (\d{3})/.exec(head);
  if (!status) throw new ProxyError('This is not an HTTP proxy');
  if (status[1] === '407') throw new ProxyError('The proxy wants a password, which River does not support');
  if (status[1] !== '200') throw new ProxyError(`The proxy refused the connection (HTTP ${status[1]})`);
}

/**
 * A TCP connection to `host:port` through the proxy. The host name goes to the proxy, which
 * resolves it. Rejects (and closes everything) if the proxy cannot be reached or refuses.
 */
export async function connectThroughProxy(
  proxy: ActiveProxy,
  host: string,
  port: number,
  options: { timeoutMs?: number; connect?: (port: number, host: string) => Socket } = {},
): Promise<Socket> {
  const socket = (options.connect ?? ((p, h) => netConnect(p, h)))(proxy.port, proxy.host);
  socket.setNoDelay(true);
  const reader = new HandshakeReader(socket);
  const timer = setTimeout(
    () => socket.destroy(new ProxyError('The proxy did not answer in time')),
    options.timeoutMs ?? 15_000,
  );
  try {
    await new Promise<void>((resolve, reject) => {
      if (!socket.connecting) return resolve();
      socket.once('connect', () => resolve());
      socket.once('error', (err) =>
        reject(
          err instanceof ProxyError ? err : new ProxyError(`The proxy could not be reached (${err.message})`),
        ),
      );
    });
    if (proxy.mode === 'socks5') await socks5(socket, reader, host, port);
    else await httpConnect(socket, reader, host, port);
    reader.release();
    return socket;
  } catch (err) {
    try {
      reader.release();
    } catch {
      // closing anyway
    }
    socket.destroy();
    throw err instanceof ProxyError ? err : new ProxyError((err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TLS to the server inside a proxy tunnel. The certificate is checked against the server's own
 * name or address (2.18): for a server given by IP address Node would otherwise check it against
 * the host the tunnel socket was opened to, which is the proxy, so whoever ran the proxy could
 * have answered with a certificate for the proxy's own name.
 */
export function tunnelTls(tunnel: Duplex, server: string): ConnectionOptions {
  return {
    socket: tunnel,
    host: server,
    ...(isIP(server) ? {} : { servername: server }),
    checkServerIdentity: (_host, cert) => checkServerIdentity(server, cert),
    ALPNProtocols: ['http/1.1'],
  };
}

/**
 * A Node HTTP(S) agent whose every connection is a tunnel through the proxy (for the `ws`
 * WebSocket client and the proxy check). `secure`: TLS to the server inside the tunnel, with the
 * usual certificate checks.
 */
export class ProxyAgent extends HttpAgent {
  private readonly proxy: ActiveProxy;
  private readonly secure: boolean;

  constructor(proxy: ActiveProxy, secure: boolean) {
    super({ keepAlive: false });
    this.proxy = proxy;
    this.secure = secure;
    // https.request checks that its agent speaks https.
    (this as unknown as { protocol: string }).protocol = secure ? 'https:' : 'http:';
  }

  override createConnection(
    options: ClientRequestArgs,
    callback?: (err: Error | null, socket: Duplex) => void,
  ): Duplex | null | undefined {
    const host = String(options.hostname ?? options.host ?? 'localhost').replace(/^\[|\]$/g, '');
    const port = Number(options.port) || (this.secure ? 443 : 80);
    const servername = (options as { servername?: string }).servername ?? host;
    connectThroughProxy(this.proxy, host, port).then(
      (tunnel) => {
        if (!this.secure) return callback?.(null, tunnel);
        callback?.(null, tlsConnect(tunnelTls(tunnel, servername)));
      },
      (err: Error) => callback?.(err, undefined as unknown as Duplex),
    );
    return undefined;
  }
}
