// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock(import('../src/renderer/src/community/sound.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  play: vi.fn(),
}));

import { play } from '../src/renderer/src/community/sound.ts';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { useDm } from '../src/renderer/src/dm/store.ts';
import { useRiver } from '../src/renderer/src/store.ts';
import { IncomingCall } from '../src/renderer/src/dm/CallUi.tsx';
import { GroupCallBar, GroupCallOverlays } from '../src/renderer/src/dm/GroupCallUi.tsx';
import {
  acceptDmCall,
  declineDmCall,
  endDmCall,
  handleCallEvent,
  useDmCall,
} from '../src/renderer/src/dm/call.ts';
import { callRoomOf } from '../src/renderer/src/dm/call-common.ts';
import {
  GROUP_RING_MS,
  NOBODY_CAME_MS,
  askToJoin,
  handleGroupCallEvent,
  handleRoster,
  inCall,
  leaveGroupCall,
  offerCallLink,
  startGroupCall,
  useGroupCall,
} from '../src/renderer/src/dm/group-call.ts';
import type { ConversationView } from '../src/shared/dm.ts';

/** Everything group calls send goes through window.river: recorded here. */
const dmAction = vi.fn();
const groupCallRoom = vi.fn();
const watchCallRooms = vi.fn();
let groupCalls = true;
let mic: () => Promise<unknown>;

function fakeTrack(): unknown {
  const t = { kind: 'audio', enabled: true, stop: () => undefined, clone: () => fakeTrack() };
  return t;
}
const stream = (): unknown => {
  const t = fakeTrack();
  return { getAudioTracks: () => [t], getVideoTracks: () => [], getTracks: () => [t] };
};

// Our ID sorts after everyone's, so we wait for their offers (no WebRTC needed here).
const ME = 'ffffffff-0000-4000-8000-000000000000';
const BOB = '00000001-0000-4000-8000-000000000000';
const CAROL = '00000002-0000-4000-8000-000000000000';
const STRANGER = '00000003-0000-4000-8000-000000000000';
const GROUP = 'GGGGGGGGGGGGGGGGGGGGGG';
const CALL = 'CCCCCCCCCCCCCCCCCCCCCC';

const group: ConversationView = {
  riverId: GROUP,
  kind: 'group',
  members: [
    { riverId: ME, name: 'Me', avatar: null, admin: true },
    { riverId: BOB, name: 'Bob', avatar: null, admin: false },
    { riverId: CAROL, name: 'Carol', avatar: null, admin: false },
  ],
  isAdmin: true,
  name: 'Climb',
  avatar: null,
  state: 'accepted',
  awaitingReply: false,
  last: null,
  unread: 0,
  verified: false,
  keyChanged: false,
};

const actions = (a: string, kind?: string) =>
  dmAction.mock.calls
    .map(([x]) => x as { a: string; kind?: string; [k: string]: unknown })
    .filter((x) => x.a === a && (kind === undefined || x.kind === kind));

const ring = () =>
  handleCallEvent({
    t: 'call',
    peer: BOB,
    callId: CALL,
    kind: 'invite',
    video: false,
    group: { id: GROUP, name: 'Climb', people: 3 },
  });

async function roster(participants: string[], callId = CALL): Promise<void> {
  await act(async () => handleRoster({ room: await callRoomOf(callId), participants }));
}

beforeEach(() => {
  dmAction.mockReset();
  // Main answers who may be in a call: the group's members, or for a call link (Bob's) the
  // people its host let in.
  dmAction.mockImplementation(async (a: { a: string; groupId?: string }) => ({
    ok: true,
    value: a.a === 'groupCall' ? { allowed: a.groupId ? [ME, BOB, CAROL] : [BOB, ME] } : null,
  }));
  groupCallRoom.mockReset();
  groupCallRoom.mockResolvedValue(undefined);
  watchCallRooms.mockReset();
  groupCalls = true;
  mic = async () => stream();
  (window as unknown as { river: unknown }).river = {
    dm: { action: dmAction },
    community: { action: vi.fn().mockResolvedValue({ ok: true, value: null }) },
    voice: {
      iceServers: async () => [],
      relayInfo: async () => ({ all: true, groupCalls }),
      callRoom: vi.fn(),
      groupCallRoom,
      watchCallRooms,
      relay: vi.fn(),
      relayAll: vi.fn(),
      join: vi.fn().mockResolvedValue({ ok: true, value: null }),
      leave: vi.fn().mockResolvedValue({ ok: true, value: null }),
      signal: vi.fn().mockResolvedValue({ ok: true, value: null }),
      shareStatus: vi.fn(),
      setSpeaker: vi.fn().mockResolvedValue(undefined),
    },
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => mic() },
  });
  useRiver.setState({
    identity: { riverId: ME, displayName: 'Me' },
    navigate: vi.fn(),
    info: { platform: 'win32' },
    account: { state: 'registered', serverUrl: 'https://river.example', shareUrl: 'https://river.example' },
  } as unknown as Partial<ReturnType<typeof useRiver.getState>>);
  useDm.setState({ conversations: [group], selected: null } as never);
  useCommunity.setState({ call: null, selfMuted: false, selfDeafened: false, communities: [], toast: null });
  useDmCall.setState({ incoming: null, active: null });
  useGroupCall.setState({
    known: {},
    rosters: {},
    allowed: {},
    active: null,
    knocks: [],
    asking: null,
    madeLink: null,
  });
});

afterEach(async () => {
  cleanup();
  await leaveGroupCall(false);
  await endDmCall();
  vi.useRealTimers();
});

describe('group calls (2.18)', () => {
  it('starting: you join the call room first, then the group rings — once, however often you click', async () => {
    await Promise.all([startGroupCall(GROUP, false), startGroupCall(GROUP, false)]);
    expect(actions('groupCall', 'ring')).toEqual([
      expect.objectContaining({ groupId: GROUP, video: false, callId: expect.any(String) }),
    ]);
    const callId = useGroupCall.getState().active!.callId;
    expect(groupCallRoom).toHaveBeenCalledWith(await callRoomOf(callId));
    // In the room before anyone rings.
    expect(groupCallRoom.mock.invocationCallOrder[0]).toBeLessThan(
      dmAction.mock.invocationCallOrder[dmAction.mock.calls.findIndex(([a]) => a.kind === 'ring')]!,
    );
    expect(useCommunity.getState().call?.channelId).toBe(`gcall:${callId}`);
    expect(play).toHaveBeenCalledWith('ringback');
  });

  it('who the server says is in the call is checked against the group: nobody else gets in', async () => {
    await startGroupCall(GROUP, false);
    const callId = useGroupCall.getState().active!.callId;
    await roster([ME, BOB, STRANGER], callId);
    expect(inCall(callId)).toEqual([ME, BOB]);
    expect(
      useCommunity
        .getState()
        .call!.remotes()
        .map((r) => r.id),
    ).toEqual([BOB]);
  });

  it('a ring shows "Group call · 3 people" and answering joins the call', async () => {
    ring();
    expect(useDmCall.getState().incoming).toMatchObject({ callId: CALL, group: { id: GROUP } });
    render(<IncomingCall />);
    expect(screen.getByRole('alertdialog', { name: 'Incoming group call in Climb' })).toBeTruthy();
    expect(screen.getByText('Group call · 3 people')).toBeTruthy();
    expect(screen.getByText(/Bob is calling/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    });
    await vi.waitFor(() => expect(groupCallRoom).toHaveBeenCalledWith(expect.any(String)));
    expect(actions('groupCall', 'join')).toEqual([expect.objectContaining({ callId: CALL, groupId: GROUP })]);
    expect(useDmCall.getState().incoming).toBeNull();
    expect(useGroupCall.getState().active).toMatchObject({ callId: CALL, groupId: GROUP, outgoing: false });
    // Leaving: the history names the group and how many were in it.
    await roster([ME, BOB]);
    await leaveGroupCall();
    expect(actions('logCall')).toEqual([
      expect.objectContaining({ peer: GROUP, kind: 'group', direction: 'in', people: 2 }),
    ]);
    expect(actions('groupCall', 'leave')).toHaveLength(1);
    expect(groupCallRoom).toHaveBeenLastCalledWith(null);
  });

  it('declining tells who rang and is logged as declined', () => {
    ring();
    declineDmCall();
    expect(actions('groupCall', 'decline')).toEqual([
      expect.objectContaining({ callId: CALL, groupId: GROUP, to: [BOB] }),
    ]);
    expect(actions('logCall')).toEqual([
      expect.objectContaining({ peer: GROUP, kind: 'group', outcome: 'declined', answered: false }),
    ]);
  });

  it('a ring nobody answers is missed; one whose call ended stops ringing', async () => {
    vi.useFakeTimers();
    ring();
    vi.advanceTimersByTime(GROUP_RING_MS);
    expect(useDmCall.getState().incoming).toBeNull();
    expect(actions('logCall')).toEqual([
      expect.objectContaining({ peer: GROUP, kind: 'group', answered: false }),
    ]);
    expect(useCommunity.getState().toast?.text).toMatch(/Missed group call in Climb/);
    vi.useRealTimers();

    dmAction.mockClear();
    ring();
    await roster([BOB]);
    await roster([]);
    expect(useDmCall.getState().incoming).toBeNull();
    expect(actions('logCall')).toHaveLength(1);
  });

  it('a 1:1 call while in a group call is answered "busy"', async () => {
    await startGroupCall(GROUP, false);
    handleCallEvent({ t: 'call', peer: BOB, callId: 'call-1', kind: 'invite', video: false });
    expect(actions('call', 'busy')).toHaveLength(1);
    expect(useDmCall.getState().incoming).toBeNull();
  });

  it('the group shows "Call in progress" with who is in it, and Join', async () => {
    ring();
    declineDmCall();
    await roster([BOB, CAROL]);
    render(<GroupCallBar conversation={group} />);
    expect(screen.getByRole('region', { name: 'Call in progress' }).textContent).toMatch(/Bob and Carol/);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    });
    await vi.waitFor(() => expect(actions('groupCall', 'join')).toHaveLength(1));
    // In the call: the bar gives way to the call.
    await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Call in progress' })).toBeNull());
  });

  it('when the last one leaves the call is over: no more "Join"', async () => {
    ring();
    declineDmCall();
    await roster([BOB]);
    expect(Object.keys(useGroupCall.getState().known)).toEqual([CALL]);
    await roster([]);
    expect(useGroupCall.getState().known).toEqual({});
  });

  it('a server without group calls says so, and nothing is joined', async () => {
    groupCalls = false;
    await startGroupCall(GROUP, false);
    expect(useGroupCall.getState().active).toBeNull();
    expect(groupCallRoom).not.toHaveBeenCalled();
    expect(actions('groupCall', 'ring')).toEqual([]);
    expect(useCommunity.getState().toast?.text).toMatch(/server doesn't have group calls/);
  });

  it('nobody came: the call you started ends by itself', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    await startGroupCall(GROUP, false);
    expect(useGroupCall.getState().active).not.toBeNull();
    vi.advanceTimersByTime(NOBODY_CAME_MS + 6000);
    await vi.waitFor(() => expect(useGroupCall.getState().active).toBeNull());
    expect(useCommunity.getState().toast?.text).toMatch(/Nobody joined/);
  });

  it('connection setup from people outside the call is ignored', async () => {
    await startGroupCall(GROUP, false);
    const callId = useGroupCall.getState().active!.callId;
    await roster([ME, BOB], callId);
    const call = useCommunity.getState().call!;
    const handle = vi.spyOn(call, 'handleSignal');
    handleGroupCallEvent({ t: 'gcall', kind: 'signal', callId, from: STRANGER, groupId: GROUP, data: {} });
    expect(handle).not.toHaveBeenCalled();
    handleGroupCallEvent({
      t: 'gcall',
      kind: 'signal',
      callId,
      from: BOB,
      groupId: GROUP,
      data: { type: 'hello' },
    });
    expect(handle).toHaveBeenCalledWith(BOB, { type: 'hello' });
  });
});

describe('call links (2.18)', () => {
  const HOST = BOB;
  const LINK = 'LLLLLLLLLLLLLLLLLLLLLL';
  const url = `https://river.example/call#h=${HOST}&l=${LINK}`;

  it('opening a link asks first; asking sends a knock; being let in joins the call', async () => {
    offerCallLink(url);
    render(<GroupCallOverlays />);
    expect(screen.getByRole('dialog', { name: 'Join the call?' })).toBeTruthy();
    expect(actions('knock')).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });
    expect(actions('knock')).toEqual([{ a: 'knock', host: HOST, link: LINK }]);
    expect(screen.getByText(/Waiting for/)).toBeTruthy();
    // Someone else saying "you're in" is ignored.
    handleGroupCallEvent({ t: 'gcall', kind: 'admitted', callId: CALL, from: CAROL, allowed: [CAROL, ME] });
    expect(useGroupCall.getState().active).toBeNull();
    await act(async () =>
      handleGroupCallEvent({
        t: 'gcall',
        kind: 'admitted',
        callId: CALL,
        from: HOST,
        host: HOST,
        video: false,
        title: 'Standup',
        allowed: [HOST, ME],
      }),
    );
    await vi.waitFor(() => expect(groupCallRoom).toHaveBeenCalledWith(expect.any(String)));
    expect(useGroupCall.getState().active).toMatchObject({ callId: CALL, groupId: null, host: HOST });
    // The call shows over River (it has no conversation).
    expect(await screen.findByRole('region', { name: 'Call: Standup' })).toBeTruthy();
    await roster([HOST, ME, CAROL]);
    // Carol was not let in (as far as the host told us): she is not in the call here.
    expect(inCall(CALL)).toEqual([HOST, ME]);
  });

  it('a refused or unknown link says so', async () => {
    offerCallLink(url);
    await askToJoin();
    handleGroupCallEvent({ t: 'knockAnswer', link: LINK, host: HOST, answer: 'deny' });
    expect(useGroupCall.getState().asking?.state).toBe('denied');
    offerCallLink('https://other.example/call#h=' + HOST + '&l=' + LINK);
    expect(useCommunity.getState().toast?.text).toMatch(/another River server/);
    offerCallLink('https://river.example/call#h=nope');
    expect(useCommunity.getState().toast?.text).toMatch(/not complete/);
  });

  it('host: someone asking shows with Let in and Deny', async () => {
    render(<GroupCallOverlays />);
    await act(async () =>
      handleGroupCallEvent({ t: 'knock', link: LINK, from: CAROL, name: 'Carol', contact: false }),
    );
    expect(screen.getByText(/asks to join your call/)).toBeTruthy();
    expect(screen.getByText(/not in your friends/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Let Carol in' }));
    });
    expect(actions('answerKnock')).toEqual([{ a: 'answerKnock', link: LINK, who: CAROL, admit: true }]);
    expect(screen.queryByText(/asks to join your call/)).toBeNull();
  });

  it('answering a 1:1 call while in a group call leaves the group call', async () => {
    await startGroupCall(GROUP, false);
    useGroupCall.setState({ active: { ...useGroupCall.getState().active! } });
    handleCallEvent({ t: 'call', peer: BOB, callId: 'call-9', kind: 'invite', video: false });
    // Busy while in a group call: nothing rings.
    expect(useDmCall.getState().incoming).toBeNull();
    await leaveGroupCall();
    handleCallEvent({ t: 'call', peer: BOB, callId: 'call-10', kind: 'invite', video: false });
    await acceptDmCall(false);
    expect(useCommunity.getState().call?.channelId).toBe(`dm:${BOB}`);
  });
});
