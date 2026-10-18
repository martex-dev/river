// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallView, DmEvent } from '../src/shared/dm.ts';
import { CallsPage, callLabel } from '../src/renderer/src/pages/CallsPage.tsx';
import { useRiver } from '../src/renderer/src/store.ts';

const PEER = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const entry = (id: string, over: Partial<CallView> = {}): CallView => ({
  id,
  peer: PEER,
  name: 'Sam',
  avatar: null,
  direction: 'in',
  video: false,
  answered: false,
  outcome: 'missed',
  durationSec: 0,
  startedAt: '2026-10-12T10:00:00.000Z',
  ...over,
});

let calls: CallView[] = [];
let listener: ((e: DmEvent) => void) | null = null;

beforeEach(() => {
  calls = [entry('a')];
  listener = null;
  (window as unknown as { river: unknown }).river = {
    dm: {
      // The history; the call links list (2.18) is empty.
      action: vi.fn(async (a: { a: string }) => ({ ok: true, value: a.a === 'callLinks' ? [] : calls })),
      onEvent: (l: (e: DmEvent) => void) => {
        listener = l;
        return () => {
          listener = null;
        };
      },
    },
  };
  useRiver.setState({ account: { state: 'registered' } as never });
});
afterEach(cleanup);

describe('calls page', () => {
  it('names declined and failed calls, and shows a new call as soon as it is logged', async () => {
    render(<CallsPage />);
    expect(await screen.findByText(/↙ Missed/)).toBeTruthy();
    calls = [entry('b', { outcome: 'declined' }), ...calls];
    await act(async () => listener?.({ t: 'calls' }));
    expect(await screen.findByText(/↙ Declined/)).toBeTruthy();
  });

  it('labels every outcome', () => {
    expect(callLabel({ direction: 'in', answered: true, outcome: 'answered' })).toBe('↙ Incoming');
    expect(callLabel({ direction: 'out', answered: false, outcome: 'missed' })).toBe('↗ No answer');
    expect(callLabel({ direction: 'in', answered: false, outcome: 'failed' })).toBe('↙ Could not connect');
    // Entries from older versions have no outcome.
    expect(callLabel({ direction: 'in', answered: false })).toBe('↙ Missed');
  });
});
