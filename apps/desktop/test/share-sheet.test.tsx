// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedContent } from '../src/shared/ipc.ts';
import { ShareSheet, toIncoming, useShare } from '../src/renderer/src/components/ShareSheet.tsx';
import { useDm } from '../src/renderer/src/dm/store.ts';
import { useRiver } from '../src/renderer/src/store.ts';

let shareListener: ((c: SharedContent) => void) | null = null;

beforeEach(() => {
  shareListener = null;
  useShare.setState({ incoming: null, ready: null });
  (window as unknown as { river: unknown }).river = {
    app: {
      onShare: (l: (c: SharedContent) => void) => {
        shareListener = l;
        return () => undefined;
      },
    },
    dm: { action: vi.fn(async () => ({ ok: true, value: null })) },
  };
  useDm.setState({
    conversations: [
      {
        riverId: 'alice-id',
        kind: 'direct',
        members: [],
        isAdmin: false,
        name: 'Alice',
        state: 'accepted',
      } as never,
      {
        riverId: 'bob-id',
        kind: 'direct',
        members: [],
        isAdmin: false,
        name: 'Bob',
        state: 'accepted',
      } as never,
    ],
  });
});

afterEach(cleanup);

describe('Share → River', () => {
  it('turns shared bytes into files and caps what it accepts', () => {
    const incoming = toIncoming({
      text: 'x'.repeat(5000),
      files: Array.from({ length: 12 }, (_, i) => ({
        name: `p${i}.jpg`,
        type: 'image/jpeg',
        data: new Uint8Array([i]),
      })),
    });
    expect(incoming.text).toHaveLength(4000);
    expect(incoming.files).toHaveLength(10);
    expect(incoming.files[0]).toBeInstanceOf(File);
    expect(incoming.files[0]!.type).toBe('image/jpeg');
  });

  it('asks where to send, then hands text and files to that conversation once', () => {
    const navigate = vi.fn();
    useRiver.setState({ navigate } as never);
    const select = vi.fn();
    useDm.setState({ select } as never);
    render(<ShareSheet />);
    expect(screen.queryByText('Send to…')).toBeNull();

    act(() =>
      shareListener!({
        text: 'look at this',
        files: [{ name: 'a.png', type: 'image/png', data: new Uint8Array([1]) }],
      }),
    );
    fireEvent.click(screen.getByText('Bob'));

    expect(select).toHaveBeenCalledWith('bob-id');
    expect(navigate).toHaveBeenCalledWith('messages');
    // Only Bob's message box gets it, and only once per part.
    expect(useShare.getState().take('d:alice-id', 'text')).toBeNull();
    expect(useShare.getState().take('d:bob-id', 'text')).toBe('look at this');
    expect(useShare.getState().take('d:bob-id', 'text')).toBeNull();
    expect(useShare.getState().take('d:bob-id', 'files')).toHaveLength(1);
    expect(useShare.getState().ready).toBeNull();
  });

  it('cancelling drops what was shared', () => {
    render(<ShareSheet />);
    act(() => shareListener!({ text: 'hi', files: [] }));
    expect(screen.getByText(/Sharing text/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useShare.getState().incoming).toBeNull();
  });

  it('offers only conversations you can write in', () => {
    useDm.setState({
      conversations: [
        { riverId: 'a', kind: 'direct', members: [], name: 'Friend', state: 'accepted' } as never,
        { riverId: 'b', kind: 'direct', members: [], name: 'Stranger', state: 'request' } as never,
        { riverId: 'c', kind: 'direct', members: [], name: 'Blocked one', state: 'blocked' } as never,
        { riverId: 'g', kind: 'group', members: [], name: 'Old group', state: 'left' } as never,
      ],
    });
    render(<ShareSheet />);
    act(() => shareListener!({ text: 'hi', files: [] }));
    expect(screen.getByText('Friend')).toBeTruthy();
    for (const name of ['Stranger', 'Blocked one', 'Old group']) expect(screen.queryByText(name)).toBeNull();
  });
});
