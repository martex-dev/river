import { createServer as createHttpServer, get, type Server as HttpServer } from 'node:http';
import { createServer, connect, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket as WsSocket, WebSocketServer } from 'ws';
import {
  ProxyAgent,
  activeProxy,
  chromiumProxyConfig,
  connectThroughProxy,
  isLoopbackHost,
  type ActiveProxy,
} from '../src/main/proxy.ts';
import { checkProxy } from '../src/main/proxy-check.ts';
import { DEFAULT_SETTINGS, proxySettingsSchema, settingsPatchSchema } from '../src/shared/settings.ts';

const servers: Array<Server | HttpServer | WebSocketServer> = [];
const open = new Set<Socket>();
const listen = async <T extends Server | HttpServer>(server: T): Promise<number> => {
  servers.push(server);
  server.on('connection', (s: Socket) => {
    open.add(s);
    s.on('close', () => open.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return (server.address() as AddressInfo).port;
};
afterEach(async () => {
  for (const s of open) s.destroy();
  for (const s of servers.splice(0)) await new Promise((r) => s.close(() => r(undefined)));
});

/** Reads `n` bytes from a socket (test proxies only). */
function readBytes(socket: Socket, n: number, state: { buf: Buffer }): Promise<Buffer> {
  return new Promise((resolve) => {
    const take = (): boolean => {
      if (state.buf.length < n) return false;
      const out = state.buf.subarray(0, n);
      state.buf = state.buf.subarray(n);
      resolve(out);
      return true;
    };
    if (take()) return;
    const on = (chunk: Buffer): void => {
      state.buf = Buffer.concat([state.buf, chunk]);
      if (take()) socket.off('data', on);
    };
    socket.on('data', on);
  });
}

/** A minimal SOCKS5 proxy: names under .test go to 127.0.0.1 (so the test sees names, not IPs). */
async function socksProxy(seen: string[], refuse = false): Promise<number> {
  return listen(
    createServer((client) => {
      const state = { buf: Buffer.alloc(0) };
      void (async () => {
        await readBytes(client, 3, state);
        client.write(Buffer.from([0x05, 0x00]));
        const head = await readBytes(client, 4, state);
        let host: string;
        if (head[3] === 0x03) {
          const len = (await readBytes(client, 1, state))[0]!;
          host = (await readBytes(client, len, state)).toString();
        } else {
          host = [...(await readBytes(client, 4, state))].join('.');
        }
        const port = (await readBytes(client, 2, state)).readUInt16BE();
        seen.push(`${head[3] === 0x03 ? 'name' : 'ip'}:${host}:${port}`);
        if (refuse) {
          client.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          return;
        }
        const upstream = connect(port, host.endsWith('.test') ? '127.0.0.1' : host, () => {
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
          if (state.buf.length) upstream.write(state.buf);
          client.pipe(upstream).pipe(client);
        });
        upstream.on('error', () => client.destroy());
      })();
    }),
  );
}

/** A minimal HTTP CONNECT proxy. */
async function connectProxy(seen: string[]): Promise<number> {
  return listen(
    createServer((client) => {
      let buf = Buffer.alloc(0);
      const on = (chunk: Buffer): void => {
        buf = Buffer.concat([buf, chunk]);
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        client.off('data', on);
        const line = buf.subarray(0, end).toString().split('\r\n')[0]!;
        const [, target] = line.split(' ');
        seen.push(target!);
        const [host, port] = [target!.slice(0, target!.lastIndexOf(':')), Number(target!.split(':').pop())];
        const upstream = connect(port, host.endsWith('.test') ? '127.0.0.1' : host, () => {
          client.write('HTTP/1.1 200 Connection established\r\n\r\n');
          const rest = buf.subarray(end + 4);
          if (rest.length) upstream.write(rest);
          client.pipe(upstream).pipe(client);
        });
        upstream.on('error', () => client.destroy());
      };
      client.on('data', on);
    }),
  );
}

async function echoServer(): Promise<number> {
  return listen(createServer((s) => s.pipe(s)));
}

const roundTrip = (socket: Socket, text: string): Promise<string> =>
  new Promise((resolve) => {
    socket.once('data', (d) => resolve(d.toString()));
    socket.write(text);
  });

describe('proxy settings', () => {
  it('is off by default and validates hosts and ports', () => {
    expect(DEFAULT_SETTINGS.privacy.proxy.mode).toBe('off');
    expect(activeProxy(DEFAULT_SETTINGS.privacy.proxy)).toBeNull();
    for (const host of ['127.0.0.1', 'localhost', 'proxy.example.org', '[::1]'])
      expect(proxySettingsSchema.safeParse({ mode: 'socks5', host, port: 9050 }).success).toBe(true);
    for (const host of ['', 'socks5://127.0.0.1', 'user:pw@host', 'a b', 'host:9050', 'host/path'])
      expect(proxySettingsSchema.safeParse({ mode: 'socks5', host, port: 9050 }).success).toBe(false);
    expect(proxySettingsSchema.safeParse({ mode: 'socks5', host: 'h', port: 0 }).success).toBe(false);
    expect(
      settingsPatchSchema.safeParse({ privacy: { proxy: { mode: 'tor', host: 'h', port: 1 } } }).success,
    ).toBe(false);
  });

  it('tells Chromium to use the proxy, or the system settings when off (never a direct fallback)', () => {
    expect(chromiumProxyConfig({ mode: 'socks5', host: '127.0.0.1', port: 9050 })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'socks5://127.0.0.1:9050',
    });
    expect(chromiumProxyConfig({ mode: 'http', host: 'proxy.lan', port: 3128 })).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://proxy.lan:3128',
    });
    expect(chromiumProxyConfig({ mode: 'off', host: '127.0.0.1', port: 9050 })).toEqual({ mode: 'system' });
  });

  it('reaches servers on this computer directly', () => {
    for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::1', 'app.localhost'])
      expect(isLoopbackHost(h)).toBe(true);
    for (const h of ['river.example.org', '10.0.0.1', '128.0.0.1', 'localhost.evil.org'])
      expect(isLoopbackHost(h)).toBe(false);
  });
});

describe('connections through a proxy', () => {
  it('SOCKS5: sends the host name to the proxy (no DNS here) and carries data', async () => {
    const seen: string[] = [];
    const proxy: ActiveProxy = { mode: 'socks5', host: '127.0.0.1', port: await socksProxy(seen) };
    const echo = await echoServer();
    const socket = await connectThroughProxy(proxy, 'river.test', echo);
    expect(await roundTrip(socket, 'hello')).toBe('hello');
    socket.destroy();
    expect(seen).toEqual([`name:river.test:${echo}`]);
  });

  it('HTTP CONNECT: tunnels to the named host', async () => {
    const seen: string[] = [];
    const proxy: ActiveProxy = { mode: 'http', host: '127.0.0.1', port: await connectProxy(seen) };
    const echo = await echoServer();
    const socket = await connectThroughProxy(proxy, 'river.test', echo);
    expect(await roundTrip(socket, 'ping')).toBe('ping');
    socket.destroy();
    expect(seen).toEqual([`river.test:${echo}`]);
  });

  it('fails closed: an unreachable or refusing proxy is an error, never a direct connection', async () => {
    const closed = await listen(createServer());
    servers.pop()!.close();
    await expect(
      connectThroughProxy({ mode: 'socks5', host: '127.0.0.1', port: closed }, 'river.test', 443),
    ).rejects.toThrow(/proxy/i);
    const seen: string[] = [];
    const refusing = await socksProxy(seen, true);
    await expect(
      connectThroughProxy({ mode: 'socks5', host: '127.0.0.1', port: refusing }, 'river.test', 443),
    ).rejects.toThrow(/refused/);
    // A proxy that never answers gives up in time.
    const silent = await listen(createServer(() => undefined));
    await expect(
      connectThroughProxy({ mode: 'http', host: '127.0.0.1', port: silent }, 'river.test', 443, {
        timeoutMs: 200,
      }),
    ).rejects.toThrow(/in time/);
  });

  it('HTTP requests and the realtime WebSocket go through ProxyAgent', async () => {
    const seen: string[] = [];
    const proxy: ActiveProxy = { mode: 'socks5', host: '127.0.0.1', port: await socksProxy(seen) };
    const web = createHttpServer((_req, res) => res.end('{"status":"ok"}'));
    const webPort = await listen(web);
    const body = await new Promise<string>((resolve, reject) => {
      get(`http://river.test:${webPort}/v1/health`, { agent: new ProxyAgent(proxy, false) }, (res) => {
        let text = '';
        res.on('data', (d: Buffer) => (text += d.toString()));
        res.on('end', () => resolve(text));
      }).on('error', reject);
    });
    expect(body).toBe('{"status":"ok"}');

    const wsHttp = createHttpServer();
    const wss = new WebSocketServer({ server: wsHttp });
    servers.push(wss);
    wss.on('connection', (s) => s.on('message', (m, binary) => s.send(m, { binary })));
    const wsPort = await listen(wsHttp);
    const socket = new WsSocket(`ws://river.test:${wsPort}/v1/ws`, { agent: new ProxyAgent(proxy, false) });
    socket.binaryType = 'arraybuffer';
    const echoed = await new Promise<unknown[]>((resolve, reject) => {
      const got: unknown[] = [];
      socket.onopen = () => {
        socket.send(JSON.stringify({ t: 'ping' }));
        socket.send(new Uint8Array([1, 2, 3]));
      };
      socket.onmessage = (m) => {
        got.push(m.data);
        if (got.length === 2) resolve(got);
      };
      socket.onerror = (e) => reject(new Error(e.message));
    });
    socket.close();
    // What community-service relies on: text as strings, binary frames as ArrayBuffers.
    expect(echoed[0]).toBe('{"t":"ping"}');
    expect(echoed[1]).toBeInstanceOf(ArrayBuffer);
    expect(seen).toEqual([`name:river.test:${webPort}`, `name:river.test:${wsPort}`]);
  });

  it('Test connection: checks the proxy and the server both ways River connects', async () => {
    const seen: string[] = [];
    const proxy: ActiveProxy = { mode: 'socks5', host: '127.0.0.1', port: await socksProxy(seen) };
    const webPort = await listen(createHttpServer((_req, res) => res.end('{"status":"ok"}')));
    const asked: string[] = [];
    const checks = await checkProxy(proxy, `http://river.test:${webPort}`, {
      chromiumGet: async (url) => {
        asked.push(url);
        return 200;
      },
    });
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ['proxy', 'ok'],
      ['proxy-live', 'ok'],
      ['proxy-net', 'ok'],
      ['proxy-note', 'ok'],
    ]);
    expect(asked).toEqual([`http://river.test:${webPort}/v1/health`]);
    expect(checks.at(-1)!.detail).toMatch(/cannot tell whether the proxy itself keeps you anonymous/);

    const closed = await listen(createServer());
    servers.pop()!.close();
    const down = await checkProxy(
      { mode: 'socks5', host: '127.0.0.1', port: closed },
      'https://river.example',
    );
    expect(down).toHaveLength(1);
    expect(down[0]).toMatchObject({ id: 'proxy', status: 'fail' });
    expect(down[0]!.advice).toMatch(/9050/);

    expect((await checkProxy(proxy, 'http://127.0.0.1:8787'))[0]).toMatchObject({
      id: 'proxy-local',
      status: 'ok',
    });
    expect((await checkProxy(proxy, null))[0]).toMatchObject({ status: 'warn' });
  });
});
