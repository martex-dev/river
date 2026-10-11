import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatMessageLink,
  openMessageLink,
  parseMessageLink,
  setMessageLinkOpener,
} from '../src/renderer/src/community/message-link.ts';
import { forwardedText } from '../src/renderer/src/community/ui/Forward.tsx';

const ids = { communityId: 'A'.repeat(22), channelId: 'B'.repeat(22), messageId: 'c_-'.repeat(7) + 'd' };

afterEach(() => setMessageLinkOpener(() => false));

describe('message links', () => {
  it('round-trip through the share address', () => {
    const link = formatMessageLink('https://wild-name.trycloudflare.com/', ids);
    expect(link).toBe(
      `https://wild-name.trycloudflare.com/channels/${ids.communityId}/${ids.channelId}/${ids.messageId}`,
    );
    expect(parseMessageLink(link)).toEqual(ids);
  });

  it('only recognise real message links', () => {
    expect(parseMessageLink('https://example.org/channels/x/y/z')).toBeNull();
    expect(parseMessageLink(`https://example.org/join#c=${ids.communityId}`)).toBeNull();
    expect(
      parseMessageLink(`javascript:/channels/${ids.communityId}/${ids.channelId}/${ids.messageId}`),
    ).toBeNull();
  });

  it('open inside River instead of the browser', () => {
    const opener = vi.fn(() => true);
    setMessageLinkOpener(opener);
    expect(openMessageLink(formatMessageLink('https://s.example', ids))).toBe(true);
    expect(opener).toHaveBeenCalledWith(ids);
    expect(openMessageLink('https://example.org/news')).toBe(false);
  });
});

describe('forwarding', () => {
  it('marks where a forwarded message came from', () => {
    expect(forwardedText('hi there', { name: 'Ana', channel: 'general' })).toBe(
      '-# ↪ Forwarded from Ana in #general\nhi there',
    );
  });
});
