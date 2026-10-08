import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { IdentityInfo } from '../../../shared/ipc.ts';
import { ArrowIcon, CheckIcon, LockIcon } from './Icons.tsx';
import { RiverMark } from './RiverMark.tsx';
import { IdentityFingerprint } from './IdentityFingerprint.tsx';

type Step = 'welcome' | 'name' | 'creating' | 'done';

/** First run: create the user's cryptographic identity. No phone number, no e-mail. */
export function Onboarding(props: {
  reducedMotion: boolean;
  onCreated(identity: IdentityInfo): void;
  onFinished(): void;
}): ReactElement {
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('');
  const [identity, setIdentity] = useState<IdentityInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 'creating') return;
    let cancelled = false;
    const minimum = new Promise((r) => setTimeout(r, props.reducedMotion ? 0 : 1400));
    void Promise.all([window.river.identity.create(name), minimum])
      .then(([created]) => {
        if (cancelled) return;
        setIdentity(created);
        props.onCreated(created);
        setStep('done');
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
          </>
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
