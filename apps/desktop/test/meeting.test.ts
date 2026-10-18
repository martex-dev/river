import { describe, expect, it } from 'vitest';
import {
  ActiveSpeaker,
  SWITCH_AFTER_MS,
  callStatus,
  encryptionNote,
  handQueue,
  talkingLine,
} from '../src/renderer/src/community/meeting.ts';

describe('speaker view', () => {
  const people = ['me', 'ana', 'ben'];

  it('shows a shared screen first, else whoever talked, never yourself while others are there', () => {
    const pick = new ActiveSpeaker();
    const at = (now: number, speaking: string[], sharing: string[] = []): string | null =>
      pick.update({ me: 'me', people, speaking: new Set(speaking), sharing, now });
    expect(at(0, [])).toBe('ana'); // someone, before anyone talks
    expect(at(100, ['me'])).toBe('ana');
    at(1000, ['ben']);
    expect(at(1000 + SWITCH_AFTER_MS, ['ben'])).toBe('ben');
    // A cough from Ana does not take the big tile while Ben is still talking.
    expect(at(2000, ['ben', 'ana'])).toBe('ben');
    expect(at(2000 + SWITCH_AFTER_MS + 10, ['ana'])).toBe('ana');
    // Someone sharing their screen wins.
    expect(at(5000, ['ana'], ['ben'])).toBe('ben');
  });

  it('forgets someone who left', () => {
    const pick = new ActiveSpeaker();
    pick.update({ me: 'me', people, speaking: new Set(['ben']), sharing: [], now: 0 });
    expect(pick.update({ me: 'me', people, speaking: new Set(['ben']), sharing: [], now: 900 })).toBe('ben');
    expect(
      pick.update({ me: 'me', people: ['me', 'ana'], speaking: new Set(), sharing: [], now: 1000 }),
    ).toBe('ana');
    expect(pick.update({ me: 'me', people: ['me'], speaking: new Set(), sharing: [], now: 1100 })).toBe('me');
  });
});

describe('raised hands and talking', () => {
  it('lists hands first raised first, ignoring hands that are down', () => {
    expect(
      handQueue([{ id: 'c', hand: 300 }, { id: 'a', hand: null }, { id: 'b', hand: 100 }, { id: 'd' }]),
    ).toEqual([
      { id: 'b', at: 100 },
      { id: 'c', at: 300 },
    ]);
  });

  it('says who is talking briefly', () => {
    expect(talkingLine([])).toBeNull();
    expect(talkingLine(['Ana'])).toBe('Ana is talking');
    expect(talkingLine(['Ana', 'Ben'])).toBe('Ana and Ben are talking');
    expect(talkingLine(['Ana', 'Ben', 'Cy', 'Di', 'Ed'])).toBe('Ana, Ben and 3 others are talking');
  });
});

describe('honest call status', () => {
  const peer = (state: string, relayed = false, relayFlowing = false) => ({
    state,
    relayed,
    relayFlowing,
    reconnecting: state !== 'connected',
  });

  it('claims DTLS-SRTP only while every voice really goes directly', () => {
    expect(encryptionNote({ inCall: false, others: 0, relayed: 0, large: false })).toBe(
      'end-to-end encrypted',
    );
    expect(encryptionNote({ inCall: true, others: 3, relayed: 0, large: false })).toContain('DTLS-SRTP');
    expect(encryptionNote({ inCall: true, others: 3, relayed: 1, large: false })).toBe(
      'end-to-end encrypted · 1 through your server',
    );
    expect(encryptionNote({ inCall: true, others: 3, relayed: 3, large: false })).not.toContain('DTLS');
    expect(encryptionNote({ inCall: true, others: 20, relayed: 0, large: true })).toContain('large room');
  });

  it('is "reconnecting" only when the server is gone and no voice arrives', () => {
    expect(callStatus({ server: 'online', others: [] })).toBe('connected');
    expect(callStatus({ server: 'offline', others: [peer('connected')] })).toBe('connected');
    expect(callStatus({ server: 'offline', others: [peer('new', true, true)] })).toBe('connected');
    expect(callStatus({ server: 'offline', others: [peer('new', true, false)] })).toBe('reconnecting');
    expect(callStatus({ server: 'connecting', others: [] })).toBe('reconnecting');
  });
});
