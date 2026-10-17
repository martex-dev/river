// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedView, PostView } from '../src/shared/social.ts';
import {
  Composer,
  ProfileModal,
  STORY_STALL_MS,
  StoryViewer,
  type StoryAt,
} from '../src/renderer/src/pages/SocialPage.tsx';
import { useSocial } from '../src/renderer/src/social/store.ts';

const story = (id: string, author: string, over: Partial<PostView> = {}): PostView => ({
  id,
  author,
  authorName: author,
  authorAvatar: null,
  mine: false,
  kind: 'story',
  text: `story ${id}`,
  attachments: [],
  createdAt: new Date().toISOString(),
  expiresAt: null,
  reactions: [],
  comments: [],
  audience: 0,
  viewers: [],
  seen: false,
  ...over,
});
const group = (riverId: string, stories: PostView[], unseen = true): FeedView['stories'][number] => ({
  riverId,
  name: riverId,
  avatar: null,
  mine: false,
  stories,
  unseen,
});
const feedOf = (stories: FeedView['stories']): FeedView => ({ posts: [], stories, friends: [] });
const pointer = (id: string) => ({
  id,
  key: 'k'.repeat(86),
  digest: 'd'.repeat(43),
  size: 3,
  name: 'x',
  mime: id.startsWith('v') ? 'video/mp4' : 'image/jpeg',
});

const social = vi.fn(
  async (a: { a: string }): Promise<{ ok: boolean; value?: unknown; message?: string }> => ({
    ok: true,
    value: a.a === 'feed' ? feedOf([]) : null,
  }),
);
const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  vi.useRealTimers();
  social.mockClear();
  created.length = 0;
  revoked.length = 0;
  URL.createObjectURL = (() => {
    const u = `blob:${created.length + 1}`;
    created.push(u);
    return u;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((u: string) => void revoked.push(u)) as typeof URL.revokeObjectURL;
  // jsdom has no media playback.
  HTMLMediaElement.prototype.play = async () => undefined;
  HTMLMediaElement.prototype.pause = () => undefined;
  (window as unknown as { river: unknown }).river = {
    social: { action: social },
    community: { action: vi.fn(async () => ({ ok: true, value: new Uint8Array([1, 2, 3]) })) },
    dm: { action: vi.fn(async () => ({ ok: true, value: null })) },
  };
  useSocial.setState({ feed: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Viewer(props: { feed: FeedView; at: StoryAt; onMove?(at: StoryAt): void; onClose?(): void }) {
  return (
    <StoryViewer
      feed={props.feed}
      at={props.at}
      onMove={props.onMove ?? (() => undefined)}
      onClose={props.onClose ?? (() => undefined)}
    />
  );
}

describe('story viewer', () => {
  it('follows the story by ID when marking it seen re-sorts the feed, and closes when it is gone', () => {
    const a = group('alice', [story('a1', 'alice'), story('a2', 'alice')]);
    const b = group('bob', [story('b1', 'bob')]);
    const onMove = vi.fn();
    const onClose = vi.fn();
    const at = { riverId: 'alice', storyId: 'a1', index: 0 };
    const { rerender } = render(<Viewer feed={feedOf([a, b])} at={at} onMove={onMove} onClose={onClose} />);
    expect(screen.getByText('story a1')).toBeTruthy();
    // Alice's story was seen: her group sorts after Bob's. The viewer still shows hers.
    rerender(
      <Viewer feed={feedOf([b, { ...a, unseen: false }])} at={at} onMove={onMove} onClose={onClose} />,
    );
    expect(screen.getByText('story a1')).toBeTruthy();
    // Next goes to Alice's second story, then to Bob (the order when it opened).
    fireEvent.click(screen.getByLabelText('Next'));
    expect(onMove).toHaveBeenLastCalledWith({ riverId: 'alice', storyId: 'a2', index: 1 });
    // The story disappeared: the one now at its place.
    rerender(
      <Viewer
        feed={feedOf([b, group('alice', [story('a2', 'alice')])])}
        at={at}
        onMove={onMove}
        onClose={onClose}
      />,
    );
    expect(onMove).toHaveBeenLastCalledWith({ riverId: 'alice', storyId: 'a2', index: 0 });
    // All of that person's stories are gone: the viewer closes instead of crashing.
    rerender(<Viewer feed={feedOf([b])} at={at} onMove={onMove} onClose={onClose} />);
    expect(onClose).toHaveBeenCalled();
  });

  it('arrow keys and Esc while typing a reply stay in the reply box', () => {
    const onMove = vi.fn();
    const onClose = vi.fn();
    render(
      <Viewer
        feed={feedOf([group('alice', [story('a1', 'alice'), story('a2', 'alice')])])}
        at={{ riverId: 'alice', storyId: 'a1', index: 0 }}
        onMove={onMove}
        onClose={onClose}
      />,
    );
    const input = screen.getByLabelText('Reply to alice');
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onMove).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onMove).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the timer starts only once the picture is shown', async () => {
    vi.useFakeTimers();
    const onMove = vi.fn();
    render(
      <Viewer
        feed={feedOf([
          group('alice', [story('a1', 'alice', { attachments: [pointer('p1')] }), story('a2', 'alice')]),
        ])}
        at={{ riverId: 'alice', storyId: 'a1', index: 0 }}
        onMove={onMove}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const img = document.querySelector('.story-viewer__content img')!;
    expect(img).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.load(img);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6100);
    });
    expect(onMove).toHaveBeenCalledWith({ riverId: 'alice', storyId: 'a2', index: 1 });
  });

  it('plays a video story (muted, inline) and moves on when it ends', async () => {
    const onMove = vi.fn();
    render(
      <Viewer
        feed={feedOf([
          group('alice', [story('a1', 'alice', { attachments: [pointer('v1')] }), story('a2', 'alice')]),
        ])}
        at={{ riverId: 'alice', storyId: 'a1', index: 0 }}
        onMove={onMove}
      />,
    );
    const video = (await screen.findByLabelText('story a1')) as HTMLVideoElement;
    expect(video.tagName).toBe('VIDEO');
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    fireEvent.ended(video);
    expect(onMove).toHaveBeenCalledWith({ riverId: 'alice', storyId: 'a2', index: 1 });
  });

  it('a video whose metadata never loads does not freeze the viewer', async () => {
    vi.useFakeTimers();
    const onMove = vi.fn();
    render(
      <Viewer
        feed={feedOf([
          group('alice', [story('a1', 'alice', { attachments: [pointer('v1')] }), story('a2', 'alice')]),
        ])}
        at={{ riverId: 'alice', storyId: 'a1', index: 0 }}
        onMove={onMove}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STORY_STALL_MS - 500);
    });
    expect(onMove).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onMove).toHaveBeenCalledWith({ riverId: 'alice', storyId: 'a2', index: 1 });
  });

  it('a video this device refuses to play is shown for a picture’s time', async () => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new Error('NotAllowedError'));
    vi.useFakeTimers();
    const onMove = vi.fn();
    render(
      <Viewer
        feed={feedOf([
          group('alice', [story('a1', 'alice', { attachments: [pointer('v1')] }), story('a2', 'alice')]),
        ])}
        at={{ riverId: 'alice', storyId: 'a1', index: 0 }}
        onMove={onMove}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const video = document.querySelector('.story-viewer__content video')!;
    fireEvent.loadedMetadata(video);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6100);
    });
    expect(onMove).toHaveBeenCalledWith({ riverId: 'alice', storyId: 'a2', index: 1 });
  });

  it('a swipe down on a touch screen closes; a hold pauses until the finger lifts', () => {
    const onClose = vi.fn();
    render(
      <Viewer
        feed={feedOf([group('alice', [story('a1', 'alice')])])}
        at={{ riverId: 'alice', storyId: 'a1', index: 0 }}
        onClose={onClose}
      />,
    );
    const frame = document.querySelector('.story-viewer__frame')!;
    const fill = () => document.querySelector<HTMLElement>('.story-viewer__fill')!;
    fireEvent.pointerDown(frame, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 });
    expect(fill().style.animationPlayState).toBe('paused');
    fireEvent.pointerCancel(frame, { pointerType: 'touch', pointerId: 1 });
    expect(fill().style.animationPlayState).toBe('running');
    fireEvent.pointerDown(frame, { pointerType: 'touch', pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(frame, { pointerType: 'touch', pointerId: 2, clientX: 105, clientY: 260 });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('profile and composer', () => {
  it('a bio that could not be saved is not shown as saved', async () => {
    const profile = {
      riverId: 'me',
      name: 'Me',
      avatar: null,
      bio: 'old',
      isMe: true,
      isContact: false,
      posts: [],
    };
    social.mockImplementation(async (a: { a: string }) =>
      a.a === 'profile'
        ? { ok: true, value: profile }
        : a.a === 'setBio'
          ? { ok: false, message: 'River is locked.' }
          : { ok: true, value: a.a === 'feed' ? feedOf([]) : null },
    );
    render(<ProfileModal riverId="me" onClose={() => undefined} onOpenPost={() => undefined} />);
    fireEvent.click(await screen.findByText('Edit bio'));
    fireEvent.change(screen.getByLabelText('Your bio'), { target: { value: 'new bio' } });
    fireEvent.click(screen.getByText('Save'));
    await act(async () => undefined);
    expect((screen.getByLabelText('Your bio') as HTMLTextAreaElement).value).toBe('new bio');
    expect(screen.queryByText('Bio saved')).toBeNull();
  });

  it('the profile reloads when the feed changes (a like, a comment, a delete)', async () => {
    social.mockImplementation(async (a: { a: string }) => ({
      ok: true,
      value:
        a.a === 'profile'
          ? { riverId: 'x', name: 'X', avatar: null, bio: '', isMe: false, isContact: true, posts: [] }
          : null,
    }));
    render(<ProfileModal riverId="x" onClose={() => undefined} onOpenPost={() => undefined} />);
    await screen.findByText('No posts yet.');
    const profiles = () => social.mock.calls.filter(([a]) => a.a === 'profile').length;
    const before = profiles();
    act(() => useSocial.setState({ feed: feedOf([]) }));
    await act(async () => undefined);
    expect(profiles()).toBe(before + 1);
  });

  it('frees picture previews when one is removed, when they do not fit, and on close', () => {
    const { unmount } = render(<Composer kind="post" friends={[]} onClose={() => undefined} />);
    const input = screen.getByLabelText('Add photos or videos') as HTMLInputElement;
    const files = Array.from(
      { length: 11 },
      (_, i) => new File([String(i)], `p${i}.png`, { type: 'image/png' }),
    );
    fireEvent.change(input, { target: { files } });
    expect(created).toHaveLength(11);
    // Eleven chosen, ten fit: the extra one's preview is freed at once.
    expect(revoked).toEqual([created[10]]);
    fireEvent.click(screen.getAllByLabelText(/Remove/)[0]!);
    expect(revoked).toHaveLength(2);
    unmount();
    expect(new Set(revoked)).toEqual(new Set(created));
  });
});
