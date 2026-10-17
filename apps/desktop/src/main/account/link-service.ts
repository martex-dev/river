import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { generateKeyPair, openSealed, sealTo } from '@river/crypto';
import {
  API_PREFIX,
  MAX_DEVICES,
  linkStateResponseSchema,
  type DeviceList,
  type LinkHello,
} from '@river/protocol';
import type { LinkProgress, LinkedDevice } from '../../shared/ipc.ts';
import { serverUrlSchema } from '../../shared/settings.ts';
import { ApiError, type RequestJson } from '../http.ts';
import type { IdentityService } from '../identity/identity-service.ts';
import type { Logger } from '../logger.ts';
import { UserFacingError, type AccountService } from './account-service.ts';

/**
 * Linking devices (1.3, ADR 0006): one River account on several devices.
 *
 * A device that is already linked shows a link code: the server address and an 80-bit link
 * secret. The new device takes the code (typed, pasted or scanned), and posts a hello — its
 * public keys, authenticated with the secret — to a mailbox whose ID also comes from the secret.
 * The linked device checks the hello, asks the person to confirm, adds the new device to the
 * account's signed device list and seals the account (identity keys, community keys, name) to the
 * new device with libsignal's HPKE, bound to the secret. The server relays public keys and
 * ciphertext; without the secret it can neither pose as the new device nor hand it a false
 * account.
 */

const POLL_MS = 1500;
/** After linking, how often the linked device looks whether the new device declined. */
const WATCH_MS = 3000;
/** How long "Linked" stays on screen before the panel returns to its usual state. */
const LINKED_SHOW_MS = 8000;
const TTL_MS = 10 * 60 * 1000;
const SECRET_BYTES = 10;
/** Crockford base32: no I, L, O or U, so a code survives being read out or typed. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64');

/** Everything the new device needs to be the same person, sealed to it. */
const provisionSchema = z
  .object({
    v: z.literal(1),
    riverId: z.string().uuid(),
    identityPublicKey: z.string(),
    identityPrivateKey: z.string(),
    deviceId: z.number().int().min(2).max(64),
    serverUrl: z.string(),
    displayName: z.string().max(64).nullable(),
    communityKeys: z
      .array(z.object({ communityId: z.string().max(64), epoch: z.number().int().min(0), key: z.string() }))
      .max(5000),
  })
  .strict();
type Provision = z.infer<typeof provisionSchema>;

export function encodeSecret(secret: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of secret) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

export function decodeSecret(code: string): Buffer | null {
  const clean = code.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== Math.ceil((SECRET_BYTES * 8) / 5)) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return out.length === SECRET_BYTES ? Buffer.from(out) : null;
}

/** `river://link?s=<server>&c=<code>` — what the QR code and "copy link" carry. */
export function formatLinkCode(serverUrl: string, secret: Uint8Array): string {
  return `river://link?${new URLSearchParams({ s: serverUrl, c: encodeSecret(secret) }).toString()}`;
}

/** A full link, or just the code (then the server comes from `fallbackServer`). */
export function parseLinkCode(
  raw: string,
  fallbackServer?: string | null,
): { serverUrl: string; secret: Buffer } | null {
  const text = raw.trim();
  try {
    if (text.startsWith('river:')) {
      const url = new URL(text);
      if (url.host !== 'link') return null;
      const serverUrl = serverUrlSchema.parse(url.searchParams.get('s') ?? '');
      const secret = decodeSecret(url.searchParams.get('c') ?? '');
      return secret ? { serverUrl, secret } : null;
    }
  } catch {
    return null;
  }
  const secret = decodeSecret(text);
  if (!secret || !fallbackServer) return null;
  return { serverUrl: fallbackServer, secret };
}

const hmac = (secret: Uint8Array, label: string): Buffer =>
  createHmac('sha256', secret).update(label).digest();

export function mailboxId(secret: Uint8Array): string {
  return hmac(secret, 'river-link-mailbox-v1').subarray(0, 16).toString('base64url');
}

export function helloMac(secret: Uint8Array, hello: LinkHello): string {
  return hmac(
    secret,
    `river-link-hello-v1|${hello.authKey}|${hello.registrationId}|${hello.linkKey}|${hello.deviceName}`,
  ).toString('base64url');
}

/**
 * "No" from the new device: only someone who saw the code could make it, for this device number
 * only. The device's key is checked where the decline is applied (removeDeclined), so it need not
 * be in the MAC; the link secret already binds it to this one link.
 */
export function declineMac(secret: Uint8Array, deviceId: number): string {
  return hmac(secret, `river-link-decline-v1|${deviceId}`).toString('base64url');
}

/** The provisioning message is bound to the secret: only someone who saw the code could make it. */
function provisionAad(secret: Uint8Array, id: string): Buffer {
  return Buffer.concat([Buffer.from(`river-link-provision-v1|${id}|`, 'utf8'), secret]);
}

const INFO = 'river-link-v1';

export interface LinkServiceDeps {
  identity: IdentityService;
  account: AccountService;
  community: {
    exportKeys(): Array<{ communityId: string; epoch: number; key: string }>;
    importKeys(keys: Array<{ communityId: string; epoch: number; key: string }>): void;
  };
  requestJson: RequestJson;
  log: Logger;
  /** River's own server, for codes typed without an address. */
  homeServer?: () => Promise<string>;
  /** The new device is linked: remember its server and connect. */
  onLinked(serverUrl: string): void;
  /** Tests: shorter waits. */
  timings?: { watchMs?: number; linkedShowMs?: number };
}

/** A device this one linked, watched until its code runs out in case it declines the account. */
interface Watch {
  serverUrl: string;
  id: string;
  secret: Buffer;
  deviceId: number;
  authKey: string;
  deviceName: string;
  expires: number;
}

export class LinkService {
  private readonly deps: LinkServiceDeps;
  private progress: LinkProgress = { state: 'idle' };
  private readonly listeners = new Set<(p: LinkProgress) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Generation of the current attempt; a cancelled attempt's late results are ignored. */
  private attempt = 0;
  private offer: {
    secret: Buffer;
    id: string;
    serverUrl: string;
    expires: number;
    hello: LinkHello | null;
  } | null = null;
  /** "Link it" is being carried out (a second press must not publish another list). */
  private confirming = false;
  private linkedTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly watches = new Set<ReturnType<typeof setTimeout>>();

  constructor(deps: LinkServiceDeps) {
    this.deps = deps;
  }

  status(): LinkProgress {
    return this.progress;
  }

  onChange(listener: (p: LinkProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(progress: LinkProgress): void {
    if (this.linkedTimer) clearTimeout(this.linkedTimer);
    this.linkedTimer = null;
    this.progress = progress;
    for (const l of this.listeners) l(progress);
    // "Linked" is news, not a state to keep showing: it clears after a little while.
    if (progress.state === 'linked') {
      this.linkedTimer = setTimeout(() => {
        this.linkedTimer = null;
        if (this.progress === progress) this.set({ state: 'idle' });
      }, this.deps.timings?.linkedShowMs ?? LINKED_SHOW_MS);
      this.linkedTimer.unref?.();
    }
  }

  private fail(message: string): void {
    this.stop();
    this.set({ state: 'failed', message });
  }

  private stop(): void {
    this.pendingJoin?.discard();
    this.pendingJoin = null;
    this.attempt++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.offer) this.offer.secret.fill(0);
    this.offer = null;
  }

  cancel(): void {
    // "Is this you?" → Cancel: the other device already added this one to its account. Tell it
    // (best effort), so it takes this device off the list again instead of leaving a device
    // nobody holds.
    const declining = this.progress.state === 'review' ? this.pendingJoin : null;
    if (declining) void declining.decline().catch(() => undefined);
    this.stop();
    this.set({ state: 'idle' });
  }

  private later(fn: () => Promise<void>, attempt: number): void {
    this.timer = setTimeout(() => {
      if (attempt !== this.attempt) return;
      void fn().catch((err: unknown) => {
        if (attempt !== this.attempt) return;
        this.fail(err instanceof UserFacingError ? err.message : 'Linking failed. Start again.');
      });
    }, POLL_MS);
  }

  private async mailbox(serverUrl: string, id: string) {
    try {
      return await this.deps.requestJson(
        `${serverUrl}${API_PREFIX}/link/${id}`,
        { method: 'GET' },
        linkStateResponseSchema,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }

  // ---- on a device that is already linked ---------------------------------------------------

  /** Shows a link code, then waits for a new device to use it. */
  async start(): Promise<LinkProgress> {
    const status = this.deps.account.status();
    if (status.state !== 'registered' || !this.deps.account.sessionToken()) {
      throw new UserFacingError('Connect to your server first, then try again.');
    }
    if (this.confirming) throw new UserFacingError('A device is being linked right now. Wait a moment.');
    this.stop();
    // This attempt; one started (or a cancel) while the mailbox is being reserved replaces it.
    const attempt = this.attempt;
    const secret = randomBytes(SECRET_BYTES);
    const id = mailboxId(secret);
    const expires = Date.now() + TTL_MS;
    this.offer = { secret, id, serverUrl: status.serverUrl, expires, hello: null };
    // Reserve the mailbox (servers from 1.3.1), so nobody else can take or crowd out the slot.
    await this.deps
      .requestJson(
        `${status.serverUrl}${API_PREFIX}/link/${id}/reserve`,
        { method: 'POST', token: this.deps.account.sessionToken() ?? undefined },
        z.unknown(),
      )
      .catch(() => undefined);
    // Replaced or cancelled meanwhile: its secret is already wiped; never show it.
    if (attempt !== this.attempt) return this.progress;
    this.set({
      state: 'offering',
      code: formatLinkCode(status.serverUrl, secret),
      shortCode: encodeSecret(secret),
      expiresAt: new Date(expires).toISOString(),
    });
    const poll = async (): Promise<void> => {
      const offer = this.offer;
      if (!offer) return;
      if (Date.now() > offer.expires) throw new UserFacingError('The link code expired. Start again.');
      const state = await this.mailbox(offer.serverUrl, offer.id).catch(() => null);
      if (!state?.hello || !state.mac) return this.later(poll, attempt);
      const expected = Buffer.from(helloMac(offer.secret, state.hello), 'base64url');
      const got = Buffer.from(state.mac, 'base64url');
      if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
        throw new UserFacingError(
          'Something without your code tried to use it. Nothing was linked. Start again.',
        );
      }
      offer.hello = state.hello;
      this.set({ state: 'request', deviceName: state.hello.deviceName });
    };
    this.later(poll, attempt);
    return this.progress;
  }

  /** The person confirmed: add the new device to this account and send it the account. */
  async confirm(): Promise<{ deviceId: number }> {
    // Pressed twice: the second would publish a list built from the same old version.
    if (this.confirming) throw new UserFacingError('This device is already being linked.');
    this.confirming = true;
    try {
      return await this.confirmOnce();
    } finally {
      this.confirming = false;
    }
  }

  private async confirmOnce(): Promise<{ deviceId: number }> {
    const offer = this.offer;
    const hello = offer?.hello;
    if (!offer || !hello) throw new UserFacingError('No device is waiting to be linked.');
    // The server forgets the mailbox when the code runs out: linking now would add a device
    // that never receives the account.
    if (Date.now() > offer.expires) {
      this.fail('The link code expired. Start again.');
      throw new UserFacingError('The link code expired. Start again.');
    }
    const list = await this.deps.account.deviceList();
    if (this.offer !== offer) throw new UserFacingError('Linking was cancelled.');
    if (list.devices.length >= MAX_DEVICES) {
      throw new UserFacingError(`An account can have ${MAX_DEVICES} devices. Remove one first.`);
    }
    if (list.devices.some((d) => d.authKey === hello.authKey))
      throw new UserFacingError('That device is already linked.');
    const used = new Set(list.devices.map((d) => d.deviceId));
    let deviceId = 2;
    while (used.has(deviceId)) deviceId++;

    // Everything that can fail locally happens before the device list changes.
    const identity = this.deps.identity.protocolIdentity();
    if (!identity) throw new UserFacingError('Unlock River first.');
    const provision: Provision = {
      v: 1,
      riverId: identity.riverId,
      identityPublicKey: b64(identity.publicKey),
      identityPrivateKey: b64(identity.privateKey),
      deviceId,
      serverUrl: offer.serverUrl,
      displayName: this.deps.identity.get()?.displayName ?? null,
      communityKeys: this.deps.community.exportKeys(),
    };
    identity.privateKey.fill(0);
    const plaintext = Buffer.from(JSON.stringify(provision), 'utf8');
    provision.identityPrivateKey = '';
    const sealed = sealTo(unb64(hello.linkKey), plaintext, INFO, provisionAad(offer.secret, offer.id));
    plaintext.fill(0);

    const next: DeviceList = {
      ...list,
      version: list.version + 1,
      devices: [
        ...list.devices,
        {
          deviceId,
          authKey: hello.authKey,
          registrationId: hello.registrationId,
          addedAt: new Date().toISOString(),
        },
      ],
    };
    await this.deps.account.publishDeviceList(next);
    try {
      await this.deps.requestJson(
        `${offer.serverUrl}${API_PREFIX}/link/${offer.id}/provision`,
        {
          method: 'PUT',
          token: this.deps.account.sessionToken() ?? undefined,
          body: { deviceId, provision: b64(sealed) },
        },
        linkStateResponseSchema,
      );
    } catch (err) {
      // The new device never got the account: take it off the list again (a newer version), so
      // no device that nobody holds stays on the account.
      this.deps.log.warn(`Linking device ${deviceId} failed; removing it from the device list`);
      await this.deps.account
        .publishDeviceList({ ...next, version: next.version + 1, devices: list.devices })
        .catch(() => this.deps.log.error(`Could not remove unlinked device ${deviceId} from the list`));
      throw err;
    }
    this.deps.log.info(`Linked device ${deviceId}`);
    this.deps.account.setDeviceNames({ [deviceId]: hello.deviceName });
    this.watch({
      serverUrl: offer.serverUrl,
      id: offer.id,
      secret: Buffer.from(offer.secret),
      deviceId,
      authKey: hello.authKey,
      deviceName: hello.deviceName,
      expires: offer.expires,
    });
    this.stop();
    this.set({ state: 'linked', deviceName: hello.deviceName });
    return { deviceId };
  }

  /**
   * Until the code runs out, looks whether the new device declined the account it was sent
   * ("Is this you?" → Cancel). If it did — and the answer carries the secret's MAC, so it really
   * came from that device — the device comes off the list again.
   */
  private watch(w: Watch): void {
    const done = (): void => {
      w.secret.fill(0);
    };
    const tick = async (): Promise<void> => {
      if (Date.now() > w.expires) return done();
      const state = await this.mailbox(w.serverUrl, w.id).catch(() => undefined);
      // Gone (expired, or the server restarted): nothing more will come.
      if (state === null) return done();
      if (!state?.declined) return schedule();
      const expected = Buffer.from(declineMac(w.secret, w.deviceId), 'base64url');
      const got = Buffer.from(state.declined, 'base64url');
      if (expected.length !== got.length || !timingSafeEqual(expected, got)) return done();
      done();
      await this.removeDeclined(w);
    };
    const schedule = (): void => {
      const timer = setTimeout(() => {
        this.watches.delete(timer);
        void tick().catch(() => done());
      }, this.deps.timings?.watchMs ?? WATCH_MS);
      timer.unref?.();
      this.watches.add(timer);
    };
    schedule();
  }

  private async removeDeclined(w: Watch): Promise<void> {
    try {
      const list = await this.deps.account.deviceList();
      if (list.devices.some((d) => d.deviceId === w.deviceId && d.authKey === w.authKey)) {
        await this.deps.account.publishDeviceList({
          ...list,
          version: list.version + 1,
          devices: list.devices.filter((d) => d.deviceId !== w.deviceId),
        });
      }
      this.deps.log.info(`Device ${w.deviceId} declined the link; removed it again`);
      if (this.progress.state === 'idle' || this.progress.state === 'linked') {
        this.set({
          state: 'failed',
          message: `${w.deviceName} did not take the account, so it was removed again. Nothing was linked.`,
        });
      }
    } catch {
      this.deps.log.warn(`Device ${w.deviceId} declined the link, but could not be removed`);
      if (this.progress.state === 'idle' || this.progress.state === 'linked') {
        this.set({
          state: 'failed',
          message: `${w.deviceName} did not take the account. Remove it from your devices below.`,
        });
      }
    }
  }

  /** Stops watching linked devices (tests, and when River quits). */
  dispose(): void {
    for (const t of this.watches) clearTimeout(t);
    this.watches.clear();
    if (this.linkedTimer) clearTimeout(this.linkedTimer);
    this.linkedTimer = null;
  }

  /** This account's devices, for Settings → Account → Devices. */
  async devices(): Promise<LinkedDevice[]> {
    const list = await this.deps.account.deviceList();
    const me = this.deps.account.deviceId();
    const names = this.deps.account.deviceNames();
    return list.devices.map((d) => ({
      deviceId: d.deviceId,
      name: names[String(d.deviceId)] ?? null,
      addedAt: d.addedAt,
      current: d.deviceId === me,
    }));
  }

  /** Removes another device from this account; it is signed out and gets no more messages. */
  async remove(rawDeviceId: unknown): Promise<void> {
    const deviceId = z.number().int().min(1).max(64).parse(rawDeviceId);
    if (deviceId === this.deps.account.deviceId())
      throw new UserFacingError('This is the device you are using.');
    const list = await this.deps.account.deviceList();
    if (!list.devices.some((d) => d.deviceId === deviceId)) return;
    await this.deps.account.publishDeviceList({
      ...list,
      version: list.version + 1,
      devices: list.devices.filter((d) => d.deviceId !== deviceId),
    });
  }

  // ---- on the new device ---------------------------------------------------------------------

  /** Uses a link code from a device that is already linked. */
  /** A received account waiting for "Is this you?" on the new device. */
  private pendingJoin: { finish(): Promise<void>; discard(): void; decline(): Promise<void> } | null = null;

  /** On the new device: the person checked whose account it is and wants to link. */
  async accept(): Promise<LinkProgress> {
    const pending = this.pendingJoin;
    if (!pending || this.progress.state !== 'review') {
      throw new UserFacingError('There is nothing to link right now.');
    }
    this.pendingJoin = null;
    try {
      await pending.finish();
    } catch (err) {
      pending.discard();
      this.stop();
      this.set({
        state: 'failed',
        message: err instanceof UserFacingError ? err.message : 'Linking failed.',
      });
      throw err;
    }
    return this.progress;
  }

  async join(rawCode: unknown, rawDeviceName: unknown): Promise<LinkProgress> {
    if (this.deps.identity.get() || this.deps.account.status().state !== 'none') {
      throw new UserFacingError('This device already has a River account.');
    }
    const text = typeof rawCode === 'string' ? rawCode : '';
    let fallback: string | null = null;
    if (!text.trim().startsWith('river:') && this.deps.homeServer) {
      fallback = await this.deps.homeServer().catch(() => null);
    }
    const code = parseLinkCode(text, fallback);
    if (!code) {
      throw new UserFacingError(
        text.trim().startsWith('river:') || fallback
          ? 'That is not a River link code.'
          : 'Paste the whole link (it starts with river://) — this code alone does not say which server to use.',
      );
    }
    const deviceName = z.string().trim().min(1).max(64).catch('New device').parse(rawDeviceName);
    this.stop();
    const linkKey = generateKeyPair();
    const device = generateKeyPair();
    const registrationId = randomInt(1, 0x3fff);
    const hello: LinkHello = {
      authKey: b64(device.publicKey),
      registrationId,
      linkKey: b64(linkKey.publicKey),
      deviceName,
    };
    const id = mailboxId(code.secret);
    try {
      await this.deps.requestJson(
        `${code.serverUrl}${API_PREFIX}/link/${id}`,
        { method: 'PUT', body: { hello, mac: helloMac(code.secret, hello) } },
        linkStateResponseSchema,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 409)
        throw new UserFacingError('That link code was already used.');
      if (err instanceof ApiError && err.status === 404) {
        throw new UserFacingError(
          'That server does not support linking devices yet. Update River on it first.',
        );
      }
      throw err;
    }
    this.set({ state: 'joining' });
    const attempt = this.attempt;
    const poll = async (): Promise<void> => {
      const state = await this.mailbox(code.serverUrl, id).catch(() => undefined);
      if (state === null) throw new UserFacingError('The link code expired. Start again.');
      if (!state?.provision || !state.deviceId) return this.later(poll, attempt);
      let provision: Provision;
      try {
        const opened = openSealed(
          linkKey.privateKey,
          unb64(state.provision),
          INFO,
          provisionAad(code.secret, id),
        );
        provision = provisionSchema.parse(JSON.parse(Buffer.from(opened).toString('utf8')));
      } catch {
        throw new UserFacingError('The link could not be opened. Start again.');
      }
      if (provision.deviceId !== state.deviceId || provision.serverUrl !== code.serverUrl) {
        throw new UserFacingError('The link did not match. Start again.');
      }
      linkKey.privateKey.fill(0);
      // Show whose account this is before taking it on: a code someone else made (a web page
      // opening river://link) would otherwise link this device into their account.
      const discard = (): void => {
        device.privateKey.fill(0);
        provision.identityPrivateKey = '';
      };
      const deviceId = provision.deviceId;
      const decline = async (): Promise<void> => {
        await this.deps.requestJson(
          `${code.serverUrl}${API_PREFIX}/link/${id}/decline`,
          { method: 'PUT', body: { mac: declineMac(code.secret, deviceId) } },
          z.unknown(),
        );
      };
      // After "Link this device again", only the account this device's messages belong to.
      const expected = this.deps.account.relinkTarget();
      if (expected && provision.riverId !== expected) {
        discard();
        void decline().catch(() => undefined);
        throw new UserFacingError(
          'That code is for a different account. This device holds the messages of the account it was removed from: link it with a code from a device of that account.',
        );
      }
      this.pendingJoin = {
        discard,
        decline,
        finish: async () => {
          const privateKey = unb64(provision.identityPrivateKey);
          try {
            this.deps.identity.adopt({
              riverId: provision.riverId,
              publicKey: unb64(provision.identityPublicKey),
              privateKey,
              registrationId,
              displayName: provision.displayName,
            });
          } finally {
            privateKey.fill(0);
          }
          try {
            await this.deps.account.adoptLinked(code.serverUrl, provision.deviceId, device);
          } catch (err) {
            // Signing in failed: take the identity back off, so the device can try again (or
            // start fresh) instead of having an identity with no account.
            this.deps.identity.discardAdopted(provision.riverId);
            throw err;
          }
          this.deps.account.setDeviceNames({ [provision.deviceId]: deviceName });
          discard();
          this.deps.community.importKeys(provision.communityKeys);
          this.deps.log.info('This device is now linked');
          this.stop();
          this.set({ state: 'linked' });
          this.deps.onLinked(code.serverUrl);
        },
      };
      this.set({
        state: 'review',
        displayName: provision.displayName ?? 'someone without a name',
        riverId: provision.riverId,
        server: new URL(code.serverUrl).host,
      });
    };
    this.later(poll, attempt);
    return this.progress;
  }
}
