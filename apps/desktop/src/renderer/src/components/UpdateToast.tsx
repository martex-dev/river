import { useState, type ReactElement } from 'react';
import { useRiver } from '../store.ts';

/** Surfaces update states that need the user: ready to install, manual download, or failed verification. */
export function UpdateToast(): ReactElement | null {
  const update = useRiver((s) => s.update);
  const navigate = useRiver((s) => s.navigate);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const key = 'version' in update ? `${update.state}:${update.version}` : `${update.state}`;
  if (dismissed === key) return null;

  let body: ReactElement | null = null;
  if (update.state === 'ready') {
    body = (
      <>
        <div>
          <strong>River {update.version} is ready</strong>
          <p>Downloaded and signature-verified.</p>
        </div>
        <button className="btn btn--primary btn--small" onClick={() => void window.river.updates.install()}>
          Restart
        </button>
      </>
    );
  } else if (update.state === 'manual') {
    body = (
      <>
        <div>
          <strong>River {update.version} is available</strong>
          <p>Download it from the release page.</p>
        </div>
        <button
          className="btn btn--primary btn--small"
          onClick={() => void window.river.updates.openDownloadPage()}
        >
          Download
        </button>
      </>
    );
  } else if (update.state === 'error' && update.code === 'verification-failed') {
    body = (
      <>
        <div>
          <strong>Update blocked</strong>
          <p>A downloaded update failed signature verification and was not installed.</p>
        </div>
        <button className="btn btn--ghost btn--small" onClick={() => navigate('settings')}>
          Details
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
      <button className="toast__close" aria-label="Dismiss" onClick={() => setDismissed(key)}>
        ×
      </button>
    </div>
  );
}
