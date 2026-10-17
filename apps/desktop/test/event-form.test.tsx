// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventForm, durationLabel } from '../src/renderer/src/community/ui/Events.tsx';

const action = vi.fn(async (..._args: unknown[]) => ({ ok: true, value: null }));
const community = { id: 'c1', channels: [], categories: [] } as never;

beforeEach(() => {
  action.mockClear();
  (window as unknown as { river: unknown }).river = { community: { action } };
});
afterEach(cleanup);

describe('event form', () => {
  it('a half-typed start time does not crash the form; Save waits for a valid time', () => {
    render(<EventForm community={community} event={null} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Game night' } });
    const start = screen.getByLabelText('Starts');
    fireEvent.change(start, { target: { value: '' } });
    expect(screen.getByText('Choose a date and time.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create event' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(start, { target: { value: '2030-05-01T19:00' } });
    expect((screen.getByRole('button', { name: 'Create event' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('editing a 90-minute event keeps its length', () => {
    const event = {
      id: 'e1',
      name: 'Long one',
      description: '',
      place: 'Here',
      channelId: null,
      startsAt: '2030-05-01T18:00:00.000Z',
      endsAt: '2030-05-01T19:30:00.000Z',
    } as never;
    render(<EventForm community={community} event={event} onClose={() => undefined} />);
    const lasts = screen.getByLabelText('Lasts') as HTMLSelectElement;
    expect(lasts.value).toBe(String(90 * 60_000));
    expect(lasts.selectedOptions[0]!.textContent).toBe('1 hour 30 minutes');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const sent = action.mock.calls[0]![0] as { startsAt: string; endsAt: string };
    expect(Date.parse(sent.endsAt) - Date.parse(sent.startsAt)).toBe(90 * 60_000);
  });

  it('names odd lengths in plain words', () => {
    expect(durationLabel(90 * 60_000)).toBe('1 hour 30 minutes');
    expect(durationLabel(2 * 86_400_000)).toBe('2 days');
  });
});
