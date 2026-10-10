import { useEffect, useState, type ReactElement } from 'react';
import type { HostStatus } from '../../../shared/ipc.ts';
import { play } from '../community/sound.ts';
import { useRiver } from '../store.ts';

/** Live hosting status from main (pushed on every change). */
export function useHostStatus(): HostStatus | null {
  const [status, setStatus] = useState<HostStatus | null>(null);
  useEffect(() => {
    let stop = false;
    void window.river.host.status().then((s) => {
      if (!stop) setStatus(s);
    });
    const off = window.river.host.onStatus(setStatus);
    return () => {
      stop = true;
      off();
    };
  }, []);
  return status;
}

/** One line on what hosting is doing, for people rather than engineers. */
export function describeHost(s: HostStatus): string {
  switch (s.state) {
    case 'off':
      return 'Off';
    case 'preparing':
      return `Setting up your public address (one-time download${
        s.progress !== undefined ? `, ${Math.round(s.progress * 100)}%` : ''
      })…`;
    case 'starting':
      return s.message ?? 'Starting…';
    case 'online':
      return 'Online — members can reach your communities';
    case 'reconnecting':
      return s.message ?? 'Reconnecting…';
  }
}

function since(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Settings → Hosting: keep communities online from this PC, for free. */
export function HostingPanel(): ReactElement {
  const status = useHostStatus();
  const keepAwake = useRiver((r) => r.settings?.hosting.keepAwake ?? true);
  const updateSettings = useRiver((r) => r.updateSettings);
  const [busy, setBusy] = useState<'toggle' | 'backup' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const run = async (
    kind: 'toggle' | 'backup',
    fn: () => Promise<{ ok: true } | { ok: false; message: string }>,
  ): Promise<boolean> => {
    setBusy(kind);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) {
      play('error');
      setError(res.message);
      return false;
    }
    return true;
  };

  if (!status) return <p className="muted small">Checking…</p>;
  const dot =
    status.state === 'online' ? 'status-dot--active' : status.state === 'off' ? '' : 'status-dot--warning';

  return (
    <section className="hosting" aria-labelledby="hosting-title">
      <h3 id="hosting-title" className="sr-only">
        Host on this PC
      </h3>
      <div className={`hosting__hero ${status.enabled ? 'is-on' : ''}`}>
        <div>
          <strong className="hosting__headline">Keep my communities online from this PC</strong>
          <p className="muted small">
            Free, and no account anywhere. River runs your community server and gives it a public address.
            Your communities live on this PC: nothing is deleted when it restarts, and River backs them up
            every day.
          </p>
        </div>
        <label className="toggle hosting__switch">
          <span className="sr-only">Host communities on this PC</span>
          <input
            type="checkbox"
            role="switch"
            checked={status.enabled}
            disabled={busy !== null}
            onChange={(e) => {
              if (e.target.checked) {
                void run('toggle', () => window.river.host.enable()).then((ok) => {
                  if (ok) play('success');
                });
              } else {
                setConfirmOff(true);
              }
            }}
          />
          <span className="toggle__track" aria-hidden="true">
            <span className="toggle__thumb" />
          </span>
        </label>
      </div>

      {error && (
        <div className="card card--error" role="alert">
          {error}
        </div>
      )}

      {confirmOff && (
        <div className="hosting__confirm" role="alertdialog" aria-labelledby="hosting-off-title">
          <p id="hosting-off-title">
            <strong>Stop hosting?</strong> Members can’t reach the communities on this PC until you turn
            hosting back on. Nothing is deleted.
          </p>
          <div className="button-row">
            <button
              className="btn btn--danger btn--small"
              onClick={() => {
                setConfirmOff(false);
                void run('toggle', () => window.river.host.disable());
              }}
            >
              Stop hosting
            </button>
            <button className="btn btn--ghost btn--small" autoFocus onClick={() => setConfirmOff(false)}>
              Keep hosting
            </button>
          </div>
        </div>
      )}

      {!status.enabled && status.legacy !== 'none' && (
        <p className="hosting__note small">
          River Host, the separate host from River 1.0.8, is set up on this PC
          {status.legacy === 'running' ? ' and running' : ''}. Turning this on moves your community into River
          — same members, same messages — and removes River Host. Its folder stays as a backup.
        </p>
      )}

      {status.enabled && (
        <div className="hosting__card" aria-live="polite">
          <p className="hosting__state">
            <span className={`status-dot ${dot}`} aria-hidden="true" />
            {describeHost(status)}
          </p>
          {status.state === 'preparing' && status.progress !== undefined && (
            <progress
              className="hosting__progress"
              value={status.progress}
              max={1}
              aria-label="Download progress"
            />
          )}
          {status.address && (
            <div className="hosting__address">
              <code>{status.address}</code>
              <button
                className="btn btn--ghost btn--small"
                onClick={() =>
                  void navigator.clipboard.writeText(status.address!).then(() => {
                    play('success');
                    setCopied(true);
                  })
                }
              >
                {copied ? 'Copied ✓' : 'Copy address'}
              </button>
            </div>
          )}
          <p className="muted small">
            {status.followable
              ? 'The address changes when this PC restarts. Members’ River apps find the new one by themselves.'
              : 'Address announcements are off, so members need the new address after a restart.'}
          </p>
          <div className="hosting__backup">
            <span className="small">
              {status.lastBackupAt ? `Last backup ${since(status.lastBackupAt)}` : 'No backup yet'}
            </span>
            <div className="button-row">
              <button
                className="btn btn--ghost btn--small"
                disabled={busy !== null || status.state === 'off'}
                onClick={() =>
                  void run('backup', () => window.river.host.backupNow()).then((ok) => {
                    if (ok) play('success');
                  })
                }
              >
                {busy === 'backup' ? 'Backing up…' : 'Back up now'}
              </button>
              <button
                className="btn btn--ghost btn--small"
                onClick={() => void window.river.host.openFolder()}
              >
                Open hosting folder
              </button>
            </div>
          </div>
        </div>
      )}

      {status.enabled && (
        <>
          <label className="toggle">
            <span>
              <span className="toggle__label">Keep this PC awake while hosting</span>
              <span className="toggle__hint">
                Stops the PC from going to sleep by itself so members can always reach you. The screen can
                still turn off.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={keepAwake}
              onChange={(e) => void updateSettings({ hosting: { keepAwake: e.target.checked } })}
            />
            <span className="toggle__track" aria-hidden="true">
              <span className="toggle__thumb" />
            </span>
          </label>
          <p className="muted small">
            While hosting is on, River starts with your PC and keeps running in the tray when you close the
            window. Members can always open River and write: if this PC is off, their messages wait on their
            devices and arrive when it is back.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Turns hosting on (if needed) and resolves once the public address answers.
 * `onUpdate` sees each step, for a progress line.
 */
export async function hostAndWait(
  onUpdate: (s: HostStatus) => void,
  timeoutMs = 3 * 60_000,
): Promise<{ ok: true; address: string } | { ok: false; message: string }> {
  const current = await window.river.host.status();
  if (!current.enabled) {
    const res = await window.river.host.enable();
    if (!res.ok) return res;
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: { ok: true; address: string } | { ok: false; message: string }): void => {
      if (done) return;
      done = true;
      off();
      clearTimeout(timer);
      resolve(r);
    };
    const check = (s: HostStatus): void => {
      onUpdate(s);
      if (s.state === 'online' && s.address) finish({ ok: true, address: s.address });
    };
    const off = window.river.host.onStatus(check);
    const timer = setTimeout(
      () =>
        void window.river.host.status().then((s) =>
          finish({
            ok: false,
            message: `Your public address is not ready yet (${describeHost(s)}). River keeps trying in the background — try again in a minute.`,
          }),
        ),
      timeoutMs,
    );
    void window.river.host.status().then(check);
  });
}
