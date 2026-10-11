import { describe, expect, it } from 'vitest';
import { describeLink, linkQuality, readLinkStats } from '../src/renderer/src/community/link-stats.ts';

const report = (received: number, lost: number, type = 'srflx') => [
  { type: 'candidate-pair', id: 'p', selected: true, localCandidateId: 'l', currentRoundTripTime: 0.042 },
  { type: 'local-candidate', id: 'l', candidateType: type },
  { type: 'inbound-rtp', id: 'a', kind: 'audio', packetsReceived: received, packetsLost: lost },
];

describe('call connection details', () => {
  it('reads round-trip time, path and loss since the last sample', () => {
    const first = readLinkStats(report(100, 0), null);
    expect(first.stats).toEqual({ rttMs: 42, loss: null, candidateType: 'srflx' });
    const second = readLinkStats(report(190, 10), first.counts);
    expect(second.stats.loss).toBeCloseTo(0.1);
    expect(readLinkStats(report(1, 0, 'relay'), null).stats.candidateType).toBe('relay');
    expect(readLinkStats([], null).stats).toEqual({ rttMs: null, loss: null, candidateType: null });
  });

  it('describes and grades a link in plain words', () => {
    expect(describeLink({ path: 'direct', rttMs: 38, loss: 0 })).toBe('Direct · 38 ms · 0% loss');
    expect(describeLink({ path: 'server', rttMs: null, loss: null })).toBe('Via your server (encrypted)');
    expect(linkQuality({ path: 'direct', rttMs: 38, loss: 0 })).toBe('good');
    expect(linkQuality({ path: 'direct', rttMs: 250, loss: 0 })).toBe('fair');
    expect(linkQuality({ path: 'direct', rttMs: 50, loss: 0.2 })).toBe('poor');
    expect(linkQuality({ path: 'server', rttMs: null, loss: null })).toBeNull();
  });
});
