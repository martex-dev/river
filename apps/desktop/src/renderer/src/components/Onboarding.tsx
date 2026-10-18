import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { IdentityInfo } from '../../../shared/ipc.ts';
import { isPhone } from '../../../shared/platform.ts';
import { applyFirstRunLook } from '../appearance/first-look.ts';
import { AvatarCropDialog, keepAnimated } from '../community/ui/AvatarCrop.tsx';
import { joinWithLink } from '../community/ui/StartScreen.tsx';
import { useCommunity } from '../community/store.ts';
import { phoneShowCommunity } from '../phone/nav.ts';
import { useRiver, type Section } from '../store.ts';
import { ArrowIcon, LockIcon } from './Icons.tsx';
import { RiverMark } from './RiverMark.tsx';
import { RestoreForm } from './BackupPanel.tsx';
import { LinkThisDevice } from './LinkDevice.tsx';

type Step = 'start' | 'creating' | 'restore' | 'link';

/**
 * First run (2.14): one screen. A name (and a photo, if you like), then River sets up your
 * identity and your account by itself — no phone number, no e-mail, no server address. A
 * @username, a different look and a backup are offered later, when they are useful, and never
 * stand in the way. Opened from an invite link, the same screen joins that community too.
 */
export function Onboarding(props: {
  onCreated(identity: IdentityInfo): void;
  onFinished(section?: Section): void;
}): ReactElement {
  // "Link this device again" (Settings → Account) opens straight on linking.
  const [step, setStep] = useState<Step>(() =>
    useRiver.getState().onboardingStart === 'link' ? 'link' : 'start',
  );
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  /** An invite link opened from outside River (the invite page's "Open in River"). */
  const [invite, setInvite] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Once this device has an identity (being created, or made), links opened from outside are
  // left for River to offer once the first run is over (a device link code no longer fits).
  const hasIdentity = useRef(false);
  useEffect(() => {
    hasIdentity.current = step === 'creating';
  }, [step]);

  // A device link code (the camera read the QR code on the other device), or an invite.
  useEffect(() => {
    const take = (): void => {
      if (hasIdentity.current) return;
      void (async () => {
        const device = await window.river.app.takeDeepLink('device');
        if (device) {
          // The identity appeared while the link was being taken: it cannot be used here any more.
          if (hasIdentity.current) {
            setError(
              'That link code is for a device without River yet. Open it on the device you are adding.',
            );
            return;
          }
          setDeviceCode(device.link);
          setStep('link');
          return;
        }
        if (hasIdentity.current) return;
        const invited = await window.river.app.takeDeepLink('invite');
        if (invited) setInvite(invited.link);
      })();
    };
    take();
    return window.river.app.onDeepLink(take);
  }, []);

  /** Linked or restored instead: the invite this screen took is offered once River is open. */
  const offerInvite = (): void => {
    if (invite) useCommunity.getState().setModal({ kind: 'join-invite', link: invite });
  };

  const start = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (name.trim().length > 64) return setError('Use 64 characters or fewer.');
    setError(null);
    setWorking('Setting up River…');
    setStep('creating');
    hasIdentity.current = true;
    let created: IdentityInfo;
    try {
      created = await window.river.identity.create(name);
    } catch {
      hasIdentity.current = false;
      setError('River could not set itself up. Please try again.');
      setStep('start');
      return;
    }
    props.onCreated(created);
    // The photo is kept on this device and shared the way your name is (with friends and communities).
    if (avatar) await window.river.community.action({ a: 'setProfile', avatar }).catch(() => undefined);
    await applyFirstRunLook().catch(() => undefined);
    if (!invite) return props.onFinished();
    setWorking('Joining the community…');
    const failed = await joinWithLink(invite);
    if (failed) {
      props.onFinished();
      useCommunity.getState().notify(`River could not join that community: ${failed}`, 'error');
      return;
    }
    const joined = useCommunity.getState().selectedCommunity;
    if (joined && isPhone(useRiver.getState().info?.platform)) phoneShowCommunity(joined);
    props.onFinished('communities');
  };

  return (
    <div className="onboarding">
      <div className="onboarding__card glass" data-step={step}>
        {step === 'start' && (
          <form className="lock__form onboarding__start" onSubmit={(e) => void start(e)}>
            <div className="lock__mark">
              <RiverMark size={56} />
            </div>
            <h1 className="onboarding__title">Welcome to River</h1>
            {invite ? (
              <p className="onboarding__invite" role="status">
                You're invited to a community. Pick a name and you're in.
              </p>
            ) : (
              <p className="lock__text">
                Chats, calls and communities, end-to-end encrypted. No phone number or e-mail needed.
              </p>
            )}
            <div className="onboarding__me">
              <button
                type="button"
                className="onboarding__photo"
                aria-label={avatar ? 'Change your photo' : 'Add a photo (optional)'}
                onClick={() => fileRef.current?.click()}
              >
                {avatar ? (
                  <img src={avatar} alt="" />
                ) : (
                  <span aria-hidden="true" className="onboarding__photo-add">
                    <span className="onboarding__photo-glyph">📷</span>
                    Photo
                  </span>
                )}
              </button>
              <label className="textfield onboarding__name">
                <span className="field__label">Your name</span>
                <input
                  type="text"
                  autoFocus
                  maxLength={80}
                  placeholder="e.g. Alex"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                if (file.size > 15 * 1024 * 1024) return setError('That picture is too large.');
                setError(null);
                void keepAnimated(file).then((gif) => (gif ? setAvatar(gif) : setCropping(file)));
              }}
            />
            {cropping && (
              <AvatarCropDialog
                file={cropping}
                onClose={() => setCropping(null)}
                onDone={(picked) => {
                  setCropping(null);
                  setAvatar(picked);
                }}
              />
            )}
            {error && (
              <p className="field__error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn--primary lock__submit">
              {invite ? 'Join the community' : 'Get started'} <ArrowIcon size={16} />
            </button>
            <p className="muted small onboarding__note">
              Both are optional, and you can change them any time.
            </p>
            <div className="onboarding__other">
              <button type="button" className="btn btn--link" onClick={() => setStep('link')}>
                I already use River — link this device
              </button>
              <button type="button" className="btn btn--link" onClick={() => setStep('restore')}>
                Restore from a backup
              </button>
            </div>
          </form>
        )}

        {step === 'link' && (
          <LinkThisDevice
            key={deviceCode}
            initialCode={deviceCode}
            onBack={() => setStep('start')}
            onLinked={(linked) => {
              props.onCreated(linked);
              props.onFinished();
              offerInvite();
            }}
          />
        )}

        {step === 'restore' && (
          <RestoreForm
            onBack={() => setStep('start')}
            onRestored={() => {
              void window.river.identity.get().then((restored) => {
                if (restored) props.onCreated(restored);
                props.onFinished();
                offerInvite();
              });
            }}
          />
        )}

        {step === 'creating' && (
          <div className="keygen" role="status" aria-live="polite">
            <div className="keygen__orbit" aria-hidden="true">
              <span />
              <span />
              <span />
              <LockIcon size={26} />
            </div>
            <h1 className="onboarding__title">{working}</h1>
          </div>
        )}
      </div>
    </div>
  );
}
