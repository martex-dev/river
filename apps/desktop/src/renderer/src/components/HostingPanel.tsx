import { useEffect, useState, type ReactElement } from 'react';
import type { HostStatus } from '../../../shared/ipc.ts';
import { play } from '../community/sound.ts';
import { useRiver } from '../store.ts';
import { tr } from '../i18n.ts';

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
      return tr('Off');
    case 'preparing':
      return s.progress !== undefined
        ? tr('Setting up your public address (one-time download, {percent}%)…', {
            percent: Math.round(s.progress * 100),
          })
        : tr('Setting up your public address (one-time download)…');
    case 'starting':
      return s.message ? tr(s.message) : tr('Starting…');
    case 'online':
      return tr('Online — members can reach your communities');
    case 'reconnecting':
      return s.message ? tr(s.message) : tr('Reconnecting…');
  }
}

function since(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? tr('today at {time}', { time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
    : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Settings → Hosting: keep communities online from this PC, for free. */
export function HostingPanel(): ReactElement {
  const status = useHostStatus();
  const keepAwake = useRiver((r) => r.settings?.hosting.keepAwake ?? true);
  const updateSettings = useRiver((r) => r.updateSettings);
  const linux = useRiver((r) => r.info?.platform === 'linux');
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

  if (!status) return <p className="muted small">{tr('Checking…')}</p>;
  const dot =
    status.state === 'online' ? 'status-dot--active' : status.state === 'off' ? '' : 'status-dot--warning';

  return (
    <section className="hosting" aria-labelledby="hosting-title">
      <h3 id="hosting-title" className="sr-only">
        {tr('Host on this PC')}
      </h3>
      <div className={`hosting__hero ${status.enabled ? 'is-on' : ''}`}>
        <div>
          <strong className="hosting__headline">{tr('Keep my communities online from this PC')}</strong>
          <p className="muted small">
            {tr(
              'Free, and no account anywhere. River runs your community server and gives it a public address. Your communities live on this PC: nothing is deleted when it restarts, and River backs them up every day.',
            )}
          </p>
        </div>
        <label className="toggle hosting__switch">
          <span className="sr-only">{tr('Host communities on this PC')}</span>
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
            <strong>{tr('Stop hosting?')}</strong>{' '}
            {tr(
              'Members can’t reach the communities on this PC until you turn hosting back on. Nothing is deleted.',
            )}
          </p>
          <div className="button-row">
            <button
              className="btn btn--danger btn--small"
              onClick={() => {
                setConfirmOff(false);
                void run('toggle', () => window.river.host.disable());
              }}
            >
              {tr('Stop hosting')}
            </button>
            <button className="btn btn--ghost btn--small" autoFocus onClick={() => setConfirmOff(false)}>
              {tr('Keep hosting')}
            </button>
          </div>
        </div>
      )}

      {!status.enabled && status.legacy !== 'none' && (
        <p className="hosting__note small">
          {status.legacy === 'running'
            ? tr(
                'River Host, the separate host from River 1.0.8, is set up on this PC and running. Turning this on moves your community into River — same members, same messages — and removes River Host. Its folder stays as a backup.',
              )
            : tr(
                'River Host, the separate host from River 1.0.8, is set up on this PC. Turning this on moves your community into River — same members, same messages — and removes River Host. Its folder stays as a backup.',
              )}
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
              aria-label={tr('Download progress')}
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
                {copied ? tr('Copied ✓') : tr('Copy address')}
              </button>
            </div>
          )}
          {status.via === 'tailscale' ? (
            <p className="muted small">
              ✓{' '}
              {tr('Permanent address, free through Tailscale. It never changes, and members stay connected.')}
            </p>
          ) : (
            <p className="muted small">
              {status.followable
                ? tr(
                    'This address changes every so often. Members’ River apps find the new one by themselves.',
                  )
                : tr('Address announcements are off, so members need the new address after a restart.')}
            </p>
          )}
          {status.via !== 'tailscale' && <PermanentAddress status={status} />}
          <div className="hosting__backup">
            <span className="small">
              {status.lastBackupAt
                ? tr('Last backup {when}', { when: since(status.lastBackupAt) })
                : tr('No backup yet')}
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
                {busy === 'backup' ? tr('Backing up…') : tr('Back up now')}
              </button>
              <button
                className="btn btn--ghost btn--small"
                onClick={() => void window.river.host.openFolder()}
              >
                {tr('Open hosting folder')}
              </button>
            </div>
          </div>
        </div>
      )}

      {status.enabled && (
        <>
          <label className="toggle">
            <span>
              <span className="toggle__label">{tr('Keep this PC awake while hosting')}</span>
              <span className="toggle__hint">
                {tr(
                  'Stops the PC from going to sleep by itself so members can always reach you. The screen can still turn off.',
                )}
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
            {linux
              ? tr(
                  'While hosting is on, River keeps running in the tray when you close the window. It does not start by itself when you sign in to Linux: open River after restarting this PC.',
                )
              : tr(
                  'While hosting is on, River starts with your PC and keeps running in the tray when you close the window.',
                )}{' '}
            {tr(
              'Members can always open River and write: if this PC is off, their messages wait on their devices and arrive when it is back.',
            )}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Steps to a permanent address (1.0.43): Tailscale Funnel gives this PC a free
 * https address that never changes and does not drop like the quick tunnel.
 */
function PermanentAddress({ status }: { status: HostStatus }): ReactElement | null {
  const [checking, setChecking] = useState(false);
  const check = (): void => {
    setChecking(true);
    void window.river.host.checkAddress().finally(() => setTimeout(() => setChecking(false), 1500));
  };
  if (status.needsApproval) {
    return (
      <div className="hosting__permanent" role="status">
        <strong>{tr('One last step: allow your permanent address')}</strong>
        <p className="small">{tr('Tailscale asks you once to allow a public address for this PC.')}</p>
        <div className="button-row">
          <button
            className="btn btn--primary btn--small"
            onClick={() => void window.river.host.approveAddress()}
          >
            {tr('Allow in Tailscale')}
          </button>
        </div>
      </div>
    );
  }
  if (status.permanent === 'ready' && status.permanentProblem) {
    // Never "Switching…" while nothing is switching: say what went wrong and what River does now.
    return (
      <div className="hosting__permanent" role="status">
        <strong>{tr('Your permanent address is not working yet')}</strong>
        <p className="small">
          {tr(status.permanentProblem)}{' '}
          {tr(
            'Members still reach you at the changing address above; River tries the permanent one again every few minutes. In Tailscale, check that Funnel and HTTPS are allowed for this PC.',
          )}
        </p>
        <div className="button-row">
          <button className="btn btn--ghost btn--small" disabled={checking} onClick={check}>
            {checking ? tr('Checking…') : tr('Try again now')}
          </button>
        </div>
      </div>
    );
  }
  if (status.permanent === 'ready') {
    return (
      <div className="hosting__permanent" role="status">
        <strong>{tr('Switching to your permanent address…')}</strong>
        <p className="small">{tr('Tailscale is signed in. This can take a minute the first time.')}</p>
      </div>
    );
  }
  return (
    <div className="hosting__permanent">
      <strong>{tr('Get a permanent address — free')}</strong>
      <p className="small">
        {tr(
          'Calls and chats stay connected, and your invite links always work. Only this PC needs it; members install nothing extra.',
        )}
      </p>
      <ol className="hosting__steps small">
        <li className={status.permanent === 'signed-out' ? 'is-done' : ''}>
          {tr('Install Tailscale (free).')}{' '}
          {status.permanent !== 'signed-out' && (
            <button
              className="btn btn--link btn--small"
              onClick={() => void window.river.links.open('tailscale')}
            >
              {tr('Download Tailscale')}
            </button>
          )}
        </li>
        <li>{tr('Open Tailscale and sign in — Google, Microsoft or GitHub all work.')}</li>
        <li>{tr("That's it: River switches over by itself.")}</li>
      </ol>
      <div className="button-row">
        <button className="btn btn--ghost btn--small" disabled={checking} onClick={check}>
          {checking ? tr('Checking…') : tr('I did it — check now')}
        </button>
      </div>
    </div>
  );
}
