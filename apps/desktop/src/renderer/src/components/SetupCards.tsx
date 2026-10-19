import { useEffect, useState, type ReactElement } from 'react';
import { create } from 'zustand';
import { suggestUsername } from '../../../shared/username-suggest.ts';
import { markLookChosen } from '../appearance/first-look.ts';
import { useCommunity } from '../community/store.ts';
import { useDm } from '../dm/store.ts';
import { useRiver } from '../store.ts';
import { tr } from '../i18n.ts';

/**
 * What the one-screen first run (2.14) leaves for later, offered one card at a time at the top
 * of the page, each when it is useful and each easy to put off:
 * 1. a sign-up link, if River's server only takes invited people;
 * 2. a @username, suggested from your name, once your account is online;
 * 3. a look of your own (River starts with a good one per platform);
 * 4. a backup, once there is something to lose (a friend or a community).
 * None of them says something is done that is not: the backup card stays until a backup exists.
 */
export function SetupCards(): ReactElement | null {
  const account = useRiver((r) => r.account);
  const lookChosen = useRiver((r) => r.settings?.design.chosen ?? true);
  const later = useSetupLater();
  if (account.state === 'none' && account.needsInvite) return <SignupNeeded />;
  if (
    account.state === 'registered' &&
    account.connection === 'online' &&
    !account.username &&
    !later.username
  )
    return <UsernamePrompt />;
  if (!lookChosen) return <LookCard />;
  if (account.state === 'registered' && !later.backup) return <BackupNudge />;
  return null;
}

/** Cards put off for the rest of this run ("Later"). */
const useSetupLater = create<{ username: boolean; backup: boolean }>(() => ({
  username: false,
  backup: false,
}));

/** Tests only. */
export function resetSetupCards(): void {
  useSetupLater.setState({ username: false, backup: false });
}

/** Asks for the sign-up link an invite-only server needs (the first run no longer stops for it). */
function SignupNeeded(): ReactElement {
  const setAccount = useRiver((r) => r.setAccount);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="username-prompt setup-card glass"
      aria-label={tr('Finish setting up your account')}
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void window.river.account.redeemSignup(link.trim()).then((res) => {
          setBusy(false);
          if (res.ok) void setAccount(res.value);
          else setError(res.message);
        });
      }}
    >
      <div>
        <strong>{tr('One more step for your account')}</strong>
        <p className="muted small">
          {tr('River’s server only accepts people its owner invites. Paste the sign-up link they sent you.')}
        </p>
      </div>
      <div className="username-row">
        <label className="textfield setup-card__field">
          <span className="sr-only">{tr('Sign-up link')}</span>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={tr('Paste your sign-up link')}
            spellCheck={false}
          />
        </label>
        <button className="btn btn--primary btn--small" disabled={busy || link.trim() === ''}>
          {busy ? tr('Setting up…') : tr('Use link')}
        </button>
      </div>
      {error && <p className="field__error">{error}</p>}
    </form>
  );
}

/** A @username, suggested from your name: claiming it is one tap. */
function UsernamePrompt(): ReactElement {
  const setAccount = useRiver((r) => r.setAccount);
  const displayName = useRiver((r) => r.identity?.displayName ?? '');
  const [value, setValue] = useState(() => suggestUsername(displayName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await window.river.account.setUsername(value.trim());
    setBusy(false);
    if (res.ok) setAccount(res.value);
    else setError(res.message);
  };
  return (
    <form
      className="username-prompt glass"
      aria-label={tr('Choose a username')}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div>
        <strong>{tr('Pick a username')}</strong>
        <p className="muted small">{tr("It's how friends add you — like @alex. You can change it later.")}</p>
      </div>
      <div className="username-row">
        <div className="textfield username-field">
          <span className="username-field__at" aria-hidden="true">
            @
          </span>
          <input
            value={value.replace(/^@/, '')}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder={tr('username')}
            autoCapitalize="none"
            spellCheck={false}
            maxLength={32}
            aria-label={tr('Username')}
          />
        </div>
        <button className="btn btn--primary btn--small" disabled={busy || value.trim().length < 3}>
          {busy ? tr('Saving…') : tr('Save')}
        </button>
        <button
          type="button"
          className="btn btn--link btn--small"
          onClick={() => useSetupLater.setState({ username: true })}
        >
          {tr('Later')}
        </button>
      </div>
      {error && <p className="field__error">{error}</p>}
    </form>
  );
}

/** The skin chooser used to stop the first run (1.0.46); now it is an offer. */
function LookCard(): ReactElement {
  const openSettings = useRiver((r) => r.openSettings);
  return (
    <section className="username-prompt setup-card glass" aria-label={tr('Pick your look')}>
      <div>
        <strong>{tr('Pick your look')}</strong>
        <p className="muted small">
          {tr('Skins, colours and backgrounds. You can change it any time in Settings → Appearance.')}
        </p>
      </div>
      <div className="username-row">
        <button
          className="btn btn--primary btn--small"
          onClick={() => {
            void markLookChosen();
            openSettings('appearance');
          }}
        >
          {tr('Choose a look')}
        </button>
        <button className="btn btn--link btn--small" onClick={() => void markLookChosen()}>
          {tr('Keep this one')}
        </button>
      </div>
    </section>
  );
}

const BACKUP_LATER_KEY = 'river.backup-nudge.until';
const BACKUP_LATER_MS = 14 * 24 * 60 * 60 * 1000;

function backupPutOff(now: number): boolean {
  try {
    return Number(localStorage.getItem(BACKUP_LATER_KEY) ?? 0) > now;
  } catch {
    return false;
  }
}

/**
 * A backup, once there is something to keep: you have a friend or a community, and no backup
 * file was ever saved. "Not now" puts it off for two weeks.
 */
function BackupNudge(): ReactElement | null {
  const openSettings = useRiver((r) => r.openSettings);
  const worthKeeping = useDm((d) => d.conversations.some((c) => c.state === 'accepted' && !c.self));
  const inCommunity = useCommunity((c) => c.communities.length > 0);
  const relevant = worthKeeping || inCommunity;
  const [needed, setNeeded] = useState(false);
  useEffect(() => {
    if (!relevant || backupPutOff(Date.now())) return;
    let live = true;
    Promise.resolve(window.river.backup?.status?.())
      .then((s) => {
        if (live) setNeeded(!!s && s.lastBackupAt === null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [relevant]);
  if (!relevant || !needed) return null;
  const later = (): void => {
    try {
      localStorage.setItem(BACKUP_LATER_KEY, String(Date.now() + BACKUP_LATER_MS));
    } catch {
      // storage unavailable: it is put off for this run only
    }
    useSetupLater.setState({ backup: true });
  };
  return (
    <section className="username-prompt setup-card glass" aria-label={tr('Back up River')}>
      <div>
        <strong>{tr('You have no backup yet')}</strong>
        <p className="muted small">
          {tr(
            'Your chats are kept only on your devices. A recovery phrase and a backup file bring them back if this device is lost.',
          )}
        </p>
      </div>
      <div className="username-row">
        <button
          className="btn btn--primary btn--small"
          onClick={() => {
            useSetupLater.setState({ backup: true });
            openSettings('backup');
          }}
        >
          {tr('Set up a backup')}
        </button>
        <button className="btn btn--link btn--small" onClick={later}>
          {tr('Not now')}
        </button>
      </div>
    </section>
  );
}
