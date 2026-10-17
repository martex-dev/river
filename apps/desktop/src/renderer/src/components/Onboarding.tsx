import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { IdentityInfo } from '../../../shared/ipc.ts';
import { ArrowIcon, CheckIcon, LockIcon } from './Icons.tsx';
import { RiverMark } from './RiverMark.tsx';
import { IdentityFingerprint } from './IdentityFingerprint.tsx';
import { RestoreForm } from './BackupPanel.tsx';
import { LinkThisDevice } from './LinkDevice.tsx';
import { useRiver } from '../store.ts';

type Step = 'welcome' | 'name' | 'creating' | 'username' | 'done' | 'restore' | 'link';

/** First run: create the user's cryptographic identity. No phone number, no e-mail. */
export function Onboarding(props: {
  reducedMotion: boolean;
  onCreated(identity: IdentityInfo): void;
  onFinished(): void;
}): ReactElement {
  // "Link this device again" (Settings → Account) opens straight on linking.
  const [step, setStep] = useState<Step>(() => useRiver.getState().onboardingStart);
  const [name, setName] = useState('');
  const [identity, setIdentity] = useState<IdentityInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [savingUser, setSavingUser] = useState(false);
  const [needsLink, setNeedsLink] = useState(false);
  const [link, setLink] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  // River's server only takes invited people: it said so when River tried to make the account.
  const needsInvite = useRiver((r) => r.account.state === 'none' && r.account.needsInvite === true);
  const askForLink = needsLink || needsInvite;

  // Once this device has an identity (being created, or made), a device link code no longer
  // fits here: it is left for River to explain once the first run is over.
  const hasIdentity = useRef(false);
  useEffect(() => {
    hasIdentity.current = identity !== null || step === 'creating' || step === 'username' || step === 'done';
  }, [identity, step]);

  // A device link code opened from outside (the camera app read the QR code on the other device).
  useEffect(() => {
    const take = (): void => {
      if (hasIdentity.current) return;
      void window.river.app.takeDeepLink('device').then((pending) => {
        if (!pending) return;
        // The identity appeared while the link was being taken: it cannot be used here any more.
        if (hasIdentity.current) {
          setError('That link code is for a device without River yet. Open it on the device you are adding.');
          return;
        }
        setDeviceCode(pending.link);
        setStep('link');
      });
    };
    take();
    return window.river.app.onDeepLink(take);
  }, []);

  useEffect(() => {
    if (step !== 'creating') return;
    let cancelled = false;
    const minimum = new Promise((r) => setTimeout(r, props.reducedMotion ? 0 : 1400));
    void Promise.all([window.river.identity.create(name), minimum])
      .then(([created]) => {
        if (cancelled) return;
        setIdentity(created);
        props.onCreated(created);
        setStep('username');
      })
      .catch(() => {
        if (cancelled) return;
        setError('River could not create your identity. Please try again.');
        setStep('name');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const submitName = (e: FormEvent): void => {
    e.preventDefault();
    if (name.trim().length > 64) return setError('Use 64 characters or fewer.');
    setError(null);
    setStep('creating');
  };

  // Your account is created automatically in the background; this gives it a @username people
  // use to find you. If the server is still connecting, River waits and tries again.
  const submitUsername = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSavingUser(true);
    setError(null);
    const deadline = Date.now() + 25_000;
    for (;;) {
      const res = await window.river.account.setUsername(username.trim());
      if (res.ok) {
        setSavingUser(false);
        setStep('done');
        return;
      }
      // No account yet. River's server only takes invited people: ask for a sign-up link.
      const account = await window.river.account.status();
      if (account.state === 'none' && account.needsInvite) {
        setSavingUser(false);
        setNeedsLink(true);
        setError(
          'River’s server only accepts people its owner invites. Paste the sign-up link they sent you, or skip for now.',
        );
        return;
      }
      // No server yet (you will host your own, or set one in Settings): let them move on.
      if (/create your account first|connect to your server first/i.test(res.message)) {
        setSavingUser(false);
        setError('You can choose your username in Settings → Account once your account is ready.');
        return;
      }
      const connecting = /reach the server|setting up/i.test(res.message);
      if (connecting && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      setSavingUser(false);
      setError(res.message);
      // Invite-only server: the person needs a sign-up link from whoever runs it.
      setNeedsLink(/only accepts people its owner invites/i.test(res.message));
      return;
    }
  };

  return (
    <div className="onboarding">
      <div className="onboarding__card glass" data-step={step}>
        {step === 'welcome' && (
          <>
            <div className="lock__mark">
              <RiverMark size={60} />
            </div>
            <h1 className="onboarding__title">Welcome to River</h1>
            <p className="lock__text">
              Private messages, communities and media — encrypted on your devices, never readable by any
              server.
            </p>
            <ul className="onboarding__points">
              <li>
                <CheckIcon size={16} /> No phone number or e-mail address needed
              </li>
              <li>
                <CheckIcon size={16} /> Your keys are created on this computer and stay on it
              </li>
              <li>
                <CheckIcon size={16} /> Open source — anyone can check how it works
              </li>
            </ul>
            <button className="btn btn--primary lock__submit" onClick={() => setStep('name')}>
              Create my identity <ArrowIcon size={16} />
            </button>
            <button className="btn btn--link" onClick={() => setStep('link')}>
              I already use River — link this device
            </button>
            <button className="btn btn--link" onClick={() => setStep('restore')}>
              Restore from a backup
            </button>
          </>
        )}

        {step === 'link' && (
          <LinkThisDevice
            key={deviceCode}
            initialCode={deviceCode}
            onBack={() => setStep('welcome')}
            onLinked={(linked) => {
              props.onCreated(linked);
              props.onFinished();
            }}
          />
        )}

        {step === 'restore' && (
          <RestoreForm
            onBack={() => setStep('welcome')}
            onRestored={() => {
              void window.river.identity.get().then((restored) => {
                if (restored) props.onCreated(restored);
                props.onFinished();
              });
            }}
          />
        )}

        {step === 'name' && (
          <form className="lock__form" onSubmit={submitName}>
            <h1 className="onboarding__title">What should people call you?</h1>
            <label className="textfield">
              <span className="field__label">Display name (optional)</span>
              <input
                type="text"
                autoFocus
                maxLength={80}
                placeholder="e.g. Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {error && (
              <p className="field__error" role="alert">
                {error}
              </p>
            )}
            <p className="muted small">
              Stored only on this computer for now. You can change it any time, and choose who sees it once
              accounts arrive.
            </p>
            <div className="button-row">
              <button type="button" className="btn btn--ghost" onClick={() => setStep('welcome')}>
                Back
              </button>
              <button type="submit" className="btn btn--primary">
                Continue <ArrowIcon size={16} />
              </button>
            </div>
          </form>
        )}

        {step === 'creating' && (
          <div className="keygen" role="status" aria-live="polite">
            <div className="keygen__orbit" aria-hidden="true">
              <span />
              <span />
              <span />
              <LockIcon size={26} />
            </div>
            <h1 className="onboarding__title">Creating your keys…</h1>
            <p className="lock__text">Generating an identity key pair on this computer.</p>
          </div>
        )}

        {step === 'username' && (
          <form className="lock__form" onSubmit={(e) => void submitUsername(e)}>
            <h1 className="onboarding__title">Pick a username</h1>
            <p className="lock__text">
              This is how friends find and add you — like <span className="mono">@alex</span>. Letters,
              numbers, <span className="mono">_</span> and <span className="mono">.</span>
            </p>
            <label className="textfield username-field">
              <span className="username-field__at" aria-hidden="true">
                @
              </span>
              <input
                type="text"
                autoFocus
                inputMode="text"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={32}
                placeholder="username"
                aria-label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/^@/, ''))}
              />
            </label>
            {error && (
              <p className="field__error" role="alert">
                {error}
              </p>
            )}
            {needsInvite && !error && (
              <p className="muted small" role="status">
                River’s server only accepts people its owner invites. Paste the sign-up link they sent you.
              </p>
            )}
            {askForLink && (
              <label className="textfield">
                <span className="field__label">Paste your sign-up link</span>
                <input
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://…/add#s=…"
                  spellCheck={false}
                />
              </label>
            )}
            <button type="button" className="btn btn--link" onClick={() => setStep('done')}>
              Skip for now — choose a username later
            </button>
            {askForLink ? (
              <button
                type="button"
                className="btn btn--primary lock__submit"
                disabled={savingUser || link.trim() === ''}
                onClick={() => {
                  setSavingUser(true);
                  setError(null);
                  void window.river.account.redeemSignup(link.trim()).then((res) => {
                    setSavingUser(false);
                    if (res.ok) setStep('done');
                    else setError(res.message);
                  });
                }}
              >
                {savingUser ? 'Setting up…' : 'Use sign-up link'} <ArrowIcon size={16} />
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn--primary lock__submit"
                disabled={savingUser || username.trim().length < 3}
              >
                {savingUser ? 'Setting up your account…' : 'Continue'} <ArrowIcon size={16} />
              </button>
            )}
          </form>
        )}

        {step === 'done' && identity && (
          <>
            <h1 className="onboarding__title">
              {identity.displayName ? `This is you, ${identity.displayName}` : 'This is your River identity'}
            </h1>
            <p className="lock__text">
              Your fingerprint is unique to your key. When you add contacts, you can compare these words to
              make sure nobody is in the middle.
            </p>
            <IdentityFingerprint identity={identity} />
            <button className="btn btn--primary lock__submit" onClick={props.onFinished}>
              Enter River <ArrowIcon size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
