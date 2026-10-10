/** Messages between the app and the server's utility process (src/host/server-process.ts). */
export type ToServerProcess = { type: 'backup'; id: number; path: string } | { type: 'stop' };

export type FromServerProcess =
  | { type: 'ready'; port: number }
  | { type: 'failed'; reason: 'port-in-use' | 'error'; message: string }
  | { type: 'backup-done'; id: number; error?: string };
