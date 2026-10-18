import { describe, expect, it, vi } from 'vitest';
import { MAX_GROUP_CALL_ROOM } from '@river/protocol';
import { Hub, type HubSocket } from '../src/communities/hub.ts';

/** Group call rooms (2.18): who is told who is in a call, watching, leaving and held seats. */
describe('hub group call rooms', () => {
  type Roster = { t: string; room: string; participants: string[] };
  const socket = (): HubSocket & { rosters: Roster[] } => {
    const s = {
      rosters: [] as Roster[],
      send: (d: string | Buffer) => {
        if (typeof d === 'string') {
          const e = JSON.parse(d) as Roster;
          if (e.t === 'call.roster') s.rosters.push(e);
        }
      },
      close: () => undefined,
    };
    return s;
  };
  const last = (s: { rosters: Roster[] }, room: string) =>
    s.rosters.filter((r) => r.room === room).at(-1)?.participants;

  it('tells the members and the watchers of a group room who is in it, and nobody else', () => {
    const hub = new Hub();
    const [a, b, watcher, stranger] = [socket(), socket(), socket(), socket()];
    hub.add('a', a);
    hub.add('b', b);
    hub.add('w', watcher);
    hub.add('s', stranger);
    hub.watch(watcher, ['room']);
    // Watching an empty room: told at once that nobody is in it.
    expect(last(watcher, 'room')).toEqual([]);
    hub.joinRoom('a', 'room', MAX_GROUP_CALL_ROOM, a, true);
    expect(last(watcher, 'room')).toEqual(['a']);
    expect(last(a, 'room')).toEqual(['a']);
    hub.joinRoom('b', 'room', MAX_GROUP_CALL_ROOM, b, true);
    expect(last(watcher, 'room')).toEqual(['a', 'b']);
    expect(last(a, 'room')).toEqual(['a', 'b']);
    expect(stranger.rosters).toEqual([]);
    // They may relay voice to each other, like a 1:1 call room.
    expect(hub.sharesCall('a', 'b')).toBe(true);
    expect(hub.callPeers('a')).toEqual(['b']);
    hub.leaveRoom('a');
    expect(last(watcher, 'room')).toEqual(['b']);
    // The one who left hears it too (their other devices stop showing them in the call).
    expect(last(a, 'room')).toEqual(['b']);
    hub.leaveRoom('b');
    // The last one left: over, and forgotten.
    expect(last(watcher, 'room')).toEqual([]);
    expect(hub.roster('room')).toEqual([]);
    hub.close();
  });

  it('never tells anyone who is in a private 1:1 room', () => {
    const hub = new Hub();
    const [a, watcher] = [socket(), socket()];
    hub.add('a', a);
    hub.add('w', watcher);
    hub.joinRoom('a', 'private', 8, a);
    hub.watch(watcher, ['private']);
    expect(last(watcher, 'private')).toEqual([]);
    expect(a.rosters).toEqual([]);
    hub.close();
  });

  it('a full group room turns people away', () => {
    const hub = new Hub();
    for (let i = 0; i < 3; i++) hub.add(`p${i}`, socket());
    expect(hub.joinRoom('p0', 'room', 2, undefined, true)).toBe(true);
    expect(hub.joinRoom('p1', 'room', 2, undefined, true)).toBe(true);
    expect(hub.joinRoom('p2', 'room', 2, undefined, true)).toBe(false);
    expect(hub.roster('room')).toEqual(['p0', 'p1']);
    hub.close();
  });

  it('watching replaces the rooms watched before, and a closed connection watches nothing', () => {
    const hub = new Hub();
    const w = socket();
    hub.add('w', w);
    hub.watch(w, ['one', 'two']);
    expect(hub.watchedRooms).toBe(2);
    hub.watch(w, ['two']);
    expect(hub.watchedRooms).toBe(1);
    // Rooms watched already are not sent again.
    expect(w.rosters.map((r) => r.room)).toEqual(['one', 'two']);
    hub.remove('w', w);
    expect(hub.watchedRooms).toBe(0);
    hub.close();
  });

  it('a dropped connection keeps its place for the grace period, then the others hear it left', () => {
    vi.useFakeTimers();
    try {
      const hub = new Hub({ voiceGraceMs: 1000 });
      const [a, b] = [socket(), socket()];
      hub.add('a', a);
      hub.add('b', b);
      hub.joinRoom('a', 'room', MAX_GROUP_CALL_ROOM, a, true);
      hub.joinRoom('b', 'room', MAX_GROUP_CALL_ROOM, b, true);
      hub.remove('b', b);
      expect(last(a, 'room')).toEqual(['a', 'b']);
      vi.advanceTimersByTime(1500);
      expect(last(a, 'room')).toEqual(['a']);
      hub.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejoining after a reconnect announces the room again', () => {
    const hub = new Hub();
    const [a, b] = [socket(), socket()];
    hub.add('a', a);
    hub.add('b', b);
    hub.joinRoom('a', 'room', MAX_GROUP_CALL_ROOM, a, true);
    hub.joinRoom('b', 'room', MAX_GROUP_CALL_ROOM, b, true);
    const before = a.rosters.length;
    hub.joinRoom('b', 'room', MAX_GROUP_CALL_ROOM, b, true);
    expect(a.rosters.length).toBe(before + 1);
    expect(last(a, 'room')).toEqual(['a', 'b']);
    hub.close();
  });
});
