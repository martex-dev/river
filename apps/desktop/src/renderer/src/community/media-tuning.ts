/**
 * Media settings for calls (2.13). Pure, so they can be tested.
 *
 * Room size: every person in a mesh call sends their voice (and video) once to
 * every other person. Voice is light — about 40–60 kbit/s per listener with
 * packet overhead — but each direct connection also costs an encoder, ICE and
 * a dozen call-setup signals, so above MESH_MAX_PEOPLE River sends voice
 * through the server instead (still end-to-end encrypted, one upload however
 * big the room is) and connects directly only to people sharing video.
 */

/** Rooms up to this many people talk directly (mesh); larger rooms send voice through the server. */
export const MESH_MAX_PEOPLE = 8;

/** Whether a call of `people` (including you) is a large room. */
export function isLargeRoom(people: number, relayAvailable: boolean): boolean {
  return relayAvailable && people > MESH_MAX_PEOPLE;
}

/** Opus parameters for direct voice (both sides ask the other to send this way). */
export const OPUS_FMTP: Record<string, string> = {
  /** In-band forward error correction: a lost packet is rebuilt from the next one. */
  useinbandfec: '1',
  /** Discontinuous transmission: almost nothing is sent during silence. */
  usedtx: '1',
  /** Voice is mono. */
  stereo: '0',
  'sprop-stereo': '0',
  /** Enough for clear speech; WebRTC still lowers it under congestion. */
  maxaveragebitrate: '32000',
};

/**
 * Sets the Opus parameters (OPUS_FMTP) in an SDP. Other codecs and lines are
 * left alone; an SDP without Opus comes back unchanged.
 */
export function tuneOpusSdp(sdp: string): string {
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(eol);
  const pts = new Set<string>();
  for (const line of lines) {
    const m = /^a=rtpmap:(\d+) opus\/48000/i.exec(line);
    if (m) pts.add(m[1]!);
  }
  if (pts.size === 0) return sdp;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = /^a=fmtp:(\d+) (.*)$/.exec(line);
    if (m && pts.has(m[1]!)) {
      seen.add(m[1]!);
      const params = new Map<string, string>();
      for (const part of m[2]!.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k) params.set(k, v.join('='));
      }
      for (const [k, v] of Object.entries(OPUS_FMTP)) params.set(k, v);
      out.push(`a=fmtp:${m[1]} ${[...params].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(';')}`);
      continue;
    }
    out.push(line);
    // An Opus codec without an fmtp line gets one right after its rtpmap.
    const r = /^a=rtpmap:(\d+) opus\/48000/i.exec(line);
    if (r && !lines.some((l) => l.startsWith(`a=fmtp:${r[1]} `))) {
      seen.add(r[1]!);
      out.push(
        `a=fmtp:${r[1]} ${Object.entries(OPUS_FMTP)
          .map(([k, v]) => `${k}=${v}`)
          .join(';')}`,
      );
    }
  }
  return out.join(eol);
}

/**
 * Bandwidth for video over direct connections, shared between the people
 * watching: one upload per viewer, so each gets less as more watch, within
 * limits that keep text readable and motion smooth.
 */
export function videoBitrates(viewers: number): {
  screen: number;
  camera: number;
  cameraScale: number;
} {
  const n = Math.max(1, viewers);
  const clamp = (v: number, lo: number, hi: number): number => Math.round(Math.min(hi, Math.max(lo, v)));
  return {
    screen: clamp(8_000_000 / n, 500_000, 2_500_000),
    camera: clamp(3_000_000 / n, 150_000, 1_000_000),
    cameraScale: n > 4 ? 2 : 1,
  };
}

/**
 * What one person uploads for voice per 20 ms in each mode, in bytes: the
 * estimate behind MESH_MAX_PEOPLE (ARCHITECTURE.md, "Calls"), checked by tests.
 */
export function uploadPerFrame(people: number, mode: 'mesh' | 'relay', payloadBytes = 80): number {
  const others = Math.max(0, people - 1);
  // Mesh: one RTP packet per listener (payload + RTP/SRTP/UDP/IP ≈ 50 bytes).
  if (mode === 'mesh') return others * (payloadBytes + 50);
  // Relay: one frame for everyone (type byte + sequence + IV + tag, over the WebSocket ≈ 40 bytes).
  return others > 0 ? payloadBytes + 1 + 4 + 12 + 16 + 8 : 0;
}
