import { installWorkerTimers, type WorkerLike } from './timers.ts';

// The core's WebView is never shown: its own timers would be slowed to about one a minute.
const WorkerClass = (globalThis as { Worker?: new (url: string) => WorkerLike }).Worker;
if (typeof WorkerClass === 'function') {
  void installWorkerTimers(() => new WorkerClass('./timer-worker.js'));
}
