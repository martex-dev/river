import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import type { StorageStatus } from '../../../shared/ipc.ts';
import { LockIcon } from './Icons.tsx';
import { RiverMark } from './RiverMark.tsx';

/**
 * Shown when River's local data needs a passphrase: either to create one (no
 * OS keyring available) or to unlock. Also shows unrecoverable storage errors.
 */
export function LockScreen({ status }: { status: StorageStatus }): ReactElement | null {
  if (status.state === 'setup-required') return <SetupPassphrase minLength={status.minLength} />;
  if (status.state === 'locked') return <Unlock />;
  if (status.state === 'error') {
    return (
      <Shell title="River can’t open its local data">
        <p className="lock__text" role="alert">
          {status.message}
        </p>
      </Shell>
    );
  }
  return null;
}

function Shell({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className="lock">
      <div className="lock__card glass">
        <div className="lock__mark">
          <RiverMark size={52} />
        </div>
        <h1 className="lock__title">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function SetupPassphrase({ minLength }: { minLength: number }): ReactElement {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (passphrase.length < minLength) return setError(`Use at least ${minLength} characters.`);
    if (passphrase !== confirm) return setError('The passphrases do not match.');
    setBusy(true);
    setError(null);
    const result = await window.river.storage.setupPassphrase(passphrase);
    setBusy(false);
    if (!result.ok)
      setError(result.reason === 'too-short' ? `Use at least ${minLength} characters.` : 'Please try again.');
  };

  return (
    <Shell title="Protect River with a passphrase">
      <p className="lock__text">
        This computer has no system keyring River can use, so River will encrypt its local data with a
        passphrase you choose. You will enter it each time River starts.
      </p>
      <form className="lock__form" onSubmit={(e) => void submit(e)}>
        <label className="textfield">
          <span className="field__label">Passphrase</span>
          <input
            type="password"
            autoComplete="new-password"
            autoFocus
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>
        <label className="textfield">
          <span className="field__label">Repeat passphrase</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <p className="muted small">
          A few unrelated words make a strong passphrase. If you forget it, River’s local data on this
          computer cannot be recovered.
        </p>
        <button className="btn btn--primary lock__submit" type="submit" disabled={busy}>
          <LockIcon size={16} /> {busy ? 'Encrypting…' : 'Set passphrase'}
        </button>
      </form>
    </Shell>
  );
}

function Unlock(): ReactElement {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await window.river.storage.unlock(passphrase);
    setBusy(false);
    if (!result.ok) {
      setError(
        result.reason === 'wrong-passphrase' ? 'That passphrase is not correct.' : 'Please try again.',
      );
      setPassphrase('');
    }
  };

  return (
    <Shell title="Unlock River">
      <p className="lock__text">Enter your passphrase to decrypt River’s local data.</p>
      <form className="lock__form" onSubmit={(e) => void submit(e)}>
        <label className="textfield">
          <span className="field__label">Passphrase</span>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--primary lock__submit" type="submit" disabled={busy || passphrase === ''}>
          <LockIcon size={16} /> {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </Shell>
  );
}
