// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationView, DirectMessageView, MessageTags, SavedReply } from '../src/shared/dm.ts';
import type { ChannelView, ChatMessage, CommunityView } from '../src/shared/ipc.ts';
import { TextChannel } from '../src/renderer/src/community/ui/Chat.tsx';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { RichText } from '../src/renderer/src/community/ui/common.tsx';
import { forwardBody, ForwardDialog } from '../src/renderer/src/community/ui/Forward.tsx';
import { LinkSheet } from '../src/renderer/src/components/link-sheet.tsx';
import {
  attachmentLabel,
  bigEmojiCount,
  plainLine,
  replyPreview,
  shortLink,
  STICKER_NAME_PREFIX,
  VOICE_NAME_PREFIX,
} from '../src/renderer/src/components/message-kinds.ts';
import { VOICE_PREFIX } from '../src/renderer/src/components/VoiceMessage.tsx';
import { STICKER_PREFIX } from '../src/renderer/src/community/ui/Stickers.tsx';
import {
  EffectLayer,
  effectPieces,
  effectToPlay,
  markEffectSeen,
  playEffect,
  resetEffectsSeen,
  stopEffect,
} from '../src/renderer/src/appearance/effects.tsx';
import { saveDraft } from '../src/renderer/src/community/drafts.ts';
import { matchReplies, savedReplyQuery, useSavedReplies } from '../src/renderer/src/dm/saved-replies.tsx';
import { cleanTag, hasTag, tagsIn, useMessageTags } from '../src/renderer/src/dm/tags.tsx';
import { totalUnread, useDm } from '../src/renderer/src/dm/store.ts';
import { chatsBadge } from '../src/renderer/src/phone/calls.ts';
import { Conversation } from '../src/renderer/src/pages/MessagesPage.tsx';
import { useRiver } from '../src/renderer/src/store.ts';

/** Messaging, part 2 (2.19). */

const SAM = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const ME = '2a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5f';

const conv = (over: Partial<ConversationView> = {}): ConversationView => ({
  riverId: SAM,
  kind: 'direct',
  members: [],
  isAdmin: false,
  name: 'Sam',
  avatar: null,
  state: 'accepted',
  awaitingReply: false,
  last: null,
  unread: 0,
  verified: false,
  keyChanged: false,
  ...over,
});

const now = new Date().toISOString();
const msg = (id: string, over: Partial<DirectMessageView> = {}): DirectMessageView => ({
  id: id.padEnd(22, 'x'),
  peer: SAM,
  sender: SAM,
  senderName: 'Sam',
  mine: false,
  text: `message ${id}`,
  replyTo: null,
  attachments: [],
  sentAt: now,
  editedAt: null,
  deleted: false,
  status: 'received',
  reactions: [],
  ...over,
});
const photo = { name: 'beach.jpg', mime: 'image/jpeg' };

let actions: Array<{ a: string } & Record<string, unknown>> = [];
let replies: SavedReply[] = [];
let tags: MessageTags = {};
let channelMessages: ChatMessage[] = [];
const openUrl = vi.fn();

function fakeRiver(): unknown {
  const dm = (a: { a: string } & Record<string, unknown>): unknown => {
    switch (a.a) {
      case 'savedReplies':
        return replies;
      case 'messageTags':
        return tags;
      case 'tagMessage':
        tags = { ...tags, [a.key as string]: a.tags as string[] };
        return tags;
      case 'send':
        return msg('sent', { mine: true, sender: ME, text: String(a.text), status: 'sent' });
      case 'myId':
        return ME;
      default:
        return [];
    }
  };
  const leaf = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_t, key: string) => leaf([...path, key]),
      apply: (_t, _this, args: unknown[]) => {
        const name = path.at(-1) ?? '';
        if (/^on[A-Z]/.test(name)) return () => undefined;
        if (path.join('.') === 'dm.action') {
          actions.push(args[0] as { a: string });
          return Promise.resolve({ ok: true, value: dm(args[0] as { a: string }) });
        }
        if (path.join('.') === 'links.openUrl') return openUrl(...args);
        if (path.join('.') === 'community.action') {
          const a = args[0] as { a: string };
          return Promise.resolve({
            ok: true,
            value: a.a === 'historyPage' ? { messages: channelMessages, hasMore: false, before: null } : [],
          });
        }
        if (name === 'haptic' || name === 'send') return undefined;
        return Promise.resolve({ ok: true, value: [] });
      },
    });
  return leaf([]);
}

function open(c: ConversationView, messages: DirectMessageView[]): void {
  useDm.setState({ messages: { [c.riverId]: messages }, conversations: [c], selected: c.riverId });
  render(<Conversation conversation={c} onSafety={() => undefined} />);
}

beforeEach(() => {
  actions = [];
  replies = [];
  tags = {};
  channelMessages = [];
  openUrl.mockReset();
  (window as unknown as { river: unknown }).river = fakeRiver();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  resetEffectsSeen();
  stopEffect();
  saveDraft(`d:${SAM}`, '');
  saveDraft(`d:${ME}`, '');
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  useSavedReplies.setState({ replies: null });
  useMessageTags.setState({ tags: null });
  useRiver.setState({
    section: 'messages',
    settings: DEFAULT_SETTINGS,
    info: { platform: 'win32', version: '2.19.0' } as never,
    identity: { riverId: ME, displayName: 'Me', fingerprint: '', words: [], createdAt: '' },
  } as never);
  useDm.setState({ loaded: true, myId: ME, replyTo: null, editing: null, historyFailed: {} });
  useCommunity.setState({ communities: [], toast: null });
});
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.motion;
  delete document.documentElement.dataset.calm;
});

describe('big emoji', () => {
  it('counts messages of only 1–3 emoji, with spaces, flags, skin tones, ZWJ and keycaps', () => {
    expect(bigEmojiCount('😀')).toBe(1);
    expect(bigEmojiCount(' 😀  🎉 ')).toBe(2);
    expect(bigEmojiCount('👍🏽❤️‍🔥🇧🇬')).toBe(3);
    expect(bigEmojiCount('👨‍👩‍👧‍👦')).toBe(1);
    expect(bigEmojiCount('1️⃣')).toBe(1);
    expect(bigEmojiCount('<:party:abcdefghijklmnopqrstuv> 🎉')).toBe(2);
  });

  it('anything else stays a normal message', () => {
    for (const text of ['', 'hi 😀', '😀😀😀😀', '1', 'ok', ':)', '😀.', '#'])
      expect(bigEmojiCount(text), text).toBe(0);
  });

  it('shows without a bubble in a conversation, on computers and phones', async () => {
    open(conv(), [msg('e1', { text: '🎉🎉' }), msg('t1', { text: 'hello 🎉' })]);
    const big = document.getElementById(`dm-${'e1'.padEnd(22, 'x')}`)!;
    expect(big.classList).toContain('msg--jumbo');
    expect(big.classList).toContain('msg--jumbo-2');
    expect(big.querySelector('.msg__text--jumbo')?.textContent).toContain('🎉🎉');
    expect(document.getElementById(`dm-${'t1'.padEnd(22, 'x')}`)!.classList).not.toContain('msg--jumbo');
  });

  it('a picture with emoji as its caption is not made big', () => {
    open(conv(), [msg('p1', { text: '😀', attachments: [{ ...photo } as never] })]);
    expect(document.querySelector('.msg--jumbo')).toBeNull();
  });
});

describe('reply previews', () => {
  it('say what a message is in one line, as Telegram does', () => {
    expect(replyPreview({ text: 'See you **soon**', attachments: [] })).toBe('See you soon');
    expect(replyPreview({ text: '', attachments: [photo] })).toBe('Photo');
    expect(replyPreview({ text: 'look', attachments: [photo, photo] })).toBe('2 photos · look');
    expect(
      replyPreview({ text: '', attachments: [{ name: `${VOICE_NAME_PREFIX}-1.webm`, mime: 'audio/webm' }] }),
    ).toBe('Voice message');
    expect(
      replyPreview({
        text: '',
        attachments: [{ name: `${STICKER_NAME_PREFIX}cat.webp`, mime: 'image/webp' }],
      }),
    ).toBe('Sticker');
    expect(replyPreview({ text: '', attachments: [{ name: 'a.pdf', mime: 'application/pdf' }] })).toBe(
      'File: a.pdf',
    );
    expect(replyPreview({ text: 'Where?', attachments: [], poll: { question: 'Lunch?' } })).toBe(
      'Poll: Lunch?',
    );
    expect(replyPreview({ text: 'x', attachments: [], deleted: true })).toBe('Deleted message');
    expect(attachmentLabel([{ name: 'clip.mp4', mime: 'video/mp4' }])).toBe('Video');
  });

  it('never give away a spoiler, and skip the "Forwarded from" line', () => {
    expect(plainLine('the end: ||he lives||')).toBe('the end: Spoiler');
    expect(plainLine('-# ↪ Forwarded from Ana\nreal text')).toBe('real text');
    expect(plainLine('x'.repeat(300))).toHaveLength(100);
  });

  it('use the same names as the apps that make voice messages and stickers', () => {
    expect(VOICE_NAME_PREFIX).toBe(VOICE_PREFIX);
    expect(STICKER_NAME_PREFIX).toBe(STICKER_PREFIX);
  });

  it('the reply bar shows who and what you answer, and a tap goes to that message', async () => {
    const original = msg('o1', { text: '', attachments: [photo as never] });
    open(conv(), [original, msg('o2')]);
    act(() => useDm.setState({ replyTo: original }));
    const bar = document.querySelector('.reply-bar')!;
    expect(bar.textContent).toContain('Replying to Sam');
    expect(bar.querySelector('.reply-bar__preview')?.textContent).toBe('Photo');
    const scroll = vi.fn();
    document.getElementById(`dm-${original.id}`)!.scrollIntoView = scroll;
    fireEvent.click(within(bar as HTMLElement).getByRole('button', { name: /Replying to Sam/ }));
    expect(scroll).toHaveBeenCalled();
  });

  it('the quote above a reply is a button that goes to the message it answers', () => {
    const original = msg('q1', { text: 'Dinner at 8?' });
    const reply = msg('q2', { text: 'Yes!', replyTo: original.id, mine: true, sender: ME });
    open(conv(), [original, reply]);
    const quote = screen.getByRole('button', { name: /Sam\s*Dinner at 8\?/ });
    const scroll = vi.fn();
    document.getElementById(`dm-${original.id}`)!.scrollIntoView = scroll;
    fireEvent.click(quote);
    expect(scroll).toHaveBeenCalled();
  });
});

describe('saved replies', () => {
  const thanks: SavedReply = { id: 'r1'.padEnd(22, 'r'), shortcut: 'thanks', text: 'Thank you so much!' };
  const addr: SavedReply = { id: 'r2'.padEnd(22, 'r'), shortcut: 'address', text: 'Main St 1, thanks' };

  it('are found by what follows "/" at the start of the box', () => {
    expect(savedReplyQuery('/th')).toBe('th');
    expect(savedReplyQuery('/')).toBe('');
    expect(savedReplyQuery('hi /th')).toBeNull();
    expect(savedReplyQuery('/th more')).toBeNull();
    expect(matchReplies([addr, thanks], 'th').map((r) => r.shortcut)).toEqual(['thanks', 'address']);
    expect(matchReplies([addr, thanks], '').map((r) => r.shortcut)).toEqual(['address', 'thanks']);
  });

  it('typing "/" lists them; Enter puts the reply in the box (it is not sent yet)', async () => {
    replies = [thanks, addr];
    open(conv(), [msg('a')]);
    const box = screen.getByPlaceholderText('Message Sam');
    await waitFor(() => expect(useSavedReplies.getState().replies).toHaveLength(2));
    fireEvent.change(box, { target: { value: '/tha' } });
    const list = screen.getByRole('listbox', { name: 'Saved replies' });
    expect(within(list).getAllByRole('option')[0]!.textContent).toContain('/thanks');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect((box as HTMLTextAreaElement).value).toBe('Thank you so much!');
    expect(actions.some((a) => a.a === 'send')).toBe(false);
  });

  it('the button lists them too, and offers to add one when there are none', async () => {
    open(conv(), [msg('a')]);
    fireEvent.click(screen.getByRole('button', { name: 'Saved replies' }));
    expect(await screen.findByText(/No saved replies yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Add a saved reply/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Kept encrypted on this device only/)).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Shortcut' }), {
      target: { value: '/omw' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Text' }), {
      target: { value: 'On my way' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add saved reply' }));
    await waitFor(() =>
      expect(actions.find((a) => a.a === 'saveReply')).toEqual({
        a: 'saveReply',
        shortcut: 'omw',
        text: 'On my way',
      }),
    );
  });
});

describe('tags on notes and saved messages', () => {
  it('tag helpers', () => {
    const t: MessageTags = { 'd:a': ['Work', 'ideas'], 'd:b': ['work'], 'c:z': ['trip'] };
    expect(tagsIn(t)).toEqual(['ideas', 'trip', 'Work']);
    expect(tagsIn(t, ['d:b'])).toEqual(['work']);
    expect(hasTag(t, 'd:b', 'WORK')).toBe(true);
    expect(hasTag(t, 'd:b', 'ideas')).toBe(false);
    expect(hasTag(t, 'd:b', null)).toBe(true);
    expect(cleanTag('#to do')).toBe('to_do');
  });

  it('Note to self shows tags under notes and filters by one', async () => {
    const a = msg('n1', { mine: true, sender: ME, text: 'buy milk' });
    const b = msg('n2', { mine: true, sender: ME, text: 'river idea' });
    tags = { [`d:${b.id}`]: ['ideas'] };
    open(conv({ riverId: ME, name: 'Note to self', self: true }), [
      { ...a, peer: ME },
      { ...b, peer: ME },
    ]);
    const filter = await screen.findByRole('radiogroup', { name: 'Show tagged' });
    expect(screen.getByText('#ideas', { selector: '.msg-tag' })).toBeTruthy();
    fireEvent.click(within(filter).getByRole('radio', { name: '#ideas' }));
    expect(screen.queryByText('buy milk')).toBeNull();
    expect(screen.getByText('river idea')).toBeTruthy();
    fireEvent.click(within(filter).getByRole('radio', { name: 'All' }));
    expect(screen.getByText('buy milk')).toBeTruthy();
  });

  it('a note gets tags from its menu, saved on this device', async () => {
    const a = { ...msg('n3', { mine: true, sender: ME, text: 'gift ideas' }), peer: ME };
    open(conv({ riverId: ME, name: 'Note to self', self: true }), [a]);
    fireEvent.contextMenu(screen.getByText('gift ideas'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Add tags/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Add a tag' }), {
      target: { value: '#gifts' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save tags' }));
    await waitFor(() =>
      expect(actions.find((x) => x.a === 'tagMessage')).toEqual({
        a: 'tagMessage',
        key: `d:${a.id}`,
        tags: ['gifts'],
      }),
    );
  });

  it('other conversations have no tags', () => {
    open(conv(), [msg('x1')]);
    expect(screen.queryByRole('radiogroup', { name: 'Show tagged' })).toBeNull();
    fireEvent.contextMenu(screen.getByText('message x1'));
    expect(screen.queryByRole('menuitem', { name: /tags/ })).toBeNull();
  });
});

describe('message effects', () => {
  it('pieces are made per effect, the same for the same random numbers', () => {
    let n = 0;
    const seq = (): number => ((n = (n * 9301 + 49297) % 233280), n / 233280);
    expect(effectPieces('confetti', seq)).toHaveLength(70);
    expect(effectPieces('hearts', seq)).toHaveLength(26);
    expect(effectPieces('fireworks', seq)).toHaveLength(66);
    n = 0;
    const a = effectPieces('confetti', seq);
    n = 0;
    expect(effectPieces('confetti', seq)).toEqual(a);
  });

  it('play over the screen, hidden from screen readers and pointers', () => {
    render(<EffectLayer />);
    act(() => {
      expect(playEffect('hearts')).toBe(true);
    });
    const layer = document.querySelector('.msg-effect--hearts')!;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.querySelectorAll('.msg-effect__piece').length).toBeGreaterThan(10);
  });

  it('never with Calm mode or reduced motion', () => {
    render(<EffectLayer />);
    document.documentElement.dataset.calm = 'on';
    act(() => {
      expect(playEffect('confetti')).toBe(false);
    });
    delete document.documentElement.dataset.calm;
    document.documentElement.dataset.motion = 'reduced';
    act(() => {
      expect(playEffect('fireworks')).toBe(false);
    });
    expect(document.querySelector('.msg-effect')).toBeNull();
  });

  it('a received effect plays once: the newest unseen one, never your own, never an old one', () => {
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const list = [
      msg('f1', { effect: 'hearts' }),
      msg('f2', { effect: 'confetti' }),
      msg('f3', { effect: 'fireworks', mine: true }),
      msg('f4', { effect: 'fireworks', sentAt: old }),
    ];
    expect(effectToPlay(list)).toBe('confetti');
    expect(effectToPlay(list)).toBeNull();
    markEffectSeen(['x']);
    expect(JSON.parse(localStorage.getItem('river.effectsSeen')!)).toContain(list[0]!.id);
    // Remembered on this device: after a restart nothing plays again.
    resetEffectsSeen();
    expect(effectToPlay(list)).toBeNull();
  });

  it('opening a conversation with a new effect plays it', () => {
    render(<EffectLayer />);
    open(conv(), [msg('g1', { effect: 'fireworks', text: 'Happy new year' })]);
    expect(document.querySelector('.msg-effect--fireworks')).toBeTruthy();
    // The message offers to play it again.
    expect(screen.getByRole('button', { name: 'Play the fireworks effect again' })).toBeTruthy();
  });

  it('is chosen in the send menu and travels with the message', async () => {
    render(<EffectLayer />);
    open(conv(), [msg('a')]);
    fireEvent.change(screen.getByPlaceholderText('Message Sam'), { target: { value: 'Congrats!' } });
    fireEvent.click(screen.getByRole('button', { name: 'More ways to send' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Send with confetti/ }));
    await waitFor(() =>
      expect(actions.find((a) => a.a === 'send')).toMatchObject({
        a: 'send',
        peer: SAM,
        text: 'Congrats!',
        effect: 'confetti',
      }),
    );
    // The sender sees it go.
    await waitFor(() => expect(document.querySelector('.msg-effect--confetti')).toBeTruthy());
  });
});

describe('links in messages', () => {
  const long = 'https://www.example.com/a/very/long/path/to/some/article-with-a-long-name?ref=river&x=1';

  it('long links are shortened around the middle; the site name always stays', () => {
    const short = shortLink(long);
    expect(short.length).toBeLessThanOrEqual(48);
    expect(short.startsWith('www.example.com/a/very')).toBe(true);
    expect(short).toContain('…');
    expect(shortLink('https://example.com/x')).toBe('https://example.com/x');
    expect(
      shortLink(`http://insecure.example${'/x'.repeat(30)}`).startsWith('http://insecure.example/'),
    ).toBe(true);
    const host = `https://${'sub.'.repeat(12)}example.com/${'p'.repeat(40)}`;
    expect(shortLink(host)).toBe(`${'sub.'.repeat(12)}example.com/…`);
  });

  it('show shortened, with the whole address on hover and in the sheet a right-click opens', () => {
    render(
      <>
        <RichText text={`read ${long}`} names={[]} me={null} />
        <LinkSheet />
      </>,
    );
    const link = screen.getByRole('link');
    expect(link.textContent).toBe(shortLink(long));
    expect(link.getAttribute('title')).toBe(long);
    fireEvent.contextMenu(link, { clientX: 10, clientY: 10 });
    expect(screen.getByText(long)).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open link' }));
    expect(openUrl).toHaveBeenCalledWith(long);
  });

  it('mailto: and tel: become links that main checks before the mail or phone app opens', () => {
    render(<RichText text="mail mailto:ana@example.org or call tel:+359888123456" names={[]} me={null} />);
    const [mail, tel] = screen.getAllByRole('link');
    expect(mail!.textContent).toBe('ana@example.org');
    expect(tel!.textContent).toBe('+359888123456');
    fireEvent.click(tel!);
    expect(openUrl).toHaveBeenCalledWith('tel:+359888123456');
  });

  it('other schemes never become links', () => {
    render(
      <RichText
        text="javascript:alert(1) file:///etc/passwd [x](javascript:alert(1))"
        names={[]}
        me={null}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('forwarding', () => {
  it('with or without the sender’s name', () => {
    expect(forwardBody('hi', { name: 'Ana', channel: 'general' }, true)).toBe(
      '-# ↪ Forwarded from Ana in #general\nhi',
    );
    expect(forwardBody('hi', { name: 'Ana', channel: 'general' }, false)).toBe('hi');
  });

  it('the dialog sends the text alone when the name is hidden', async () => {
    useDm.setState({ conversations: [conv({ name: 'Bo' })] });
    render(
      <ForwardDialog text="secret plan" from={{ name: 'Ana', channel: '' }} onClose={() => undefined} />,
    );
    expect(screen.getByText(/Starts with “Forwarded from Ana”/)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: /Show sender’s name/ }));
    fireEvent.click(screen.getByRole('button', { name: /Bo/ }));
    await waitFor(() =>
      expect(actions.find((a) => a.a === 'send')).toEqual({ a: 'send', peer: SAM, text: 'secret plan' }),
    );
  });
});

describe('on a phone', () => {
  beforeEach(() => {
    useRiver.setState({ info: { platform: 'android', version: '2.19.0' } as never });
  });

  it('big emoji, the reply preview and saved replies are there too', async () => {
    const original = msg('ph1', { text: 'Voice?', attachments: [] });
    open(conv(), [original, msg('ph2', { text: '❤️' })]);
    expect(document.getElementById(`dm-${'ph2'.padEnd(22, 'x')}`)!.classList).toContain('msg--jumbo-1');
    act(() => useDm.setState({ replyTo: original }));
    expect(document.querySelector('.reply-bar__preview')?.textContent).toBe('Voice?');
    expect(screen.getByRole('button', { name: 'Saved replies' })).toBeTruthy();
  });
});

describe('in channels', () => {
  const channel = {
    id: 'ch'.padEnd(22, 'c'),
    kind: 'text',
    name: 'general',
    topic: '',
    permissions: 0xffffffff,
    slowmode: 0,
    announcement: false,
    forum: false,
    media: false,
  } as unknown as ChannelView;
  const place = {
    id: 'pl'.padEnd(22, 'p'),
    name: 'Place',
    members: [{ riverId: ME, name: 'Me', roles: [], avatar: null }],
    roles: [],
    channels: [channel],
    permissions: 0xffffffff,
  } as unknown as CommunityView;
  const chatMsg = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
    ({
      id: id.padEnd(22, 'm'),
      communityId: place.id,
      channelId: channel.id,
      sender: SAM,
      senderName: 'Sam',
      text,
      sentAt: now,
      reactions: [],
      attachments: [],
      mine: false,
      threadId: null,
      thread: null,
      ...extra,
    }) as unknown as ChatMessage;

  beforeEach(() => {
    useCommunity.setState({
      communities: [place],
      emojis: {},
      typing: {},
      messages: {},
      noMore: {},
      historyFailed: {},
      replyTo: null,
      pendingJump: null,
    } as never);
  });

  it('a message of only emoji shows big', async () => {
    channelMessages = [chatMsg('c1', '🔥🔥🔥'), chatMsg('c2', 'fire 🔥')];
    render(<TextChannel community={place} channel={channel} me={ME} />);
    await screen.findByText('fire 🔥');
    expect(document.getElementById(`msg-${'c1'.padEnd(22, 'm')}`)!.classList).toContain('msg--jumbo-3');
    expect(document.getElementById(`msg-${'c2'.padEnd(22, 'm')}`)!.classList).not.toContain('msg--jumbo');
  });

  it('saved replies come up with the slash commands', async () => {
    replies = [{ id: 'r1'.padEnd(22, 'r'), shortcut: 'thanks', text: 'Thank you all!' }];
    render(<TextChannel community={place} channel={channel} me={ME} />);
    await waitFor(() => expect(useSavedReplies.getState().replies).toHaveLength(1));
    const box = screen.getByPlaceholderText('Message #general');
    fireEvent.change(box, { target: { value: '/than' } });
    const option = within(screen.getByRole('listbox', { name: 'Suggestions' })).getByRole('option', {
      name: /\/thanks/,
    });
    fireEvent.mouseDown(option);
    expect((box as HTMLTextAreaElement).value).toBe('Thank you all!');
  });

  it('the reply bar previews the message and goes to it', async () => {
    const original = chatMsg('c3', '', { attachments: [{ name: 'a.png', mime: 'image/png' }] as never });
    channelMessages = [original];
    render(<TextChannel community={place} channel={channel} me={ME} />);
    await waitFor(() => expect(useCommunity.getState().messages[channel.id]).toHaveLength(1));
    act(() => useCommunity.setState({ replyTo: original }));
    expect(document.querySelector('.reply-bar__preview')?.textContent).toBe('Photo');
    const scroll = vi.fn();
    document.getElementById(`msg-${original.id}`)!.scrollIntoView = scroll;
    fireEvent.click(screen.getByRole('button', { name: /Replying to Sam/ }));
    await waitFor(() => expect(scroll).toHaveBeenCalled());
  });
});

describe('the Chats and Home badges', () => {
  const chats = [
    conv({ riverId: 'a', unread: 2 }),
    conv({ riverId: 'archived', unread: 5, archived: true }),
    conv({ riverId: 'request', unread: 7, state: 'request' }),
    conv({ riverId: 'blocked', unread: 11, state: 'blocked' }),
  ];
  const prefs = (countArchived: boolean) => ({ ...DEFAULT_SETTINGS.notifications, countArchived });

  it('leave out archived chats and message requests, unless archived chats are counted', () => {
    expect(chatsBadge(chats, prefs(false))).toBe(2);
    expect(totalUnread(chats, prefs(false))).toBe(2);
    expect(chatsBadge(chats, prefs(true))).toBe(7);
    expect(totalUnread(chats, prefs(true))).toBe(7);
  });
});
