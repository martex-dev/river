import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchRiver, openCommunities, openSettings } from './launch.ts';

// A real-world voice test (1.0.44): one River on the hosting PC and groups of Rivers on other
// machines — GitHub's runners, another country — join one voice channel over the internet and
// stay for an hour. Every 15 s each of them records who it sees in the call and whose voice it
// actually hears (measured from the audio itself). Skipped unless RIVER_FIELD_ROLE is set.
//
//   host:  RIVER_FIELD_ROLE=host  RIVER_FIELD_SERVER=https://… RIVER_FIELD_INVITE_FILE=invite.txt
//   guest: RIVER_FIELD_ROLE=guest RIVER_FIELD_INVITE=<link> RIVER_FIELD_PEOPLE=3 RIVER_FIELD_TAG=us1
//   both:  RIVER_FIELD_EXPECTED=<everyone in the call> RIVER_FIELD_MINUTES=60 RIVER_FIELD_REPORT=report.json

const ROLE = process.env.RIVER_FIELD_ROLE as 'host' | 'guest' | undefined;
test.skip(!ROLE, 'field test: set RIVER_FIELD_ROLE (see the top of this file)');

const env = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`${name} is not set`);
  return v;
};
const PEOPLE = Number(process.env.RIVER_FIELD_PEOPLE ?? 1);
const TAG = process.env.RIVER_FIELD_TAG ?? 'host';
const EXPECTED = Number(process.env.RIVER_FIELD_EXPECTED ?? 2);
const MINUTES = Number(process.env.RIVER_FIELD_MINUTES ?? 60);
const JOIN_WAIT_MIN = Number(process.env.RIVER_FIELD_JOIN_WAIT ?? 25);
const LINGER_MIN = Number(process.env.RIVER_FIELD_LINGER ?? 3);
const SAMPLE_MS = 15_000;
const CHANNEL = 'Lounge';
// --mute-audio: nothing plays on the machine's speakers; the meter still measures every voice.
const FAKE_MEDIA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--mute-audio'];

const dirs: string[] = [];
const apps: ElectronApplication[] = [];

test.afterAll(async () => {
  for (const a of apps) await a.close().catch(() => undefined);
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function open(name: string): Promise<Page> {
  const dir = mkdtempSync(join(tmpdir(), 'river-field-'));
  dirs.push(dir);
  // RIVER_FIELD_ARGS: extra Chromium switches, e.g. a --host-resolver-rules=… to force the public path.
  const extra = process.env.RIVER_FIELD_ARGS ? [process.env.RIVER_FIELD_ARGS] : [];
  const { app, page } = await launchRiver(dir, { name, args: [...FAKE_MEDIA, ...extra] });
  apps.push(app);
  return page;
}

interface Sample {
  inCall: boolean;
  tiles: number;
  problems: number;
  /** Remote voices with sound in the last 3 seconds, measured from the audio itself. */
  audible: number;
  /** Remote voices attached and playing. */
  voices: number;
  /** River IDs of the people heard in this sample (from the audio elements' data-peer). */
  heard: string[];
  /** Tiles showing a problem ("connecting", "reconnecting"), by label. */
  trouble: string[];
  /** People whose voice comes through the server instead of directly. */
  viaServer: number;
}

/** Starts an audio meter on every remote voice (once per page). */
async function installMeter(p: Page): Promise<void> {
  await p.evaluate(() => {
    const w = window as unknown as { __fieldMeter?: boolean; __fieldLoud?: Map<string, number> };
    if (w.__fieldMeter) return;
    w.__fieldMeter = true;
    const loud = new Map<string, number>();
    w.__fieldLoud = loud;
    const ctx = new AudioContext();
    const meters = new Map<string, { analyser: AnalyserNode; buf: Float32Array<ArrayBuffer> }>();
    setInterval(() => {
      void ctx.resume().catch(() => undefined);
      for (const el of document.querySelectorAll<HTMLAudioElement>('.call-audio audio')) {
        const track = (el.srcObject as MediaStream | null)?.getAudioTracks()[0];
        if (!track || track.readyState !== 'live') continue;
        let m = meters.get(track.id);
        if (!m) {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
          m = { analyser, buf: new Float32Array(analyser.fftSize) };
          meters.set(track.id, m);
        }
        m.analyser.getFloatTimeDomainData(m.buf);
        let peak = 0;
        for (const v of m.buf) peak = Math.max(peak, Math.abs(v));
        if (peak > 0.01) loud.set(track.id, Date.now());
      }
    }, 100);
  });
}

async function sample(p: Page): Promise<Sample> {
  return p.evaluate(() => {
    const loud = (window as unknown as { __fieldLoud?: Map<string, number> }).__fieldLoud ?? new Map();
    const panel = document.querySelector('.voice-panel');
    const tiles = [...document.querySelectorAll('.tile')].map((t) => (t.textContent ?? '').trim());
    const els = [...document.querySelectorAll<HTMLAudioElement>('.call-audio audio')];
    const live = els
      .map((a) => ({
        peer: a.dataset.peer ?? '?',
        track: (a.srcObject as MediaStream | null)?.getAudioTracks()[0],
      }))
      .filter(
        (x): x is { peer: string; track: MediaStreamTrack } => !!x.track && x.track.readyState === 'live',
      );
    const tracks = live.map((x) => x.track);
    return {
      inCall: Boolean(panel && /Voice connected|Reconnecting/i.test(panel.textContent ?? '')),
      // Our own tile is not counted: what matters is everyone else.
      tiles: Math.max(0, tiles.length - 1),
      problems: tiles.filter((t) => /connecting|reconnecting|lost/i.test(t)).length,
      audible: tracks.filter((t) => Date.now() - (loud.get(t.id) ?? 0) < 3000).length,
      voices: tracks.length,
      heard: live.filter((x) => Date.now() - (loud.get(x.track.id) ?? 0) < 3000).map((x) => x.peer),
      trouble: tiles.filter((t) => /connecting|reconnecting|lost/i.test(t)),
      viaServer: tiles.filter((t) => /via server/i.test(t)).length,
    };
  });
}

test('field voice test', async () => {
  test.setTimeout((JOIN_WAIT_MIN + MINUTES + LINGER_MIN + 15) * 60_000);
  const pages: Page[] = [];
  const names: string[] = [];
  const ids: string[] = [];

  if (ROLE === 'host') {
    const host = await open('Host');
    pages.push(host);
    names.push('Host');
    await openSettings(host, 'Account');
    await host.getByPlaceholder('https://river.example.org').fill(env('RIVER_FIELD_SERVER'));
    await host.getByRole('button', { name: 'Save', exact: true }).click();
    await host.getByRole('button', { name: 'Create account' }).click();
    await expect(host.locator('.account-card .chip')).toHaveText('Connected', { timeout: 60_000 });
    await openCommunities(host);
    await host.getByPlaceholder('e.g. The Crew').fill('Field test');
    await host.getByRole('button', { name: 'Create community' }).click();
    await host.getByRole('button', { name: 'Invite people' }).first().click();
    const invite = (await host.locator('.invite-box__link').innerText()).trim();
    writeFileSync(env('RIVER_FIELD_INVITE_FILE'), invite);
    console.warn(`INVITE ${invite}`);
    await host.getByRole('button', { name: 'Close', exact: true }).click();
  } else {
    const invite = env('RIVER_FIELD_INVITE');
    for (let i = 1; i <= PEOPLE; i++) {
      const name = `${TAG}-${i}`;
      const p = await open(name);
      await openCommunities(p);
      await p.getByLabel('Invite link').fill(invite);
      await p.getByRole('button', { name: 'Join community' }).click();
      await expect(p.locator('.community__title strong')).toHaveText('Field test', { timeout: 120_000 });
      pages.push(p);
      names.push(name);
    }
  }

  for (const p of pages) {
    // RIVER_FIELD_RELAY=1: no direct connections at all — every voice goes through the server.
    if (process.env.RIVER_FIELD_RELAY === '1') {
      await p.evaluate(() => {
        (globalThis as { __riverForceRelay?: boolean }).__riverForceRelay = true;
      });
    }
    ids.push(await p.evaluate(async () => (await window.river.identity.get())?.riverId ?? '?'));
    await p.locator('.channel', { hasText: CHANNEL }).click();
    await expect(p.locator('.voice-panel')).toContainText(/Voice connected/i, { timeout: 120_000 });
    await installMeter(p);
  }

  // Wait for everyone (other machines start at different times), then measure.
  const joinDeadline = Date.now() + JOIN_WAIT_MIN * 60_000;
  while (Date.now() < joinDeadline) {
    const all = await Promise.all(pages.map(sample));
    if (all.every((s) => s.tiles >= EXPECTED - 1)) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  const started = new Date().toISOString();
  console.warn(`MEASURING from ${started}: ${EXPECTED} people expected in the call`);

  const timeline: Array<{ t: number; who: string } & Sample> = [];
  const start = Date.now();
  while (Date.now() - start < MINUTES * 60_000) {
    await new Promise((r) => setTimeout(r, SAMPLE_MS));
    for (const [i, p] of pages.entries()) {
      const s = await sample(p);
      timeline.push({ t: Math.round((Date.now() - start) / 1000), who: names[i]!, ...s });
    }
  }

  const n = timeline.length;
  const want = EXPECTED - 1;
  const summary = {
    role: ROLE,
    tag: TAG,
    clients: names.map((name, i) => ({ name, riverId: ids[i] })),
    people: names.length,
    expected: EXPECTED,
    minutes: MINUTES,
    started,
    samples: n,
    outOfCall: timeline.filter((s) => !s.inCall).length,
    missingSomeone: timeline.filter((s) => s.tiles < want).length,
    reconnecting: timeline.filter((s) => s.problems > 0).length,
    notHearingEveryone: timeline.filter((s) => s.audible < want).length,
    worstHeard: Math.min(...timeline.map((s) => s.audible)),
    averageHeard: timeline.reduce((a, s) => a + s.audible, 0) / Math.max(1, n),
  };
  console.warn(`SUMMARY ${JSON.stringify(summary)}`);
  const report = process.env.RIVER_FIELD_REPORT;
  if (report) writeFileSync(report, JSON.stringify({ summary, timeline }, null, 1));

  // The host stays a little longer, so guests finishing a moment later still hear everyone.
  if (ROLE === 'host') await new Promise((r) => setTimeout(r, LINGER_MIN * 60_000));

  // Nobody is thrown out; everyone sees and hears everyone nearly all the time.
  expect(summary.outOfCall).toBe(0);
  expect(summary.missingSomeone / n).toBeLessThan(0.05);
  expect(summary.notHearingEveryone / n).toBeLessThan(0.05);
});
