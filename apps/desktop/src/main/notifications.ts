import { effectiveNotify, isMuted, shouldAlert, silenced } from '../shared/notify-rules.ts';
import { Notification, type BrowserWindow } from 'electron';
import type { Settings } from '../shared/settings.ts';
import type { CommunityService } from './community/community-service.ts';
import type { DmService } from './dm/dm-service.ts';

const MAX_KEPT = 100;

/**
 * What a phone needs to show a notification well (2.11); Electron never reads it. `conversation`
 * groups a conversation's notifications into one, `sender` is shown only when the preview setting
 * shows names, and `lockScreen` is true only with full previews: otherwise the lock screen says
 * "New message". `wake` lights up a dark screen (Settings → System on Android).
 */
export interface PhoneHints {
  conversation: string;
  sender: string | null;
  /** A channel's or group's name, when the notification is about one (shown with the sender). */
  group: string | null;
  lockScreen: boolean;
  wake: boolean;
}

const withHints = (n: Notification, hints: PhoneHints): Notification =>
  Object.assign(n, { phoneHints: hints });

/**
 * Desktop notifications for new community messages while River is not
 * focused. What a notification reveals follows Settings → Notifications →
 * preview: by default only "New message", never the sender or the text.
 */
export function startMessageNotifications(deps: {
  community: CommunityService;
  dm: DmService;
  settings: () => Settings;
  window: BrowserWindow;
}): () => void {
  const { community, window } = deps;
  /**
   * Shown notifications are held until clicked or closed: on Windows one that nothing refers to
   * can be garbage-collected while on screen, and clicking it then does nothing. The oldest go
   * after a while, in case a close is never reported (Action Center).
   */
  const shown = new Set<Notification>();
  const keep = (n: Notification): void => {
    shown.add(n);
    const release = (): void => void shown.delete(n);
    // `on` with plain event names: the phone's stand-in Notification has no `once`.
    const events = n as unknown as { on(event: string, listener: () => void): unknown };
    for (const event of ['close', 'click', 'failed']) events.on(event, release);
    if (shown.size > MAX_KEPT) shown.delete(shown.values().next().value!);
  };
  const hints = (conversation: string, sender: string | null, group: string | null = null): PhoneHints => {
    const s = deps.settings();
    const named = s.notifications.preview !== 'none';
    return {
      conversation,
      sender: named ? sender : null,
      group: named ? group : null,
      lockScreen: s.notifications.preview === 'full',
      wake: s.system.wakeScreen,
    };
  };
  const show = (
    title: string,
    body: string,
    mention: boolean,
    onClick: () => void,
    onReply?: (text: string) => void,
    call = false,
    phone?: PhoneHints,
  ): void => {
    if (window.isDestroyed() || window.isFocused() || !Notification.isSupported()) return;
    // Do Not Disturb or quiet hours: nothing pops up.
    if (silenced(deps.settings())) return;
    const notification = new Notification({
      title,
      body,
      silent: !call,
      ...(onReply ? { hasReply: true, replyPlaceholder: 'Reply' } : {}),
      // An incoming call stays until it is answered or stops ringing (phones ring for it).
      ...(call ? { urgency: 'critical' as const, timeoutType: 'never' as const } : {}),
    });
    if (phone) withHints(notification, phone);
    if (onReply) {
      notification.on('reply', (_e, reply) => {
        const text = reply.trim();
        if (text) onReply(text.slice(0, 4000));
      });
    }
    notification.on('click', () => {
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      onClick();
    });
    keep(notification);
    notification.show();
    if (mention) window.flashFrame(true);
  };
  // Direct messages always notify (they are personal), subject to the preview setting.
  const offDm = deps.dm.onEvent((event) => {
    if (event.t === 'call' && event.kind === 'invite') {
      // A call rings even while River is in the tray (or closed, on a phone that stays connected).
      if (!deps.settings().notifications.desktop) return;
      const prefs = deps.settings().notifications;
      const name = prefs.preview === 'none' ? 'Someone' : deps.dm.nameOf(event.peer);
      show(
        `Incoming ${event.video ? 'video ' : ''}call`,
        `${name} is calling you`,
        true,
        () => deps.dm.focus(event.peer),
        undefined,
        true,
      );
      return;
    }
    if (event.t !== 'message' || !event.isNew || event.message.mine) return;
    const prefs = deps.settings().notifications;
    if (!prefs.desktop) return;
    const m = event.message;
    // Sent without sound (2.5).
    if (m.silent) return;
    // A conversation you muted stays quiet (1.0.26).
    if (isMuted(prefs, m.peer)) return;
    const title = prefs.preview === 'none' ? 'River' : event.senderName;
    const body =
      prefs.preview === 'full'
        ? m.text
          ? m.text.length > 180
            ? `${m.text.slice(0, 180)}…`
            : m.text
          : 'Sent a file'
        : 'New direct message';
    // Reply right from the notification (phones; macOS), sent end-to-end encrypted like any message.
    show(
      title,
      body,
      true,
      () => deps.dm.focus(m.peer),
      (text) => void deps.dm.action({ a: 'send', peer: m.peer, text }).catch(() => undefined),
      false,
      hints(`dm:${m.peer}`, event.senderName),
    );
  });
  const offEvents = community.onEvent((event) => {
    if (event.t !== 'eventStarting') return;
    if (!deps.settings().notifications.desktop || silenced(deps.settings())) return;
    const preview = deps.settings().notifications.preview;
    show(
      preview === 'none' ? 'River' : event.name,
      preview === 'none' ? 'An event you are interested in is starting' : 'Starting now',
      true,
      () => community.focusChannel(event.communityId, event.channelId ?? ''),
      undefined,
      false,
      hints(`event:${event.communityId}:${event.channelId ?? ''}`, null),
    );
  });
  const offCommunity = community.onEvent((event) => {
    if (event.t !== 'message' || !event.isNew || event.message.mine) return;
    const prefs = deps.settings().notifications;
    if (!prefs.desktop) return;
    if (silenced(deps.settings())) return;
    const m0 = event.message;
    const category = community.channelParent?.(m0.channelId) ?? null;
    if (
      !shouldAlert(effectiveNotify(prefs, m0.communityId, m0.channelId, Date.now(), category), m0.mentionsMe)
    )
      return;
    if (window.isDestroyed() || window.isFocused()) return;
    if (!Notification.isSupported()) return;
    const m = event.message;
    const channel = community.channelName(m.channelId);
    let title = 'River';
    let body = m.mentionsMe ? 'You were mentioned' : 'New message';
    if (prefs.preview === 'sender' || prefs.preview === 'full') {
      title = channel ? `${m.senderName} · #${channel}` : m.senderName;
    }
    if (prefs.preview === 'full') body = m.text.length > 180 ? `${m.text.slice(0, 180)}…` : m.text;
    const notification = new Notification({ title, body, silent: true });
    withHints(notification, hints(`channel:${m.channelId}`, m.senderName, channel ? `#${channel}` : null));
    notification.on('click', () => {
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      community.focusChannel(m.communityId, m.channelId);
    });
    keep(notification);
    notification.show();
    if (m.mentionsMe) window.flashFrame(true);
  });
  return () => {
    offDm();
    offEvents();
    offCommunity();
    shown.clear();
  };
}
