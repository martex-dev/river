import { useState, type ReactElement } from 'react';
import { tr } from '../i18n.ts';
import { useRiver } from '../store.ts';

/**
 * Surfaces update states that need the user: ready to install, manual download, failed verification,
 * or (Android) an update that only a fresh install can bring.
 */
export function UpdateToast(): ReactElement | null {
  const update = useRiver((s) => s.update);
  const openSettings = useRiver((s) => s.openSettings);
  // River for Android: Android's own installer replaces the app (there is no restart).
  const android = useRiver((s) => s.info?.platform === 'android');
  const [dismissed, setDismissed] = useState<string | null>(null);

  const key = 'version' in update ? `${update.state}:${update.version}` : `${update.state}`;
  if (dismissed === key) return null;

  let body: ReactElement | null = null;
  if (update.state === 'ready' && android) {
    body = (
      <>
        <div>
          <strong>{tr('River {version} is ready', { version: update.version })}</strong>
          <p>
            {update.needsPermission
              ? tr('Allow River to install updates in Android’s settings, then tap Install.')
              : tr('Downloaded and signature-verified. Android asks you to confirm.')}
          </p>
        </div>
        <button className="btn btn--primary btn--small" onClick={() => void window.river.updates.install()}>
          {tr('Install')}
        </button>
      </>
    );
  } else if (update.state === 'reinstall-needed') {
    body = (
      <>
        <div>
          <strong>{tr('River {version} needs a fresh install', { version: update.version })}</strong>
          <p>
            {tr('It is signed with a new key, so it cannot replace this River. Back up before uninstalling.')}
          </p>
        </div>
        <button className="btn btn--ghost btn--small" onClick={() => openSettings('updates')}>
          {tr('Details')}
        </button>
      </>
    );
  } else if (update.state === 'ready') {
    body = (
      <>
        <div>
          <strong>{tr('River {version} is ready', { version: update.version })}</strong>
          <p>{tr('Downloaded and signature-verified.')}</p>
        </div>
        <button className="btn btn--primary btn--small" onClick={() => void window.river.updates.install()}>
          {tr('Restart')}
        </button>
      </>
    );
  } else if (update.state === 'manual') {
    body = (
      <>
        <div>
          <strong>{tr('River {version} is available', { version: update.version })}</strong>
          <p>{tr('Download it from the release page.')}</p>
        </div>
        <button
          className="btn btn--primary btn--small"
          onClick={() => void window.river.updates.openDownloadPage()}
        >
          {tr('Download')}
        </button>
      </>
    );
  } else if (
    update.state === 'error' &&
    (update.code === 'verification-failed' || update.code === 'manifest-unverified')
  ) {
    body = (
      <>
        <div>
          <strong>{tr('Update blocked')}</strong>
          <p>{tr('A downloaded update failed signature verification and was not installed.')}</p>
        </div>
        <button className="btn btn--ghost btn--small" onClick={() => openSettings('updates')}>
          {tr('Details')}
        </button>
      </>
    );
  }
  if (!body) return null;

  return (
    <div
      className={`toast ${update.state === 'error' ? 'toast--danger' : ''}`}
      role="status"
      aria-live="polite"
    >
      {body}
      <button className="toast__close" aria-label={tr('Dismiss')} onClick={() => setDismissed(key)}>
        ×
      </button>
    </div>
  );
}
