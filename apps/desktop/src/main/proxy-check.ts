import { request as httpRequest, type Agent } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { API_PREFIX } from '@river/protocol';
import type { DiagnosticCheck } from '../shared/ipc.ts';
import { ProxyAgent, connectThroughProxy, isLoopbackHost, type ActiveProxy } from './proxy.ts';

/**
 * Settings → Privacy → Proxy → Test connection (2.13): can River reach its server through this
 * proxy, both ways it connects — Node's tunnel (the realtime connection) and Chromium's network
 * stack (requests and files)? It contacts only the proxy and the user's own server. It cannot
 * tell whether the proxy keeps anyone anonymous; the result says so.
 */
export interface ProxyCheckDeps {
  /** GET through Chromium with this proxy (a separate session, so nothing else changes): the status. */
  chromiumGet?: (url: string) => Promise<number>;
  /** GET through Node with this agent: the status (tests replace it). */
  nodeGet?: (url: string, agent: Agent) => Promise<number>;
  timeoutMs?: number;
}

function defaultNodeGet(url: string, agent: Agent, timeoutMs: number): Promise<number> {
  const request = url.startsWith('https:') ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(url, { agent, method: 'GET', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('timeout', () => req.destroy(new Error('no answer in time')));
    req.on('error', reject);
    req.end();
  });
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function checkProxy(
  proxy: ActiveProxy,
  serverUrl: string | null,
  deps: ProxyCheckDeps = {},
): Promise<DiagnosticCheck[]> {
  const timeoutMs = deps.timeoutMs ?? 20_000;
  const label = `${proxy.mode === 'socks5' ? 'SOCKS5' : 'HTTP'} proxy ${proxy.host}:${proxy.port}`;
  if (!serverUrl) {
    return [
      {
        id: 'proxy-server',
        label: 'Server',
        status: 'warn',
        detail: 'no server set up yet, so there is nothing to test through the proxy',
      },
    ];
  }
  const url = new URL(serverUrl);
  if (isLoopbackHost(url.hostname)) {
    return [
      {
        id: 'proxy-local',
        label: 'Server',
        status: 'ok',
        detail: 'your server is on this computer: River reaches it directly, not through the proxy',
      },
    ];
  }
  const checks: DiagnosticCheck[] = [];
  const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
  try {
    const tunnel = await connectThroughProxy(proxy, url.hostname, port, { timeoutMs });
    tunnel.destroy();
    checks.push({ id: 'proxy', label, status: 'ok', detail: `reaches ${url.host}` });
  } catch (err) {
    checks.push({
      id: 'proxy',
      label,
      status: 'fail',
      detail: reason(err),
      advice:
        proxy.mode === 'socks5'
          ? 'Is the proxy running? Tor listens on 127.0.0.1:9050, Tor Browser on 127.0.0.1:9150 (while it is open).'
          : 'Is the proxy running, and does it allow connections to this server?',
    });
    return checks;
  }
  const health = `${serverUrl}${API_PREFIX}/health`;
  try {
    const status = await (deps.nodeGet ?? ((u, a) => defaultNodeGet(u, a, timeoutMs)))(
      health,
      new ProxyAgent(proxy, url.protocol === 'https:'),
    );
    checks.push(
      status === 200
        ? {
            id: 'proxy-live',
            label: 'Live connection',
            status: 'ok',
            detail: 'your server answers through the proxy',
          }
        : {
            id: 'proxy-live',
            label: 'Live connection',
            status: 'fail',
            detail: `your server answered HTTP ${status}`,
          },
    );
  } catch (err) {
    checks.push({ id: 'proxy-live', label: 'Live connection', status: 'fail', detail: reason(err) });
  }
  if (deps.chromiumGet) {
    try {
      const status = await deps.chromiumGet(health);
      checks.push(
        status === 200
          ? { id: 'proxy-net', label: 'Requests and files', status: 'ok', detail: 'go through the proxy' }
          : { id: 'proxy-net', label: 'Requests and files', status: 'fail', detail: `HTTP ${status}` },
      );
    } catch (err) {
      checks.push({ id: 'proxy-net', label: 'Requests and files', status: 'fail', detail: reason(err) });
    }
  }
  if (checks.every((c) => c.status === 'ok')) {
    checks.push({
      id: 'proxy-note',
      label: 'Note',
      status: 'ok',
      detail:
        'River reaches your server only through this proxy. This test cannot tell whether the proxy itself keeps you anonymous.',
    });
  }
  return checks;
}
