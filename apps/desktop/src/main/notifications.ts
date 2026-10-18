import {
  conversationNotify,
  effectiveNotify,
  mentionsYou,
  shouldAlert,
  silenced,
} from '../shared/notify-rules.ts';
import type { NotifySound } from '../shared/notify-sounds.ts';
import { Notification, type BrowserWindow } from 'electron';
import type { Settings } from '../shared/settings.ts';
import {
  resolveLanguage,
  translate,
  translatePlural,
  type Language,
  type Vars,
} from '../shared/i18n/index.ts';
import type { CommunityService } from './community/community-service.ts';
import type { DmService } from './dm/dm-service.ts';

const MAX_KEPT = 100;
/**
 * An incoming call's notification waits this long: an invite this device answers "busy" (you are
 * in another call here) never shows one.
 */
const CALL_NOTIFY_DELAY_MS = 300;
/** A conversation's notification shows this many of its latest messages (full previews). */
const SUMMARY_LINES = 4;
/** Conversations with a notification on screen are remembered up to this many. */
const MAX_THREADS = 200;

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
  /** 2.17: the conversation's sound: "default", "none" or one of River's tones (notify-sounds.ts). */
  sound: NotifySound;
  /** 2.17: messages this conversation's notification stands for (Android's app icon badge adds them up). */
  count: number;
}

const withHints = (n: Notification, hints: PhoneHints): Notification =>
  Object.assign(n, { phoneHints: hints });

/** Names a phone notification so it can be taken away again (an incoming call's; Electron ignores it). */
const withTag = (n: Notification, tag: string): Notification => Object.assign(n, { phoneTag: tag });

/** Shortens a message for a notification. */
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * A conversation's notification (2.17): one per chat or channel, like Telegram, instead of a pile.
 * New messages replace it with a summary ("3 new messages", or the latest lines with full
 * previews); reading the conversation — here or on another of your devices — takes it away.
 */
interface Thread {
  notification: Notification | null;
  count: number;
  /** Recent lines, kept only while previews show messages. */
  lines: string[];
}

/** What a conversation's notification says once several messages wait (computers). */
export function summaryText(
  preview: Settings['notifications']['preview'],
  count: number,
  lines: string[],
  kind: 'dm' | 'channel',
  lang: Language = 'en',
): string {
  if (preview === 'full' && lines.length) {
    const shown = lines.slice(-SUMMARY_LINES);
    const more = count - shown.length;
    return [...shown, ...(more > 0 ? [translate(lang, '+{count} more', { count: more })] : [])].join('\n');
  }
  return kind === 'dm' && preview === 'none'
    ? translatePlural(lang, '{count} new direct messages', count)
    : translatePlural(lang, '{count} new messages', count);
}

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
  /**
   * The phone's shell keeps one notification per conversation by itself (Android's
   * MessagingStyle, the iPhone's threads): each message is posted as it is, and the shell joins
   * it to its conversation's notification. Computers replace the notification here instead.
   */
  nativeGrouping?: boolean;
  /** Takes a conversation's notification away on the phone (it was read). */
  clearConversation?: (conversation: string) => void;
  /**
   * The computer's or phone's language (Electron's app.getLocale(), the phone's navigator), for
   * notifications in River's language when it follows the system. Without it: English.
   */
  locale?: () => string;
}): () => void {
  const { community, window } = deps;
  /** Notifications speak River's language (Settings → Appearance → Language). */
  const lang = (): Language => resolveLanguage(deps.settings().appearance.language, deps.locale?.() ?? 'en');
  const t = (text: string, vars?: Vars): string => translate(lang(), text, vars);
  const tn = (key: string, count: number, vars?: Vars): string => translatePlural(lang(), key, count, vars);
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
  const hints = (
    conversation: string,
    sender: string | null,
    group: string | null = null,
    sound: NotifySound = 'default',
    count = 1,
  ): PhoneHints => {
    const s = deps.settings();
    const named = s.notifications.preview !== 'none';
    return {
      conversation,
      sender: named ? sender : null,
      group: named ? group : null,
      lockScreen: s.notifications.preview === 'full',
      wake: s.system.wakeScreen,
      sound,
      count,
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
    tag?: string,
    onRead?: () => void,
  ): Notification | null => {
    if (window.isDestroyed() || window.isFocused() || !Notification.isSupported()) return null;
    // Do Not Disturb or quiet hours: nothing pops up.
    if (silenced(deps.settings())) return null;
    const notification = new Notification({
      title,
      body,
      silent: !call,
      ...(onReply ? { hasReply: true, replyPlaceholder: t('Reply') } : {}),
      // Mark as read (2.17): macOS shows the button; phones put it next to Reply.
      ...(onRead ? { actions: [{ type: 'button' as const, text: t('Mark as read') }] } : {}),
      // An incoming call stays until it is answered or stops ringing (phones ring for it).
      ...(call ? { urgency: 'critical' as const, timeoutType: 'never' as const } : {}),
    });
    if (phone) withHints(notification, phone);
    if (tag) withTag(notification, tag);
    if (onReply) {
      notification.on('reply', (_e, reply) => {
        const text = reply.trim();
        if (text) onReply(text.slice(0, 4000));
      });
    }
    if (onRead) notification.on('action', () => onRead());
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
    return notification;
  };

  /** One notification per conversation (2.17), by conversation key ("dm:…", "channel:…"). */
  const threads = new Map<string, Thread>();
  const closeQuietly = (n: Notification | null): void => {
    try {
      (n as { close?: () => void } | null)?.close?.();
    } catch {
      // already gone
    }
  };
  /** The conversation was read (here, on another device, or from the notification): its notification goes. */
  const clearThread = (key: string): void => {
    const thread = threads.get(key);
    if (!thread) return;
    threads.delete(key);
    closeQuietly(thread.notification);
    deps.clearConversation?.(key);
  };
  const postMessage = (p: {
    key: string;
    kind: 'dm' | 'channel';
    title: string;
    body: string;
    /** The title once several messages wait (a channel's or group's name). */
    summaryTitle: string;
    /** The line this message adds to the summary, with full previews (null otherwise). */
    line: string | null;
    mention: boolean;
    sender: string | null;
    group: string | null;
    sound: NotifySound;
    onClick: () => void;
    onReply?: (text: string) => void;
    onRead: () => void;
  }): void => {
    const prefs = deps.settings().notifications;
    const before = threads.get(p.key);
    const count = (before?.count ?? 0) + 1;
    const lines = [...(before?.lines ?? []), ...(p.line ? [p.line] : [])].slice(-SUMMARY_LINES);
    const grouped = !deps.nativeGrouping && count > 1;
    const title = grouped ? `${p.summaryTitle} (${count})` : p.title;
    const body = grouped ? summaryText(prefs.preview, count, lines, p.kind, lang()) : p.body;
    const n = show(
      title,
      body,
      p.mention,
      () => {
        // Opened: the conversation starts over.
        if (threads.get(p.key)?.notification === n) threads.delete(p.key);
        p.onClick();
      },
      p.onReply
        ? (text) => {
            if (threads.get(p.key)?.notification === n) threads.delete(p.key);
            p.onReply!(text);
          }
        : undefined,
      false,
      hints(p.key, p.sender, p.group, p.sound, count),
      undefined,
      () => {
        clearThread(p.key);
        p.onRead();
      },
    );
    if (!n) return;
    // Swiped away (or closed by the person): the next message starts a new one.
    (n as unknown as { on(event: string, listener: () => void): unknown }).on('close', () => {
      if (threads.get(p.key)?.notification === n) threads.delete(p.key);
    });
    threads.delete(p.key);
    threads.set(p.key, { notification: n, count, lines: prefs.preview === 'full' ? lines : [] });
    if (threads.size > MAX_THREADS) threads.delete(threads.keys().next().value!);
    // Computers: the earlier notification of this conversation goes (phones replace it themselves).
    if (!deps.nativeGrouping && before?.notification) closeQuietly(before.notification);
  };

  /** Incoming-call notifications by call: each goes away when its call stops ringing. */
  const calls = new Map<string, Notification>();
  const waiting = new Map<string, ReturnType<typeof setTimeout>>();
  const closeCall = (callId: string): void => {
    clearTimeout(waiting.get(callId));
    waiting.delete(callId);
    const n = calls.get(callId);
    calls.delete(callId);
    closeQuietly(n ?? null);
  };
  const offRingEnd = deps.dm.onRingEnd?.((end) => {
    closeCall(end.event.callId);
    // Nobody answered (or the caller gave up) while River was not in front: say so, as phones do.
    if (end.how !== 'missed' || end.answeredOnPhone) return;
    const prefs = deps.settings().notifications;
    if (!prefs.desktop) return;
    const peer = end.event.peer;
    const group = end.event.group;
    // Previews hidden: no name, on the lock screen or anywhere else.
    const named = prefs.preview !== 'none';
    show(
      named
        ? group
          ? t('Missed group call in {group}', { group: group.name })
          : t('Missed call from {name}', { name: deps.dm.nameOf(peer) })
        : t('Missed call'),
      end.event.video ? t('River video call') : t('River voice call'),
      false,
      () => deps.dm.focus(group ? group.id : peer),
      undefined,
      false,
      {
        conversation: `missed:${end.event.callId}`,
        sender: null,
        group: null,
        lockScreen: prefs.preview === 'full',
        wake: false,
        sound: 'default',
        count: 1,
      },
    );
  });
  // Direct messages always notify (they are personal), subject to the preview setting.
  const offDm = deps.dm.onEvent((event) => {
    if (event.t === 'conversations') {
      // Read here or on another of your devices (read sync): its notification goes.
      for (const key of [...threads.keys()]) {
        if (!key.startsWith('dm:')) continue;
        const c = event.conversations.find((x) => x.riverId === key.slice(3));
        if (!c || c.unread === 0) clearThread(key);
      }
      return;
    }
    if (event.t === 'call') {
      // Answered, declined, handled elsewhere, ended: its notification goes.
      if (event.kind !== 'invite') {
        if (event.kind !== 'signal') closeCall(event.callId);
        return;
      }
      // A call rings even while River is in the tray (or closed, on a phone that stays connected).
      if (!deps.settings().notifications.desktop) return;
      if (calls.has(event.callId) || waiting.has(event.callId)) return;
      const callId = event.callId;
      const timer = setTimeout(() => {
        waiting.delete(callId);
        // Answered "busy" here meanwhile, or no longer ringing: no notification.
        if (deps.dm.ringingCall && deps.dm.ringingCall()?.callId !== callId) return;
        const prefs = deps.settings().notifications;
        const name = prefs.preview === 'none' ? t('Someone') : deps.dm.nameOf(event.peer);
        // A group call (2.18): who rang, and in which group.
        const group = event.group;
        const n = show(
          group
            ? event.video
              ? t('Incoming group video call')
              : t('Incoming group call')
            : event.video
              ? t('Incoming video call')
              : t('Incoming call'),
          group
            ? prefs.preview === 'none'
              ? t('A group call')
              : tn('{name} is calling {group} ({count} people)', group.people, { name, group: group.name })
            : t('{name} is calling you', { name }),
          true,
          () => deps.dm.focus(group ? group.id : event.peer),
          undefined,
          true,
          undefined,
          `call:${callId}`,
        );
        if (n) calls.set(callId, n);
      }, CALL_NOTIFY_DELAY_MS);
      waiting.set(callId, timer);
      return;
    }
    if (event.t !== 'message' || !event.isNew || event.message.mine) return;
    const prefs = deps.settings().notifications;
    if (!prefs.desktop) return;
    const m = event.message;
    // Sent without sound (2.5).
    if (m.silent) return;
    // A chat you muted stays quiet (1.0.26); one set to Nothing too, and one set to "Only
    // @mentions" (a group) speaks up only when you are mentioned or replied to (2.17).
    const chat = conversationNotify(prefs, m.peer);
    const mention = mentionsYou(chat, m);
    if (!shouldAlert(chat, mention)) return;
    const title = prefs.preview === 'none' ? 'River' : event.senderName;
    // "Bob · Hikers" for a group: the group's name heads its summary.
    const groupName = event.senderName.startsWith(`${m.senderName} · `)
      ? event.senderName.slice(m.senderName.length + 3)
      : null;
    const summaryTitle = prefs.preview === 'none' ? 'River' : (groupName ?? event.senderName);
    const read = (): void => void deps.dm.action({ a: 'read', peer: m.peer }).catch(() => undefined);
    // A first message from someone who is not your friend yet is a friend request (2.14): it says
    // so, and opening it shows Accept. No reply from the notification: that would answer a stranger.
    if (deps.dm.contactState?.(m.peer) === 'request') {
      postMessage({
        key: `dm:${m.peer}`,
        kind: 'dm',
        title,
        body:
          prefs.preview === 'none'
            ? t('New friend request')
            : prefs.preview === 'full' && m.text
              ? t('Wants to be your friend: {text}', { text: clip(m.text, 140) })
              : t('Wants to be your friend'),
        summaryTitle,
        line: m.text ? clip(m.text, 140) : null,
        mention: true,
        sender: event.senderName,
        group: null,
        sound: chat.sound,
        onClick: () => deps.dm.focus(m.peer),
        onRead: read,
      });
      return;
    }
    const text = m.text ? clip(m.text, 180) : t('Sent a file');
    const body = prefs.preview === 'full' ? text : t('New direct message');
    // Reply right from the notification (phones; macOS), sent end-to-end encrypted like any message.
    postMessage({
      key: `dm:${m.peer}`,
      kind: 'dm',
      title,
      body,
      summaryTitle,
      line: prefs.preview === 'full' ? (groupName ? `${m.senderName}: ${text}` : text) : null,
      mention: true,
      sender: event.senderName,
      group: null,
      sound: chat.sound,
      onClick: () => deps.dm.focus(m.peer),
      onReply: (reply) =>
        void deps.dm.action({ a: 'send', peer: m.peer, text: reply }).catch(() => undefined),
      onRead: read,
    });
  });
  const offEvents = community.onEvent((event) => {
    if (event.t !== 'eventStarting') return;
    if (!deps.settings().notifications.desktop || silenced(deps.settings())) return;
    const preview = deps.settings().notifications.preview;
    show(
      preview === 'none' ? 'River' : event.name,
      preview === 'none' ? t('An event you are interested in is starting') : t('Starting now'),
      true,
      () => community.focusChannel(event.communityId, event.channelId ?? ''),
      undefined,
      false,
      hints(`event:${event.communityId}:${event.channelId ?? ''}`, null),
    );
  });
  const offCommunity = community.onEvent((event) => {
    // Read on this device (opened, or Mark as read): its notification goes.
    if (event.t === 'channelRead') {
      clearThread(`channel:${event.channelId}`);
      return;
    }
    if (event.t !== 'message' || !event.isNew || event.message.mine) return;
    const prefs = deps.settings().notifications;
    if (!prefs.desktop) return;
    if (silenced(deps.settings())) return;
    const m = event.message;
    const category = community.channelParent?.(m.channelId) ?? null;
    const notify = effectiveNotify(prefs, m.communityId, m.channelId, Date.now(), category);
    // Mentions and replies to you come through a muted or "Only @mentions" channel; @everyone and
    // @here not where the community is set to ignore them (2.17).
    const mention = mentionsYou(notify, m);
    if (!shouldAlert(notify, mention)) return;
    if (window.isDestroyed() || window.isFocused()) return;
    if (!Notification.isSupported()) return;
    const channel = community.channelName(m.channelId);
    let title = 'River';
    let body = mention ? t('You were mentioned') : t('New message');
    const named = prefs.preview === 'sender' || prefs.preview === 'full';
    if (named) title = channel ? `${m.senderName} · #${channel}` : m.senderName;
    const text = clip(m.text, 180);
    if (prefs.preview === 'full') body = text;
    postMessage({
      key: `channel:${m.channelId}`,
      kind: 'channel',
      title,
      body,
      summaryTitle: named ? (channel ? `#${channel}` : m.senderName) : 'River',
      line: prefs.preview === 'full' ? `${m.senderName}: ${text}` : null,
      mention,
      sender: m.senderName,
      group: channel ? `#${channel}` : null,
      sound: notify.sound,
      onClick: () => community.focusChannel(m.communityId, m.channelId),
      onRead: () => void community.action({ a: 'markRead', channelId: m.channelId }).catch(() => undefined),
    });
  });
  return () => {
    offDm();
    offRingEnd?.();
    for (const callId of [...waiting.keys(), ...calls.keys()]) closeCall(callId);
    offEvents();
    offCommunity();
    shown.clear();
    threads.clear();
  };
}
