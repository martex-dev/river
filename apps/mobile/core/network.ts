/**
 * The phone's network came back or changed (2.12): Wi-Fi to mobile data, another Wi-Fi, out of a
 * tunnel. The old connection may then be dead without either side noticing until the heartbeat
 * gives up, and a reconnect waiting in its backoff may be up to 30 seconds away. `check` runs once
 * the change settles (a burst of changes runs it once), and not while the phone says it is
 * offline. The WebView reports `online` events (Android and iOS) and network changes
 * (`navigator.connection`, Android); the Android shell also wakes the core on a new network.
 */

interface Events {
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

export interface NetworkScope extends Events {
  navigator?: { onLine?: boolean; connection?: Events | null };
}

/** How long a network change may keep changing before the connection is checked. */
export const NETWORK_SETTLE_MS = 1_000;

export function watchNetwork(
  check: () => void,
  scope: NetworkScope = globalThis as NetworkScope,
  settleMs = NETWORK_SETTLE_MS,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const changed = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (scope.navigator?.onLine === false) return;
      try {
        check();
      } catch {
        // the next change, the watchdog or River coming to the front checks again
      }
    }, settleMs);
  };
  const subscriptions: Array<() => void> = [];
  const listen = (target: Events | null | undefined, type: string): void => {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, changed);
    subscriptions.push(() => target.removeEventListener?.(type, changed));
  };
  listen(scope, 'online');
  listen(scope.navigator?.connection, 'change');
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    for (const off of subscriptions.splice(0)) off();
  };
}
