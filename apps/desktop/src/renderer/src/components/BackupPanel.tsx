import { useEffect, useState, type ReactElement } from 'react';

/** Settings → Backup: recovery phrase and encrypted backup files. */
export function BackupPanel(): ReactElement {
  const [status, setStatus] = useState<{ hasPhrase: boolean; lastBackupAt: string | null } | null>(null);
  const [phrase, setPhrase] = useState<string[] | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = (): void => void window.river.backup.status().then(setStatus);
  useEffect(refresh, []);

  const create = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    const res = await window.river.backup.create();
    setBusy(false);
    if (!res.ok) setMessage({ text: res.message, ok: false });
    else if (res.value)
      setMessage({
        text: 'Backup saved. Keep the file and your recovery phrase in different places.',
        ok: true,
      });
    refresh();
  };

  return (
    <div className="panel">
      <h2 className="panel__title">Backup & recovery</h2>
      <p className="muted">
        If this computer is lost or replaced, a backup file plus your recovery phrase brings back your River
        ID, contacts, communities, messages and posts. Without the phrase the file is unreadable — to River's
        server, and to anyone else.
      </p>

      <div className="backup-step">
        <h3 className="card__title">1. Your recovery phrase</h3>
        <p className="muted small">
          18 words. Write them on paper and keep them somewhere safe. Anyone with these words and a backup
          file can become you; River will never ask you for them.
        </p>
        {phrase ? (
          <>
            <ol className="phrase" aria-label="Recovery phrase">
              {phrase.map((w, i) => (
                <li key={i}>
                  <span className="phrase__n">{i + 1}</span>
                  <span className="phrase__w">{w}</span>
                </li>
              ))}
            </ol>
            <button className="btn btn--ghost btn--small" onClick={() => setPhrase(null)}>
              Hide phrase
            </button>
          </>
        ) : (
          <button
            className="btn btn--ghost"
            onClick={() =>
              void window.river.backup.phrase().then((p) => {
                setPhrase(p);
                refresh();
              })
            }
          >
            {status?.hasPhrase ? 'Show recovery phrase' : 'Create my recovery phrase'}
          </button>
        )}
      </div>

      <div className="backup-step">
        <h3 className="card__title">2. Save a backup file</h3>
        <p className="muted small">
          {status?.lastBackupAt
            ? `Last backup: ${new Date(status.lastBackupAt).toLocaleString()}. Make a new one now and then — it only contains what existed when you made it.`
            : 'You have no backup yet.'}
        </p>
        <button className="btn btn--primary" disabled={busy} onClick={() => void create()}>
          {busy ? 'Encrypting…' : 'Save encrypted backup…'}
        </button>
        {message && (
          <p className={message.ok ? 'muted small' : 'field__error'} role="status">
            {message.text}
          </p>
        )}
      </div>

      <p className="muted small">
        To restore: install River on the new computer and choose <strong>Restore from a backup</strong> on the
        first screen. Files you received are referenced by the backup, not copied into it; recent ones can
        still be downloaded.
      </p>
    </div>
  );
}

/** First run: bring an identity back from a backup file and its recovery phrase. */
export function RestoreForm(props: { onBack(): void; onRestored(): void }): ReactElement {
  const [file, setFile] = useState<File | null>(null);
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const restore = async (): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await window.river.backup.restore(bytes, phrase);
    setBusy(false);
    if (!res.ok) setError(res.message);
    else props.onRestored();
  };

  return (
    <form
      className="lock__form"
      onSubmit={(e) => {
        e.preventDefault();
        void restore();
      }}
    >
      <h1 className="onboarding__title">Restore from a backup</h1>
      <label className="textfield">
        <span className="field__label">Backup file (.riverbackup)</span>
        <input type="file" accept=".riverbackup" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <label className="textfield">
        <span className="field__label">Recovery phrase (18 words)</span>
        <textarea
          className="restore__phrase"
          rows={3}
          spellCheck={false}
          autoComplete="off"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
      </label>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button type="button" className="btn btn--ghost" onClick={props.onBack}>
          Back
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy || !file || !phrase.trim()}>
          {busy ? 'Restoring…' : 'Restore'}
        </button>
      </div>
    </form>
  );
}
