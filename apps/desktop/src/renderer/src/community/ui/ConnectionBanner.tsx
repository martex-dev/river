import { useEffect, useState, type ReactElement } from 'react';
import { useCommunity } from '../store.ts';

/** Banners wait this long so a quick blip doesn't flash on screen. */
const GRACE_MS = 1500;

/**
 * Tells you when River lost its connection, counts down to the next attempt,
 * and lets you retry now. Hidden while everything is fine.
 */
export function ConnectionBanner(): ReactElement | null {
  const connection = useCommunity((s) => s.connection);
  const retryAt = useCommunity((s) => s.retryAt);
  const since = useCommunity((s) => s.connectionSince);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (connection === 'online') return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [connection]);

  if (connection === 'online' || now - since < GRACE_MS) return null;
  const seconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  return (
    <div className={`connection-banner connection-banner--${connection}`} role="status">
      <span className="connection-banner__dot" aria-hidden="true" />
      <span>
        {connection === 'connecting'
          ? 'Reconnecting to your River server…'
          : seconds > 0
            ? `You're offline. Trying again in ${seconds}s.`
            : "You're offline. Trying again…"}{' '}
        <span className="muted small">Messages you send will wait and go out when you're back.</span>
      </span>
      {connection === 'offline' && (
        <button
          className="btn btn--ghost btn--small"
          onClick={() => void window.river.community.action({ a: 'reconnect' })}
        >
          Retry now
        </button>
      )}
    </div>
  );
}

/** When the operating system says the network is back, reconnect right away. */
export function NetworkWatcher(): null {
  useEffect(() => {
    const onOnline = (): void => void window.river.community.action({ a: 'reconnect' });
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);
  return null;
}
