// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock(import('../src/renderer/src/community/sound.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  play: vi.fn(),
}));

import { AdminPage } from '../src/renderer/src/pages/AdminPage.tsx';

const overview = {
  accounts: [],
  communities: [],
  signupMode: 'open',
  signups: [{ username: 'sam' }],
};
let n = 0;
const admin = {
  overview: vi.fn(async () => ({ ok: true, value: overview })),
  createSignup: vi.fn(async (username: string) => ({
    ok: true,
    value: { username, link: `river://signup/${++n}` },
  })),
  setSignupMode: vi.fn(async () => ({ ok: false, message: 'The server did not answer.' })),
  deleteSignup: vi.fn(async () => ({ ok: false, message: 'That link is already used.' })),
};
const writeText = vi.fn(async (_text: string) => undefined);

beforeEach(() => {
  n = 0;
  (window as unknown as { river: unknown }).river = { admin };
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(cleanup);

const flush = () => act(async () => undefined);

describe('admin: sign-up links', () => {
  it('a new link is not shown as copied; a failed copy says so', async () => {
    render(<AdminPage />);
    await flush();
    const field = screen.getByLabelText('Username for the new account');
    fireEvent.change(field, { target: { value: 'alex' } });
    fireEvent.click(screen.getByText('Create account'));
    await flush();
    fireEvent.click(screen.getByText('Copy link'));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith('river://signup/1');
    expect(screen.getByText('Copied ✓')).toBeTruthy();
    fireEvent.change(field, { target: { value: 'blake' } });
    fireEvent.click(screen.getByText('Create account'));
    await flush();
    expect(screen.getByText('Copy link')).toBeTruthy();
    writeText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByText('Copy link'));
    await flush();
    expect(screen.getByText(/Could not copy the link/)).toBeTruthy();
  });

  it('changing who may sign up, or cancelling a link, says when it fails', async () => {
    render(<AdminPage />);
    await flush();
    fireEvent.click(screen.getByText('Make invite-only'));
    await flush();
    expect(screen.getByText('The server did not answer.')).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    await flush();
    expect(screen.getByText('That link is already used.')).toBeTruthy();
  });
});
