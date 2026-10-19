import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountService } from '../src/main/account/account-service.ts';
import { CommunityService } from '../src/main/community/community-service.ts';
import type { IdentityService } from '../src/main/identity/identity-service.ts';
import { nullLogger } from '../src/main/logger.ts';
import type { CommunityEvent, CommunityView } from '../src/shared/ipc.ts';

/** A burst of presence changes (everyone at once after a reconnect) reaches the window as one update. */

afterEach(() => vi.useRealTimers());

function service(): { svc: CommunityService; events: CommunityEvent[]; handle(e: unknown): void } {
  const svc = new CommunityService({
    db: () => null,
    account: {} as AccountService,
    identity: { get: () => null } as unknown as IdentityService,
    requestJson: async () => ({}) as never,
    requestBytes: async () => new Uint8Array() as never,
    blobDir: () => null,
    log: nullLogger,
    createSocket: () => ({ send() {}, close() {}, readyState: 0 }) as unknown as WebSocket,
  });
  const members = Array.from({ length: 1000 }, (_, i) => ({
    riverId: `m${i}`,
    name: `M${i}`,
    online: false,
  }));
  const internal = svc as unknown as { communities: CommunityView[]; handle(e: unknown): void };
  internal.communities = [
    { id: 'c', members } as unknown as CommunityView,
    { id: 'd', members: [{ riverId: 'x', online: false }] } as unknown as CommunityView,
  ];
  const events: CommunityEvent[] = [];
  svc.onEvent((e) => events.push(e));
  return { svc, events, handle: (e) => internal.handle(e) };
}

describe('presence bursts', () => {
  it('applies every change in a burst and tells the window once', () => {
    vi.useFakeTimers();
    const { events, handle } = service();
    for (let i = 0; i < 300; i++) handle({ t: 'presence', riverId: `m${i}`, online: true });
    handle({ t: 'presence', riverId: 'm5', online: true, status: 'dnd' });
    handle({ t: 'presence', riverId: 'm7', online: false });
    expect(events).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(events).toHaveLength(1);
    const [c, d] = (events[0] as Extract<CommunityEvent, { t: 'communities' }>).communities;
    expect(c!.members.filter((m) => m.online)).toHaveLength(299);
    expect(c!.members[5]).toMatchObject({ online: true, status: 'dnd' });
    expect(c!.members[7]!.online).toBe(false);
    expect(c!.members[600]!.online).toBe(false);
    // A community nobody in the burst belongs to is passed on as it was.
    expect(d!.members[0]!.online).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(events).toHaveLength(1);
  });
});
