import { describe, expect, it } from 'vitest';
import { MAX_RELAY_SPEAKERS } from '@river/protocol';
import { Hub, type HubSocket } from '../src/communities/hub.ts';

/** Relayed voice in the hub (2.13): who gets frames, how many speakers at once, and cleanup. */
describe('hub voice relay', () => {
  const socket = (): HubSocket & { got: number } => {
    const s = { got: 0, send: () => void (s.got += 1), close: () => undefined };
    return s;
  };

  it('sends relayed voice only to the device that is in the call, not the account’s other devices', () => {
    const hub = new Hub();
    const desktop = socket();
    const phone = socket();
    hub.add('a', desktop);
    hub.add('a', phone);
    hub.add('b', socket());
    hub.joinVoice('a', 'c', 'ch', desktop);
    hub.joinVoice('b', 'c', 'ch');
    hub.sendRelay('b', 'a', Buffer.from([1]));
    expect(desktop.got).toBe(1);
    expect(phone.got).toBe(0);
    // The device in the call dropped: nothing goes to the phone meanwhile either.
    hub.remove('a', desktop);
    hub.sendRelay('b', 'a', Buffer.from([1]));
    expect(phone.got).toBe(0);
    hub.close();
  });

  it('forwards nothing from a server-muted member, nor to a server-deafened one (2.18)', () => {
    const hub = new Hub();
    const sockets = { a: socket(), b: socket() };
    hub.add('a', sockets.a);
    hub.add('b', sockets.b);
    hub.joinVoice('a', 'k', 'ch', sockets.a);
    hub.joinVoice('b', 'k', 'ch', sockets.b);
    expect(hub.admitRelay('a', 0)).toBe(true);
    // A moderator mutes a (or a is in a stage's audience): an app ignoring it is not forwarded.
    hub.setState('a', { serverMuted: true });
    expect(hub.admitRelay('a', 20)).toBe(false);
    // ... and b, deafened, gets nobody's voice.
    hub.setState('b', { serverDeafened: true });
    hub.sendRelay('a', 'b', Buffer.from([1]));
    expect(sockets.b.got).toBe(0);
    hub.setState('a', { serverMuted: false });
    hub.setState('b', { serverDeafened: false });
    expect(hub.admitRelay('a', 40)).toBe(true);
    hub.sendRelay('a', 'b', Buffer.from([1]));
    expect(sockets.b.got).toBe(1);
    // Private call rooms have no server mute: a member muted in some community still talks there.
    hub.leaveVoice('a');
    hub.leaveVoice('b');
    hub.setState('a', { serverMuted: true });
    hub.joinRoom('a', 'room', 2, sockets.a);
    hub.joinRoom('b', 'room', 2, sockets.b);
    expect(hub.admitRelay('a', 60)).toBe(true);
    hub.close();
  });

  it('knows everyone a person may relay to: their voice channel, else their call room', () => {
    const hub = new Hub();
    for (const id of ['a', 'b', 'c', 'd']) hub.add(id, socket());
    hub.joinVoice('a', 'k', 'ch');
    hub.joinVoice('b', 'k', 'ch');
    hub.joinVoice('c', 'k', 'other');
    hub.joinRoom('d', 'room', 2);
    expect(hub.callPeers('a')).toEqual(['b']);
    expect(hub.callPeers('d')).toEqual([]);
    expect(hub.callPeers('x')).toEqual([]);
    hub.close();
  });

  it('forwards at most a few people talking at once per call, and forgets people who leave', () => {
    const hub = new Hub();
    const ids = Array.from({ length: MAX_RELAY_SPEAKERS + 2 }, (_, i) => `p${i}`);
    for (const id of ids) {
      hub.add(id, socket());
      hub.joinVoice(id, 'k', 'ch');
    }
    hub.joinVoice('solo', 'k', 'quiet');
    // Everyone talks at once for a second (a frame every 20 ms).
    const forwarded = new Map<string, number>();
    for (let t = 0; t < 1000; t += 20)
      for (const id of ids) if (hub.admitRelay(id, t)) forwarded.set(id, (forwarded.get(id) ?? 0) + 1);
    const talking = [...forwarded].filter(([, n]) => n > 10).map(([id]) => id);
    expect(talking).toHaveLength(MAX_RELAY_SPEAKERS);
    // Another call is not affected by this one.
    expect(hub.admitRelay('solo', 500)).toBe(true);
    // Someone outside any call relays nothing.
    expect(hub.admitRelay('stranger', 0)).toBe(false);
    for (const id of [...ids, 'solo']) hub.leaveVoice(id);
    expect(hub.relayScopes).toBe(0);
    hub.close();
  });
});
