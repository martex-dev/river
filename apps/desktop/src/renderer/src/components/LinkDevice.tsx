import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { IdentityInfo, LinkedDevice, LinkProgress } from '../../../shared/ipc.ts';
import { isPhone } from '../../../shared/platform.ts';
import { useRiver } from '../store.ts';
import { ArrowIcon, CheckIcon } from './Icons.tsx';
import { QrCode } from './QrCode.tsx';

/** Live link progress from the client core. */
function useLinkProgress(): LinkProgress {
  const [progress, setProgress] = useState<LinkProgress>({ state: 'idle' });
  useEffect(() => {
    void window.river.account.link.status().then(setProgress);
    return window.river.account.link.onStatus(setProgress);
  }, []);
  return progress;
}

const when = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/**
 * First run, "I already use River": this device joins an existing account with the code shown
 * on a device that is already linked (Settings → Account → Devices → Link a new device).
 */
export function LinkThisDevice(props: {
  /** A link code that arrived from outside (river://link?…), filled in for the person to confirm. */
  initialCode?: string;
  onBack(): void;
  onLinked(identity: IdentityInfo): void;
}): ReactElement {
  const phone = useRiver((r) => isPhone(r.info?.platform));
  const progress = useLinkProgress();
  const [code, setCode] = useState(props.initialCode ?? '');
  const [name, setName] = useState(phone ? 'My phone' : 'My computer');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const failure = error ?? (progress.state === 'failed' ? progress.message : null);
  // A whole link names the server whose account this device would join: show it before joining.
  const linkServer = ((): string | null => {
    const text = code.trim();
    if (!text.startsWith('river:')) return null;
    try {
      const server = new URL(text).searchParams.get('s');
      return server ? new URL(server).host : null;
    } catch {
      return null;
    }
  })();
  useEffect(() => {
    if (progress.state !== 'linked') return;
    void window.river.identity.get().then((identity) => {
      if (identity) props.onLinked(identity);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await window.river.account.link.join(code.trim(), name.trim());
    setBusy(false);
    if (!res.ok) setError(res.message);
  };

  if (progress.state === 'review') {
    return (
      <div className="lock__form" role="alertdialog" aria-labelledby="link-review">
        <h1 className="onboarding__title" id="link-review">
          Is this you?
        </h1>
        <p className="lock__text">
          This device is about to join the River account of <strong>{progress.displayName}</strong> on{' '}
          <strong>{progress.server}</strong> (River ID {progress.riverId.slice(0, 8)}…).
        </p>
        <p className="muted small">
          Only continue if it is your own account. If someone sent you this code, cancel: they would see
          everything you send from this device.
        </p>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button className="btn btn--ghost" onClick={() => void window.river.account.link.cancel()}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void window.river.account.link.accept().then((res) => {
                setBusy(false);
                if (!res.ok) setError(res.message);
              });
            }}
          >
            Yes, link this device <ArrowIcon size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (progress.state === 'joining' || progress.state === 'linked') {
    return (
      <div className="lock__form" role="status" aria-live="polite">
        <h1 className="onboarding__title">
          {progress.state === 'linked' ? 'Linked' : 'Waiting for your other device…'}
        </h1>
        <p className="lock__text">
          {progress.state === 'linked'
            ? 'This device now has your account, your communities and your conversations from here on.'
            : 'Confirm on the device that shows the code. Keep River open on both.'}
        </p>
        {progress.state === 'joining' && (
          <button
            className="btn btn--ghost"
            onClick={() => {
              void window.river.account.link.cancel();
              props.onBack();
            }}
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  return (
    <form className="lock__form" onSubmit={(e) => void submit(e)}>
      <h1 className="onboarding__title">Link this device</h1>
      <p className="lock__text">
        On a device where you already use River, open <strong>Settings → Account → Devices</strong> and choose{' '}
        <strong>Link a new device</strong>. Enter the code it shows.
      </p>
      <label className="textfield">
        <span className="field__label">Link code</span>
        <input
          type="text"
          autoFocus
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX-XXXX or river://link?…"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <label className="textfield">
        <span className="field__label">Name for this device</span>
        <input type="text" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {linkServer && (
        <p className="card card--note small" role="note">
          This code links to an account on <strong>{linkServer}</strong>. Only continue if you created it
          yourself on your own device just now — never with a code someone sent you.
        </p>
      )}
      {failure && (
        <p className="field__error" role="alert">
          {failure}
        </p>
      )}
      <p className="muted small">
        Your identity is handed over encrypted, from your other device to this one. The server cannot read it.
        Messages from before linking stay on your other device.
      </p>
      <div className="button-row">
        <button type="button" className="btn btn--ghost" onClick={props.onBack}>
          Back
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy || code.trim().length < 16}>
          Link <ArrowIcon size={16} />
        </button>
      </div>
    </form>
  );
}

/** Settings → Account → Devices: this account's devices, and linking a new one. */
export function DevicesPanel(): ReactElement {
  const registered = useRiver((r) => r.account.state === 'registered');
  const progress = useLinkProgress();
  const [devices, setDevices] = useState<LinkedDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = (): void => {
    void window.river.account.devices().then((res) => {
      if (res.ok) setDevices(res.value);
      else setError(res.message);
    });
  };
  useEffect(() => {
    if (registered) load();
  }, [registered]);
  useEffect(() => {
    if (progress.state === 'linked') load();
  }, [progress]);
  const failure = error ?? (progress.state === 'failed' ? progress.message : null);

  if (!registered) return <></>;

  const start = async (): Promise<void> => {
    setError(null);
    setCopied(false);
    const res = await window.river.account.link.start();
    if (!res.ok) setError(res.message);
  };
  const confirm = async (): Promise<void> => {
    const res = await window.river.account.link.confirm();
    if (!res.ok) setError(res.message);
  };
  const remove = async (d: LinkedDevice): Promise<void> => {
    if (
      !window.confirm(
        `Remove device ${d.deviceId}? Your server signs it out at once and stops delivering to it. ` +
          'It keeps what it already received; if it was lost or stolen, also leave and rejoin communities you care about.',
      )
    )
      return;
    const res = await window.river.account.removeDevice(d.deviceId);
    if (res.ok) load();
    else setError(res.message);
  };

  return (
    <section className="card devices" aria-labelledby="devices-title">
      <h3 id="devices-title" className="card__title">
        Devices
      </h3>
      <p className="muted small">
        Use the same account on your phone and your computers. Each device has its own keys; your messages
        reach all of them.
      </p>
      {devices && (
        <ul className="devices__list">
          {devices.map((d) => (
            <li key={d.deviceId} className="devices__item">
              <span>
                <strong>{d.current ? 'This device' : `Device ${d.deviceId}`}</strong>
                <span className="muted small"> · linked {when(d.addedAt)}</span>
              </span>
              {!d.current && (
                <button className="btn btn--ghost btn--small" onClick={() => void remove(d)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {progress.state === 'offering' && (
        <div className="devices__offer" role="status" aria-live="polite">
          <p>
            New phone: scan this with its camera. Another computer: choose “I already use River — link this
            device” and enter the code below.
          </p>
          <QrCode value={progress.code} label="Link code as a QR code" />
          <p className="devices__code mono" aria-label="Link code">
            {progress.shortCode}
          </p>
          <p className="muted small">
            Or send yourself the whole link:{' '}
            <button
              className="btn btn--link"
              onClick={() => {
                void navigator.clipboard?.writeText(progress.code).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </p>
          <p className="muted small">The code works once, for ten minutes. Never give it to anyone else.</p>
          <button className="btn btn--ghost" onClick={() => void window.river.account.link.cancel()}>
            Cancel
          </button>
        </div>
      )}
      {progress.state === 'request' && (
        <div className="devices__offer" role="alertdialog" aria-labelledby="link-request">
          <p id="link-request">
            Link <strong>{progress.deviceName}</strong> to your account? It will be able to read your new
            messages and act as you.
          </p>
          <div className="button-row">
            <button className="btn btn--ghost" onClick={() => void window.river.account.link.cancel()}>
              Don’t link
            </button>
            <button className="btn btn--primary" onClick={() => void confirm()}>
              <CheckIcon size={16} /> Link it
            </button>
          </div>
        </div>
      )}
      {progress.state === 'linked' && (
        <p className="muted small">Linked. The new device is setting itself up.</p>
      )}
      {progress.state !== 'offering' && progress.state !== 'request' && (
        <button className="btn" onClick={() => void start()}>
          Link a new device
        </button>
      )}
      {failure && (
        <p className="field__error" role="alert">
          {failure}
        </p>
      )}
    </section>
  );
}
