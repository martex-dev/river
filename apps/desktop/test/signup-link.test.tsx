// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PasteToJoin, SignupDialog } from '../src/renderer/src/community/ui/PasteToJoin.tsx';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { useRiver } from '../src/renderer/src/store.ts';
import type { AccountStatus, DeepLink } from '../src/shared/ipc.ts';

const CODE = 'A'.repeat(22);
const ATTACKER_LINK = `https://attacker.example/add#s=${CODE}`;

const REGISTERED: AccountStatus = {
  state: 'registered',
  server: 'attacker.example',
  serverUrl: 'https://attacker.example',
  shareUrl: 'https://attacker.example',
  riverId: '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e4b71',
  deviceId: 1,
  devices: 1,
  listVersion: 1,
  connection: 'online',
  username: null,
};

const redeemSignup = vi.fn();
const takeDeepLink = vi.fn<() => Promise<DeepLink | null>>();

beforeEach(() => {
  redeemSignup.mockReset();
  takeDeepLink.mockReset();
  (window as unknown as { river: unknown }).river = {
    app: { takeDeepLink, onDeepLink: () => () => undefined },
    account: { redeemSignup },
    security: { status: async () => ({}) },
  };
  // River is open with an identity (links that opened River wait for that, 2.14).
  useRiver.setState({
    account: { state: 'none' },
    storage: { state: 'open' } as never,
    identity: { riverId: '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e4b71' } as never,
    onboarding: false,
  });
  useCommunity.setState({ modal: null });
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { river?: unknown }).river;
});

describe('sign-up links from outside River', () => {
  it('only ask: a deep link never creates an account by itself', async () => {
    takeDeepLink.mockResolvedValue({ kind: 'signup', link: ATTACKER_LINK });
    render(<PasteToJoin />);
    await waitFor(() =>
      expect(useCommunity.getState().modal).toEqual({ kind: 'signup', link: ATTACKER_LINK }),
    );
    expect(redeemSignup).not.toHaveBeenCalled();
  });

  it('is refused when an account already exists, without a dialog', async () => {
    useRiver.setState({ account: REGISTERED });
    takeDeepLink.mockResolvedValue({ kind: 'signup', link: ATTACKER_LINK });
    render(<PasteToJoin />);
    await waitFor(() => expect(takeDeepLink).toHaveBeenCalled());
    expect(useCommunity.getState().modal).toBeNull();
    expect(redeemSignup).not.toHaveBeenCalled();
  });

  it('waits while River is still starting or on its first screen (that screen takes invites itself)', async () => {
    takeDeepLink.mockResolvedValue({ kind: 'signup', link: ATTACKER_LINK });
    useRiver.setState({ onboarding: true });
    render(<PasteToJoin />);
    await act(async () => undefined);
    expect(takeDeepLink).not.toHaveBeenCalled();
    act(() => useRiver.setState({ onboarding: false }));
    await waitFor(() => expect(takeDeepLink).toHaveBeenCalled());
  });

  it('names the server and creates the account only when confirmed', async () => {
    redeemSignup.mockResolvedValue({ ok: true, value: REGISTERED });
    render(<SignupDialog link={ATTACKER_LINK} />);
    expect(screen.getByText('attacker.example')).toBeTruthy();
    expect(redeemSignup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Create account'));
    await waitFor(() => expect(redeemSignup).toHaveBeenCalledTimes(1));
    expect(redeemSignup).toHaveBeenCalledWith(ATTACKER_LINK);
  });

  it('does not create anything when the person says not now', () => {
    render(<SignupDialog link={ATTACKER_LINK} />);
    fireEvent.click(screen.getByText('Not now'));
    expect(redeemSignup).not.toHaveBeenCalled();
  });

  it('cannot be confirmed when the link is not a valid sign-up link', () => {
    render(<SignupDialog link="https://attacker.example/not-a-signup" />);
    expect(screen.getByText('This sign-up link is not valid.')).toBeTruthy();
    expect((screen.getByText('Create account') as HTMLButtonElement).disabled).toBe(true);
    expect(redeemSignup).not.toHaveBeenCalled();
  });
});
