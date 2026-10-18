/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts';
import { useDm } from '../src/renderer/src/dm/store.ts';
import { useRiver } from '../src/renderer/src/store.ts';
import { NotifyMenuSection } from '../src/renderer/src/community/ui/NotifyMenu.tsx';

/** Per-chat and per-community notification menus (2.17). */

const update = vi.fn(async () => undefined);
const done = vi.fn();

function withOverrides(overrides: Settings['notifications']['overrides'] = {}): void {
  useRiver.setState({
    settings: { ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications, overrides } },
    updateSettings: update,
  } as never);
}

const saved = (): Settings['notifications']['overrides'] =>
  (
    update.mock.calls.at(-1) as unknown as [
      { notifications: { overrides: Settings['notifications']['overrides'] } },
    ]
  )[0].notifications.overrides;

beforeEach(() => {
  update.mockClear();
  done.mockClear();
  withOverrides();
  useDm.setState({
    conversations: [
      { riverId: 'bob-id', kind: 'direct' },
      { riverId: 'G'.repeat(22), kind: 'group' },
    ],
  } as never);
});

afterEach(cleanup);

describe('a chat’s notification menu', () => {
  it('mutes a chat for a day', () => {
    render(<NotifyMenuSection id="bob-id" kind="conversation" onDone={done} />);
    fireEvent.click(screen.getByText(/Mute chat/));
    fireEvent.click(screen.getByText('For 1 day'));
    const until = Date.parse(saved()['bob-id']!.muteUntil!);
    expect(until - Date.now()).toBeGreaterThan(23 * 3600_000);
    expect(done).toHaveBeenCalled();
  });

  it('offers Only @mentions and replies for groups, not for a person', () => {
    const { unmount } = render(<NotifyMenuSection id="bob-id" kind="conversation" onDone={done} />);
    fireEvent.click(screen.getByText(/^Notifications/));
    expect(screen.queryByText(/Only @mentions/)).toBeNull();
    fireEvent.click(screen.getByText(/Nothing/));
    expect(saved()['bob-id']!.level).toBe('nothing');
    unmount();
    render(<NotifyMenuSection id={'G'.repeat(22)} kind="conversation" onDone={done} />);
    fireEvent.click(screen.getByText(/^Notifications/));
    fireEvent.click(screen.getByText(/Only @mentions and replies/));
    expect(saved()['G'.repeat(22)]!.level).toBe('mentions');
  });

  it('picks a sound of its own', () => {
    render(<NotifyMenuSection id="bob-id" kind="conversation" onDone={done} />);
    fireEvent.click(screen.getByText(/^Sound/));
    fireEvent.click(screen.getByText(/Chime/));
    expect(saved()['bob-id']).toEqual({ level: 'default', muteUntil: null, sound: 'chime' });
  });
});

describe('a community’s notification menu', () => {
  it('can ignore @everyone and @here', () => {
    render(<NotifyMenuSection id="C" kind="community" onDone={done} />);
    fireEvent.click(screen.getByText(/Ignore @everyone and @here/));
    expect(saved().C).toEqual({ level: 'default', muteUntil: null, suppressEveryone: true });
  });

  it('channels do not offer it', () => {
    render(<NotifyMenuSection id="ch" kind="channel" onDone={done} />);
    expect(screen.queryByText(/Ignore @everyone/)).toBeNull();
    expect(screen.getByText(/^Sound/)).toBeTruthy();
  });
});
