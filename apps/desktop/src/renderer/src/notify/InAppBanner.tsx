import './banner.css';
import { useEffect, useState, type ReactElement } from 'react';
import { useCommunity } from '../community/store.ts';
import { useDm } from '../dm/store.ts';
import { useRiver } from '../store.ts';
import { channelBanner, dmBanner, type Banner, type BannerContext } from './banner-rules.ts';

/** How long a banner stays (it stays while the pointer is over it). */
const SHOW_MS = 5000;

function context(): BannerContext {
  const river = useRiver.getState();
  return {
    settings: river.settings,
    focused: document.visibilityState === 'visible' && document.hasFocus(),
    viewingChat: river.section === 'messages' ? useDm.getState().selected : null,
    viewingChannel: river.section === 'communities' ? useCommunity.getState().selectedChannel : null,
  };
}

/** Opens what a banner is about, as a notification would. */
export function openBanner(b: Banner): void {
  if (b.open.kind === 'chat') {
    useRiver.getState().navigate('messages');
    useDm.getState().select(b.open.peer);
  } else {
    useRiver.getState().navigate('communities');
    useCommunity.getState().select(b.open.communityId, b.open.channelId);
  }
}

/**
 * A small banner at the top for a message in another chat or channel while River is open
 * (2.17), on computers and phones. Tap to open it; it goes by itself after a few seconds.
 */
export function InAppBanner(): ReactElement | null {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const offDm = window.river.dm.onEvent((e) => {
      const b = dmBanner(e, context());
      if (b) setBanner(b);
    });
    const offCommunity = window.river.community.onEvent((e) => {
      if (e.t !== 'message') return;
      const channel = useCommunity
        .getState()
        .communities.find((c) => c.id === e.message.communityId)
        ?.channels.find((ch) => ch.id === e.message.channelId);
      const b = channelBanner(e, context(), {
        channelName: channel?.name ?? null,
        categoryId: channel?.parentId ?? null,
      });
      if (b) setBanner(b);
    });
    return () => {
      offDm();
      offCommunity();
    };
  }, []);

  useEffect(() => {
    if (!banner || hover) return;
    const timer = setTimeout(() => setBanner(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [banner, hover]);

  if (!banner) return null;
  return (
    <div className="inapp-banner" role="status" aria-live="polite">
      <button
        key={banner.id}
        className={`inapp-banner__card ${banner.mention ? 'inapp-banner__card--mention' : ''}`}
        onClick={() => {
          openBanner(banner);
          setBanner(null);
        }}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <span className="inapp-banner__title">{banner.title}</span>
        <span className="inapp-banner__body">{banner.body}</span>
      </button>
      <button className="inapp-banner__close" aria-label="Dismiss" onClick={() => setBanner(null)}>
        ×
      </button>
    </div>
  );
}
