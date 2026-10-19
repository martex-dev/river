import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { IdentityInfo, LinkedDevice, LinkProgress } from '../../../shared/ipc.ts';
import { isPhone } from '../../../shared/platform.ts';
import { useRiver } from '../store.ts';
import { ArrowIcon, CheckIcon } from './Icons.tsx';
import { QrCode } from './QrCode.tsx';
import { QrScanner } from './QrScanner.tsx';
import { rich, tr } from '../i18n.ts';

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
  const [name, setName] = useState(phone ? tr('My phone') : tr('My computer'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

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

  const join = async (value: string): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await window.river.account.link.join(value.trim(), name.trim());
    setBusy(false);
    if (!res.ok) setError(res.message);
  };
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    void join(code);
  };
  /** The QR code your other device shows (2.14): read with this device's camera, then "Is this you?". */
  const scanned = (text: string): true | string => {
    if (!/^river:\/\/link\?/i.test(text.trim())) return tr('That QR code is not a River link code.');
    setScanning(false);
    setCode(text.trim());
    void join(text);
    return true;
  };

  if (progress.state === 'review') {
    return (
      <div className="lock__form" role="alertdialog" aria-labelledby="link-review">
        <h1 className="onboarding__title" id="link-review">
          {tr('Is this you?')}
        </h1>
        <p className="lock__text">
          {rich(
            tr('This device is about to join the River account of {name} on {server} (River ID {id}…).'),
            {
              name: <strong>{progress.displayName}</strong>,
              server: <strong>{progress.server}</strong>,
              id: progress.riverId.slice(0, 8),
            },
          )}
        </p>
        <p className="muted small">
          {tr(
            'Only continue if it is your own account. If someone sent you this code, cancel: they would see everything you send from this device.',
          )}
        </p>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          <button className="btn btn--ghost" onClick={() => void window.river.account.link.cancel()}>
            {tr('Cancel')}
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
            {tr('Yes, link this device')} <ArrowIcon size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (progress.state === 'joining' || progress.state === 'linked') {
    return (
      <div className="lock__form" role="status" aria-live="polite">
        <h1 className="onboarding__title">
          {progress.state === 'linked' ? tr('Linked') : tr('Waiting for your other device…')}
        </h1>
        <p className="lock__text">
          {progress.state === 'linked'
            ? tr('This device now has your account, your communities and your conversations from here on.')
            : tr('Confirm on the device that shows the code. Keep River open on both.')}
        </p>
        {progress.state === 'joining' && (
          <button
            className="btn btn--ghost"
            onClick={() => {
              void window.river.account.link.cancel();
              props.onBack();
            }}
          >
            {tr('Cancel')}
          </button>
        )}
      </div>
    );
  }

  return (
    <form className="lock__form" onSubmit={submit}>
      <h1 className="onboarding__title">{tr('Link this device')}</h1>
      <p className="lock__text">
        {rich(
          tr(
            'On a device where you already use River, open {where} and choose {what}. Scan the QR code it shows, or type its code.',
          ),
          {
            where: <strong>{tr('Settings → Account → Devices')}</strong>,
            what: <strong>{tr('Link a new device')}</strong>,
          },
        )}
      </p>
      <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setScanning(true)}>
        📷 {tr('Scan the QR code')}
      </button>
      {scanning && (
        <QrScanner
          title={tr("Scan your other device's QR code")}
          hint={tr('On your other device: Settings → Account → Devices → Link a new device.')}
          onResult={scanned}
          onClose={() => setScanning(false)}
        />
      )}
      <label className="textfield">
        <span className="field__label">{tr('Link code')}</span>
        <input
          type="text"
          autoFocus
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <label className="textfield">
        <span className="field__label">{tr('Name for this device')}</span>
        <input type="text" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {linkServer && (
        <p className="card card--note small" role="note">
          {rich(
            tr(
              'This code links to an account on {server}. Only continue if you created it yourself on your own device just now — never with a code someone sent you.',
            ),
            { server: <strong>{linkServer}</strong> },
          )}
        </p>
      )}
      {failure && (
        <p className="field__error" role="alert">
          {failure}
        </p>
      )}
      <p className="muted small">
        {tr(
          'Your identity is handed over encrypted, from your other device to this one. The server cannot read it. Messages from before linking stay on your other device.',
        )}
      </p>
      <div className="button-row">
        <button type="button" className="btn btn--ghost" onClick={props.onBack}>
          {tr('Back')}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy || code.trim().length < 16}>
          {tr('Link')} <ArrowIcon size={16} />
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
  /** "Link a new device" or "Link it" is on its way (a second press would start over or publish twice). */
  const [busy, setBusy] = useState<'start' | 'confirm' | null>(null);

  const load = (): void => {
    void window.river.account.devices().then((res) => {
      if (res.ok) setDevices(res.value);
      else setError(res.message);
    });
  };
  useEffect(() => {
    if (registered) load();
  }, [registered]);
  // The list changes when a device was linked, or taken off again (it declined).
  useEffect(() => {
    if (registered && (progress.state === 'linked' || progress.state === 'failed')) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);
  const failure = error ?? (progress.state === 'failed' ? progress.message : null);

  if (!registered) return <></>;

  const start = async (): Promise<void> => {
    if (busy) return;
    setBusy('start');
    setError(null);
    setCopied(false);
    try {
      const res = await window.river.account.link.start();
      if (!res.ok) setError(res.message);
    } finally {
      setBusy(null);
    }
  };
  const confirm = async (): Promise<void> => {
    if (busy) return;
    setBusy('confirm');
    try {
      const res = await window.river.account.link.confirm();
      if (!res.ok) setError(res.message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (d: LinkedDevice): Promise<void> => {
    if (
      !window.confirm(
        tr(
          'Remove {name}? Your server signs it out at once and stops delivering to it. It keeps what it already received; if it was lost or stolen, also leave and rejoin communities you care about.',
          { name: d.name ?? tr('device {id}', { id: d.deviceId }) },
        ),
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
        {tr('Devices')}
      </h3>
      <p className="muted small">
        {tr(
          'Use the same account on your phone and your computers. Each device has its own keys; your messages reach all of them.',
        )}
      </p>
      {devices && (
        <ul className="devices__list">
          {devices.map((d) => (
            <li key={d.deviceId} className="devices__item">
              <span>
                <strong>
                  {d.current
                    ? `${tr('This device')}${d.name ? ` · ${d.name}` : ''}`
                    : (d.name ?? tr('Device {id}', { id: d.deviceId }))}
                </strong>
                <span className="muted small"> · {tr('linked {when}', { when: when(d.addedAt) })}</span>
              </span>
              {!d.current && (
                <button className="btn btn--ghost btn--small" onClick={() => void remove(d)}>
                  {tr('Remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {progress.state === 'offering' && (
        <div className="devices__offer" role="status" aria-live="polite">
          <p>
            {tr(
              'On the new device, choose “I already use River — link this device” and scan this QR code (or point a phone’s camera app at it). Or type the code below.',
            )}
          </p>
          <QrCode value={progress.code} label={tr('Link code as a QR code')} />
          <p className="devices__code mono" aria-label={tr('Link code')}>
            {progress.shortCode}
          </p>
          <p className="muted small">
            {tr('Or send yourself the whole link:')}{' '}
            <button
              className="btn btn--link"
              onClick={() => {
                void navigator.clipboard?.writeText(progress.code).then(() => setCopied(true));
              }}
            >
              {copied ? tr('Copied') : tr('Copy link')}
            </button>
          </p>
          <p className="muted small">
            {tr('The code works once, for ten minutes. Never give it to anyone else.')}
          </p>
          <button className="btn btn--ghost" onClick={() => void window.river.account.link.cancel()}>
            {tr('Cancel')}
          </button>
        </div>
      )}
      {progress.state === 'request' && (
        <div className="devices__offer" role="alertdialog" aria-labelledby="link-request">
          <p id="link-request">
            {rich(
              tr('Link {name} to your account? It will be able to read your new messages and act as you.'),
              {
                name: <strong>{progress.deviceName}</strong>,
              },
            )}
          </p>
          <div className="button-row">
            <button
              className="btn btn--ghost"
              disabled={busy === 'confirm'}
              onClick={() => void window.river.account.link.cancel()}
            >
              {tr('Don’t link')}
            </button>
            <button className="btn btn--primary" disabled={busy !== null} onClick={() => void confirm()}>
              <CheckIcon size={16} /> {tr('Link it')}
            </button>
          </div>
        </div>
      )}
      {/* Only on the device that added the new one, never on the new device itself. */}
      {progress.state === 'linked' && progress.deviceName && (
        <p className="muted small" role="status">
          {tr('Linked {name}. It is setting itself up.', { name: progress.deviceName })}
        </p>
      )}
      {progress.state !== 'offering' && progress.state !== 'request' && (
        <button className="btn" disabled={busy !== null} onClick={() => void start()}>
          {tr('Link a new device')}
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
