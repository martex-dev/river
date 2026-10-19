import type { DmEvent } from '../../../shared/dm.ts';
import type { CommunityEvent } from '../../../shared/ipc.ts';
import {
  conversationNotify,
  effectiveNotify,
  mentionsYou,
  shouldAlert,
  silenced,
} from '../../../shared/notify-rules.ts';
import type { Settings } from '../../../shared/settings.ts';
import { resolveLanguage, systemLanguage, translate, type Language } from '../../../shared/i18n/index.ts';

/** The language banners speak: River's own setting. */
function langOf(ctx: BannerContext): Language {
  return resolveLanguage(ctx.settings?.appearance.language, systemLanguage());
}

/**
 * In-app banners (2.17): while River is open and in front, a message in another chat or channel
 * shows a small banner with the sender and the text (as Settings → Notifications → preview
 * allows), like Telegram's. The same rules as notifications decide: muted chats, Nothing,
 * "Only @mentions", messages sent without sound, Do Not Disturb and quiet hours stay quiet.
 */
export interface Banner {
  /** Unique per message, so a newer banner replaces the one on screen. */
  id: string;
  title: string;
  body: string;
  mention: boolean;
  open: { kind: 'chat'; peer: string } | { kind: 'channel'; communityId: string; channelId: string };
}

export interface BannerContext {
  settings: Settings | null;
  /** River's window is in front (otherwise the system's notification speaks). */
  focused: boolean;
  /** The chat on screen, if any. */
  viewingChat: string | null;
  /** The channel on screen, if any. */
  viewingChannel: string | null;
}

const clip = (text: string, max = 120): string => (text.length > max ? `${text.slice(0, max)}…` : text);

function allowed(ctx: BannerContext): ctx is BannerContext & { settings: Settings } {
  return !!ctx.settings && ctx.focused && ctx.settings.notifications.banners && !silenced(ctx.settings);
}

/** The banner for a direct or group message, or null. */
export function dmBanner(event: DmEvent, ctx: BannerContext, now = Date.now()): Banner | null {
  if (event.t !== 'message' || !event.isNew || event.message.mine || !allowed(ctx)) return null;
  const m = event.message;
  if (m.silent || m.notice || m.peer === ctx.viewingChat) return null;
  const prefs = ctx.settings.notifications;
  const chat = conversationNotify(prefs, m.peer, now);
  const mention = mentionsYou(chat, m);
  if (!shouldAlert(chat, mention)) return null;
  const preview = prefs.preview;
  const lang = langOf(ctx);
  return {
    id: `dm:${m.id}`,
    title: preview === 'none' ? 'River' : event.senderName,
    body:
      preview === 'full' ? clip(m.text || translate(lang, 'Sent a file')) : translate(lang, 'New message'),
    mention,
    open: { kind: 'chat', peer: m.peer },
  };
}

/** The banner for a channel message, or null. `place` names its channel and category. */
export function channelBanner(
  event: CommunityEvent,
  ctx: BannerContext,
  place: { channelName: string | null; categoryId: string | null },
  now = Date.now(),
): Banner | null {
  if (event.t !== 'message' || !event.isNew || event.message.mine || !allowed(ctx)) return null;
  const m = event.message;
  // Thread replies speak up in their thread (and as mentions, below the channel's own rules).
  if (m.threadId || m.channelId === ctx.viewingChannel) return null;
  const prefs = ctx.settings.notifications;
  const notify = effectiveNotify(prefs, m.communityId, m.channelId, now, place.categoryId);
  const mention = mentionsYou(notify, m);
  if (!shouldAlert(notify, mention)) return null;
  const preview = prefs.preview;
  const where = place.channelName ? ` · #${place.channelName}` : '';
  const lang = langOf(ctx);
  return {
    id: `channel:${m.id}`,
    title: preview === 'none' ? 'River' : `${m.senderName}${where}`,
    body:
      preview === 'full'
        ? clip(m.text || translate(lang, 'Sent a file'))
        : mention
          ? translate(lang, 'You were mentioned')
          : translate(lang, 'New message'),
    mention,
    open: { kind: 'channel', communityId: m.communityId, channelId: m.channelId },
  };
}
