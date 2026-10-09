import { Notification, type BrowserWindow } from 'electron';
import type { Settings } from '../shared/settings.ts';
import type { CommunityService } from './community/community-service.ts';

/**
 * Desktop notifications for new community messages while River is not
 * focused. What a notification reveals follows Settings → Notifications →
 * preview: by default only "New message", never the sender or the text.
 */
export function startMessageNotifications(deps: {
  community: CommunityService;
  settings: () => Settings;
  window: BrowserWindow;
}): () => void {
  const { community, window } = deps;
  return community.onEvent((event) => {
    if (event.t !== 'message' || !event.isNew || event.message.mine) return;
    const prefs = deps.settings().notifications;
    if (!prefs.desktop) return;
    if (prefs.mode === 'mentions' && !event.message.mentionsMe) return;
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
    notification.on('click', () => {
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      community.focusChannel(m.communityId, m.channelId);
    });
    notification.show();
    if (m.mentionsMe) window.flashFrame(true);
  });
}
