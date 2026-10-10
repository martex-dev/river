/**
 * The River server, run by the app in its own Electron utility process when
 * the user hosts communities on this PC. Settings arrive as RIVER_* variables
 * (see main/host/host-manager.ts); the parent talks to it over parentPort.
 * A crash here never takes the app window down — the parent restarts it.
 */
import { loadConfig, startServer, type RunningServer } from '@river/server/embedded';
import type { FromServerProcess, ToServerProcess } from '../main/host/server-messages.ts';

const port = process.parentPort;
const send = (message: FromServerProcess): void => port.postMessage(message);

async function main(): Promise<void> {
  let server: RunningServer;
  try {
    server = await startServer(loadConfig(process.env));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    send({ type: 'failed', reason: code === 'EADDRINUSE' ? 'port-in-use' : 'error', message: String(err) });
    process.exit(1);
  }
  send({ type: 'ready', port: server.port });

  port.on('message', (event: { data: ToServerProcess }) => {
    const message = event.data;
    if (message.type === 'backup') {
      if (!server.backup) return send({ type: 'backup-done', id: message.id, error: 'not supported' });
      server.backup(message.path).then(
        () => send({ type: 'backup-done', id: message.id }),
        (err: unknown) => send({ type: 'backup-done', id: message.id, error: String(err) }),
      );
    } else if (message.type === 'stop') {
      void server.close().finally(() => process.exit(0));
    }
  });
}

void main();
