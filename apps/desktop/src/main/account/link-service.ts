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
    this.progress = progress;
    for (const l of this.listeners) l(progress);
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
    this.stop();
    const secret = randomBytes(SECRET_BYTES);
    const id = mailboxId(secret);
    const expires = Date.now() + TTL_MS;
    this.offer = { secret, id, serverUrl: status.serverUrl, expires, hello: null };
    this.set({
      state: 'offering',
      code: formatLinkCode(status.serverUrl, secret),
      shortCode: encodeSecret(secret),
      expiresAt: new Date(expires).toISOString(),
    });
    const attempt = this.attempt;
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
    const offer = this.offer;
    const hello = offer?.hello;
    if (!offer || !hello) throw new UserFacingError('No device is waiting to be linked.');
    const list = await this.deps.account.deviceList();
    if (list.devices.length >= MAX_DEVICES) {
      throw new UserFacingError(`An account can have ${MAX_DEVICES} devices. Remove one first.`);
    }
    if (list.devices.some((d) => d.authKey === hello.authKey))
      throw new UserFacingError('That device is already linked.');
    const used = new Set(list.devices.map((d) => d.deviceId));
    let deviceId = 2;
    while (used.has(deviceId)) deviceId++;
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
    const sealed = sealTo(unb64(hello.linkKey), plaintext, INFO, provisionAad(offer.secret, offer.id));
    plaintext.fill(0);
    await this.deps.requestJson(
      `${offer.serverUrl}${API_PREFIX}/link/${offer.id}/provision`,
      {
        method: 'PUT',
        token: this.deps.account.sessionToken() ?? undefined,
        body: { deviceId, provision: b64(sealed) },
      },
      linkStateResponseSchema,
    );
    this.deps.log.info(`Linked device ${deviceId}`);
    this.stop();
    this.set({ state: 'linked' });
    return { deviceId };
  }

  /** This account's devices, for Settings → Account → Devices. */
  async devices(): Promise<LinkedDevice[]> {
    const list = await this.deps.account.deviceList();
    const me = this.deps.account.deviceId();
    return list.devices.map((d) => ({
      deviceId: d.deviceId,
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
  private pendingJoin: { finish(): Promise<void>; discard(): void } | null = null;

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
      this.pendingJoin = {
        discard,
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
          await this.deps.account.adoptLinked(code.serverUrl, provision.deviceId, device);
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
