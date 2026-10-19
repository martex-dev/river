import { useCallback, useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import type { PhoneFix, PhoneStatus } from '../../../shared/ipc.ts';
import { useRiver } from '../store.ts';
import { msg, tr } from '../i18n.ts';

/**
 * Android (2.11): what River needs to reach you while it is closed — River uses
 * no Google push service, so it keeps its own connection (Stay connected), and
 * Android's battery saving, full-screen permission and notification permission
 * decide whether messages and calls get through. Every state shown here is read
 * from the phone when asked; nothing is assumed.
 */

/*
 * One status for every part of Settings that shows it (2.11.2): the Stay connected toggle and the
 * Calls and notifications section used to read it separately, so turning Stay connected on left
 * the section saying Android had not started it.
 */
let sharedStatus: PhoneStatus | null = null;
const listeners = new Set<() => void>();
function setSharedStatus(next: PhoneStatus | null): void {
  sharedStatus = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads the phone's state again; everything that shows it updates. */
export async function refreshPhoneStatus(): Promise<PhoneStatus | null> {
  const next = await window.river.app.phoneStatus().catch(() => null);
  if (next) setSharedStatus(next);
  return next;
}

/** Stay connected was just turned on: read again now and once Android had a moment to start it. */
export function refreshAfterStayConnected(): Promise<PhoneStatus | null> {
  setTimeout(() => void refreshPhoneStatus(), 2_000);
  return refreshPhoneStatus();
}

/** For tests: forget the last status. */
export function resetPhoneStatus(): void {
  setSharedStatus(null);
}

/** The phone's current state, read again whenever River comes back to the front. */
export function usePhoneStatus(): {
  status: PhoneStatus | null;
  refresh(): void;
  fix(fix: PhoneFix): Promise<void>;
} {
  const android = useRiver((r) => r.info?.platform === 'android');
  const status = useSyncExternalStore(subscribe, () => (android ? sharedStatus : null));
  const refresh = useCallback(() => {
    if (android) void refreshPhoneStatus();
  }, [android]);
  useEffect(() => {
    refresh();
    // Back from Android's settings screen: what changed there shows at once.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);
  const fix = useCallback(
    async (which: PhoneFix): Promise<void> => {
      const next = await window.river.app.phoneFix(which).catch(() => null);
      if (next) setSharedStatus(next);
      else refresh();
    },
    [refresh],
  );
  return { status, refresh, fix };
}

/** What Settings says about Stay connected: never "on" for a service Android has not started. */
export function stayConnectedText(on: boolean, status: PhoneStatus): { ok: boolean; text: string } {
  if (!on) return { ok: false, text: msg('Off: messages and calls arrive only while River is open.') };
  if (status.background && status.batteryExempt)
    return { ok: true, text: msg('On: messages and calls reach you while River is closed.') };
  if (status.background)
    return {
      ok: false,
      text: msg(
        'On for now, but Android may stop it: allow River in the background (Battery, below) so it keeps running.',
      ),
    };
  return {
    ok: false,
    text: status.batteryExempt
      ? msg('On, but Android has not started it yet. Open River again, or restart the phone.')
      : msg(
          'On, but Android stopped it or has not started it: Stay connected needs River allowed in the background (Battery, below).',
        ),
  };
}

export const BATTERY_WHY = msg(
  'Android pauses apps in the background to save battery, which can hold back River’s messages and calls for many minutes. Android will ask whether River may always run in the background — allow it so they arrive at once.',
);

const FULL_SCREEN_KEY = 'river.phone.fullScreenAsked';

/**
 * A one-time question on Android phones (2.11): get messages and calls while River is closed?
 * New installs already stay connected (they are asked about battery saving instead); existing
 * installs choose. Asked once: `system.backgroundAsked`. Android 14+ also asks once whether calls
 * may cover the lock screen, when that is not allowed.
 */
export function StayConnectedPrompt(): ReactElement | null {
  const settings = useRiver((r) => r.settings);
  const android = useRiver((r) => r.info?.platform === 'android');
  const updateSettings = useRiver((r) => r.updateSettings);
  const { status, fix } = usePhoneStatus();
  const [fullScreenAsked, setFullScreenAsked] = useState(() => {
    try {
      return localStorage.getItem(FULL_SCREEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  // Already on (a new install) and nothing for Android to allow: nothing to ask, ever.
  const nothingToAsk =
    android &&
    !!settings &&
    !settings.system.backgroundAsked &&
    settings.system.background &&
    status?.batteryExempt === true;
  useEffect(() => {
    if (nothingToAsk) void updateSettings({ system: { backgroundAsked: true } });
  }, [nothingToAsk, updateSettings]);
  if (!android || !settings || !status || nothingToAsk) return null;
  const system = settings.system;

  if (!system.backgroundAsked) {
    const done = (patch: { background?: boolean }): Promise<void> =>
      updateSettings({ system: { ...patch, backgroundAsked: true } });
    return (
      <section className="whats-new glass" aria-labelledby="stay-connected-title">
        <h2 id="stay-connected-title">
          {system.background
            ? tr('Get messages and calls without delay')
            : tr('Get messages and calls when River is closed?')}
        </h2>
        <p className="small">
          {system.background
            ? tr('River stays connected while it is closed, so messages and calls reach you.')
            : tr(
                'River does not use Google’s push service. To reach you while it is closed, it keeps its own connection, with a quiet “River is connected” notification, and uses some battery.',
              )}
          {status.batteryExempt ? '' : ` ${tr(BATTERY_WHY)}`}
        </p>
        <div className="button-row">
          <button className="btn btn--ghost btn--small" onClick={() => void done({})}>
            {tr('Not now')}
          </button>
          <button
            className="btn btn--primary btn--small"
            onClick={() =>
              void done({ background: true }).then(() => {
                refreshAfterStayConnected();
                return status.batteryExempt ? undefined : fix('battery');
              })
            }
          >
            {system.background ? tr('Allow') : tr('Turn on')}
          </button>
        </div>
      </section>
    );
  }

  if (system.background && !status.fullScreenCalls && !fullScreenAsked) {
    const dismiss = (): void => {
      setFullScreenAsked(true);
      try {
        localStorage.setItem(FULL_SCREEN_KEY, '1');
      } catch {
        // asked again next time River starts
      }
    };
    return (
      <section className="whats-new glass" aria-labelledby="full-screen-title">
        <h2 id="full-screen-title">{tr('Let calls cover the screen?')}</h2>
        <p className="small">
          {tr(
            'Android asks for one more permission so calls can cover the screen when your phone is locked, like a phone call. Without it, a locked phone only shows a notification for a call.',
          )}
        </p>
        <div className="button-row">
          <button className="btn btn--ghost btn--small" onClick={dismiss}>
            {tr('Not now')}
          </button>
          <button
            className="btn btn--primary btn--small"
            onClick={() => {
              dismiss();
              void fix('fullScreen');
            }}
          >
            {tr('Open settings')}
          </button>
        </div>
      </section>
    );
  }
  return null;
}

function Row(props: {
  label: string;
  ok: boolean;
  okText: string;
  badText: string;
  action?: { label: string; run(): void };
}): ReactElement {
  return (
    <div className="phone-check">
      <span>
        <span className="toggle__label">{props.label}</span>
        <span className={`toggle__hint ${props.ok ? '' : 'phone-check__bad'}`}>
          {tr(props.ok ? props.okText : props.badText)}
        </span>
      </span>
      {!props.ok && props.action && (
        <button className="btn btn--small" onClick={props.action.run}>
          {props.action.label}
        </button>
      )}
    </div>
  );
}

/** Settings → System → Calls and notifications (Android, 2.11): the honest state, each with a fix. */
export function PhoneCallsSection(): ReactElement | null {
  const settings = useRiver((r) => r.settings);
  const updateSettings = useRiver((r) => r.updateSettings);
  const { status, fix } = usePhoneStatus();
  if (!settings) return null;
  if (!status) {
    return (
      <section aria-labelledby="phone-calls-title">
        <h3 id="phone-calls-title" className="field__label">
          {tr('Calls and notifications')}
        </h3>
        <p className="muted small">{tr('Checking this phone…')}</p>
      </section>
    );
  }
  const on = settings.system.background;
  const stay = stayConnectedText(on, status);
  return (
    <section aria-labelledby="phone-calls-title">
      <h3 id="phone-calls-title" className="field__label">
        {tr('Calls and notifications')}
      </h3>
      <Row
        label={tr('Stay connected')}
        ok={stay.ok}
        okText={stay.text}
        badText={stay.text}
        {...(on
          ? {}
          : {
              action: {
                label: tr('Turn on'),
                run: () =>
                  void updateSettings({ system: { background: true, backgroundAsked: true } }).then(() => {
                    refreshAfterStayConnected();
                    return status.batteryExempt ? undefined : fix('battery');
                  }),
              },
            })}
      />
      <Row
        label={tr('Battery')}
        ok={status.batteryExempt}
        okText={msg('River may run in the background without delays.')}
        badText={msg(
          'Battery optimization may delay messages and calls, and Android may stop Stay connected.',
        )}
        action={{ label: tr('Allow in background'), run: () => void fix('battery') }}
      />
      <Row
        label={tr('Full-screen calls')}
        ok={status.fullScreenCalls}
        okText={msg('Calls cover the screen when the phone is locked.')}
        badText={msg('Not allowed: a locked phone only shows a notification for calls.')}
        action={{ label: tr('Allow'), run: () => void fix('fullScreen') }}
      />
      <Row
        label={tr('Notifications')}
        ok={status.notifications}
        okText={msg('Allowed.')}
        badText={msg('Off: River cannot show messages or ring for calls.')}
        action={{ label: tr('Allow'), run: () => void fix('notifications') }}
      />
    </section>
  );
}
