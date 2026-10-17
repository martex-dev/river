import { z } from 'zod';
import { generateKeyPair, sign, verify } from '@river/crypto';
import {
  API_PREFIX,
  accountResponseSchema,
  usernameResponseSchema,
  challengeResponseSchema,
  checkCompatibility,
  deviceListMessage,
  parseDeviceList,
  registerResponseSchema,
  registrationMessage,
  sessionMessage,
  deleteAccountMessage,
  sessionResponseSchema,
  versionResponseSchema,
  type DeviceList,
  type RegisterRequest,
} from '@river/protocol';
import type { AccountStatus } from '../../shared/ipc.ts';
import { serverUrlSchema } from '../../shared/settings.ts';
import { HOME_LINK_BASE } from '../../shared/home-server.ts';
import { ApiError, NetworkError, type RequestJson } from '../http.ts';
import type { IdentityService } from '../identity/identity-service.ts';
import type { Logger } from '../logger.ts';
import type { LocalDatabase } from '../storage/database.ts';

interface AccountRow {
  server_url: string;
  river_id: string;
  username: string | null;
  device_id: number;
  device_public_key: Uint8Array;
  device_list: Uint8Array;
  device_list_signature: Uint8Array;
  device_list_version: number;
}

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64');

export interface AccountServiceDeps {
  db: () => LocalDatabase | null;
  identity: IdentityService;
  requestJson: RequestJson;
  log: Logger;
  now?: () => Date;
  /** This PC's public server address while it hosts the server (for links people can open). */
  publicAddress?: () => string | null;
  /** The account is on River's home server: shared links use its permanent address. */
  homeLinks?: () => boolean;
}

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

/**
 * The user's account on a River server. Registration proves possession of the
 * identity key and a fresh per-device key; later sessions use only the device
 * key (challenge–response). Session tokens live in memory, never on disk.
 */
export class AccountService {
  private readonly deps: AccountServiceDeps;
  private token: string | null = null;
  /** Refused signing in although the server answered: it does not know this account. */
  private missing = false;
  /**
   * The account is still on its server (setting it up again was refused: it exists), so it is
   * this device that was removed from it. Learned only by trying: the server's sign-in answer
   * is the same for both on purpose (it does not reveal which accounts exist).
   */
  private removed = false;
  private connection: 'connecting' | 'online' | 'offline' | 'error' = 'offline';
  private message: string | undefined;
  private readonly listeners = new Set<(s: AccountStatus) => void>();

  constructor(deps: AccountServiceDeps) {
    this.deps = deps;
  }

  status(): AccountStatus {
    const row = this.row();
    if (!row) return { state: 'none' };
    const list = parseDeviceList(row.device_list);
    return {
      state: 'registered',
      server: new URL(row.server_url).host,
      serverUrl: row.server_url,
      shareUrl: this.deps.homeLinks?.()
        ? HOME_LINK_BASE
        : (LOOPBACK.test(row.server_url) && this.deps.publicAddress?.()) || row.server_url,
      riverId: row.river_id,
      username: row.username,
      deviceId: row.device_id,
      devices: list.devices.length,
      listVersion: row.device_list_version,
      connection: this.connection,
      ...(this.missing ? { missing: true } : {}),
      ...(this.missing && this.removed ? { removed: true } : {}),
      ...(this.missing && wasLinked(row) ? { wasLinked: true } : {}),
      ...(this.message ? { message: this.message } : {}),
    };
  }

  onStatus(listener: (s: AccountStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Main-process only. Null until connected. */
  sessionToken(): string | null {
    return this.token;
  }

  /**
   * The server refused the session token (it expired, or this device was removed): forget it,
   * so the next use signs in again instead of offering the dead token forever.
   */
  dropSession(): void {
    this.token = null;
  }

  /**
   * Creates an account for this identity. `replaceMissing`: the server no longer lets this device
   * sign in (Settings → Account → Set up again). The old account is replaced only once the new
   * one exists, so a refusal (the account is still there, registration is closed, no network)
   * leaves everything as it was.
   */
  async register(
    rawServerUrl: unknown,
    signupCode?: string,
    options: { replaceMissing?: boolean } = {},
  ): Promise<AccountStatus> {
    const db = this.deps.db();
    const signer = this.deps.identity.signer();
    if (!db || !signer) throw new UserFacingError('Create your identity before creating an account.');
    const replacing = options.replaceMissing === true;
    if (replacing && !this.missing)
      throw new UserFacingError('Your account is fine — nothing to set up again.');
    if (this.row() && !replacing) throw new UserFacingError('This device already has an account.');
    const parsedUrl = serverUrlSchema.safeParse(rawServerUrl);
    if (!parsedUrl.success) throw new UserFacingError('Set a valid server address first.');
    const server = parsedUrl.data;
    const { requestJson } = this.deps;

    try {
      const version = await requestJson(
        `${server}${API_PREFIX}/version`,
        { method: 'GET' },
        versionResponseSchema,
      );
      if (checkCompatibility(version.protocol) !== 'compatible') {
        throw new UserFacingError('This server uses a River protocol version this app does not support.');
      }

      const device = generateKeyPair();
      const now = this.now().toISOString();
      const list: DeviceList = {
        version: 1,
        riverId: signer.riverId,
        devices: [
          {
            deviceId: 1,
            authKey: b64(device.publicKey),
            registrationId: signer.registrationId,
            addedAt: now,
          },
        ],
      };
      const listBytes = Buffer.from(JSON.stringify(list), 'utf8');
      const listSignature = signer.sign(deviceListMessage(listBytes));

      const { challenge } = await requestJson(
        `${server}${API_PREFIX}/auth/challenge`,
        { method: 'POST', body: { purpose: 'register' } },
        challengeResponseSchema,
      );
      const message = registrationMessage(unb64(challenge), listBytes);
      const body: RegisterRequest = {
        identityKey: b64(signer.publicKey),
        deviceId: 1,
        deviceList: b64(listBytes),
        deviceListSignature: b64(listSignature),
        challenge,
        identitySignature: b64(signer.sign(message)),
        deviceSignature: b64(sign(device.privateKey, message)),
        ...(signupCode ? { signupCode } : {}),
      };
      const res = await requestJson(
        `${server}${API_PREFIX}/accounts`,
        { method: 'POST', body },
        registerResponseSchema,
      );
      if (res.riverId !== signer.riverId || res.deviceId !== 1) {
        throw new UserFacingError('The server answered for a different account.');
      }

      try {
        db.transaction(() => {
          // The account this device could no longer sign in to goes only now that its new one exists.
          if (replacing) db.prepare('DELETE FROM account WHERE id = 1').run();
          // A new account may be on another server: forget the identity pinned for the old one.
          db.prepare('DELETE FROM server_instance').run();
          db.prepare(
            `INSERT INTO account (id, server_url, river_id, device_id, device_public_key, device_private_key,
                                  device_list, device_list_signature, device_list_version, registered_at)
             VALUES (1, ?, ?, 1, ?, ?, ?, ?, 1, ?)`,
          ).run(
            server,
            signer.riverId,
            Buffer.from(device.publicKey),
            Buffer.from(device.privateKey),
            listBytes,
            Buffer.from(listSignature),
            now,
          );
        })();
      } finally {
        device.privateKey.fill(0);
      }
      this.missing = false;
      this.removed = false;
      this.token = res.session.token;
      this.deps.log.info('Account registered');
      this.setConnection('online');
      return this.status();
    } catch (err) {
      if (replacing && err instanceof ApiError && err.code === 'account_exists') {
        // The account is still there: it is this device that was removed from it.
        this.removed = true;
        this.deps.log.warn('The account still exists; this device was removed from it');
        this.setConnection('error', REMOVED_MESSAGE);
        throw new UserFacingError(REMOVED_MESSAGE, { code: 'account_exists' });
      }
      throw toUserFacing(err);
    }
  }

  /**
   * A device linked to an existing account (1.3): signs in as `deviceId` with this device's key,
   * checks the account record is signed by the adopted identity and lists this device, and stores
   * the account. The identity must already be adopted.
   */
  async adoptLinked(
    rawServerUrl: string,
    deviceId: number,
    device: { publicKey: Uint8Array; privateKey: Uint8Array },
  ): Promise<AccountStatus> {
    const db = this.deps.db();
    const signer = this.deps.identity.signer();
    if (!db || !signer) throw new UserFacingError('Link this device first.');
    if (this.row()) throw new UserFacingError('This device already has an account.');
    const server = serverUrlSchema.parse(rawServerUrl);
    const { requestJson } = this.deps;
    try {
      const { challenge } = await requestJson(
        `${server}${API_PREFIX}/auth/challenge`,
        { method: 'POST', body: { purpose: 'session' } },
        challengeResponseSchema,
      );
      const signature = sign(device.privateKey, sessionMessage(unb64(challenge), signer.riverId, deviceId));
      const session = await requestJson(
        `${server}${API_PREFIX}/auth/session`,
        { method: 'POST', body: { riverId: signer.riverId, deviceId, challenge, signature: b64(signature) } },
        sessionResponseSchema,
      );
      const account = await requestJson(
        `${server}${API_PREFIX}/accounts/me`,
        { method: 'GET', token: session.token },
        accountResponseSchema,
      );
      const listBytes = unb64(account.deviceList);
      const list = parseDeviceList(listBytes);
      const genuine =
        account.riverId === signer.riverId &&
        Buffer.from(unb64(account.identityKey)).equals(Buffer.from(signer.publicKey)) &&
        verify(signer.publicKey, deviceListMessage(listBytes), unb64(account.deviceListSignature)) &&
        list.devices.some((d) => d.deviceId === deviceId && d.authKey === b64(device.publicKey));
      if (!genuine)
        throw new UserFacingError('The server returned account data that does not match the link.');
      db.prepare('DELETE FROM server_instance').run();
      db.prepare(
        `INSERT INTO account (id, server_url, river_id, device_id, device_public_key, device_private_key,
                              device_list, device_list_signature, device_list_version, registered_at, username)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        server,
        signer.riverId,
        deviceId,
        Buffer.from(device.publicKey),
        Buffer.from(device.privateKey),
        listBytes,
        unb64(account.deviceListSignature),
        list.version,
        this.now().toISOString(),
        account.username ?? null,
      );
      db.prepare("DELETE FROM meta WHERE key = 'relink_river_id'").run();
      this.token = session.token;
      this.deps.log.info(`Linked as device ${deviceId}`);
      this.setConnection('online');
      return this.status();
    } catch (err) {
      throw toUserFacing(err);
    }
  }

  /** This account's signed device list as the server has it (verified against our identity). */
  async deviceList(): Promise<DeviceList> {
    const row = this.row();
    const signer = this.deps.identity.signer();
    if (!row || !signer || !this.token)
      throw new UserFacingError('Connect to your server first, then try again.');
    const account = await this.deps.requestJson(
      `${row.server_url}${API_PREFIX}/accounts/me`,
      { method: 'GET', token: this.token },
      accountResponseSchema,
    );
    const listBytes = unb64(account.deviceList);
    if (!verify(signer.publicKey, deviceListMessage(listBytes), unb64(account.deviceListSignature))) {
      throw new UserFacingError('The server returned a device list that is not signed by your identity.');
    }
    const list = parseDeviceList(listBytes);
    // An older list could bring back a removed device: never go backwards.
    if (list.riverId !== row.river_id || list.version < row.device_list_version) {
      throw new UserFacingError('The server returned an older or foreign device list. Nothing was changed.');
    }
    return list;
  }

  /** Signs and uploads a new device list (adds or removes devices); keeps the local copy. */
  async publishDeviceList(list: DeviceList): Promise<void> {
    const row = this.row();
    const signer = this.deps.identity.signer();
    const db = this.deps.db();
    if (!row || !signer || !db || !this.token) {
      throw new UserFacingError('Connect to your server first, then try again.');
    }
    const listBytes = Buffer.from(JSON.stringify(list), 'utf8');
    const signature = signer.sign(deviceListMessage(listBytes));
    try {
      await this.deps.requestJson(
        `${row.server_url}${API_PREFIX}/accounts/me/devices`,
        {
          method: 'PUT',
          token: this.token,
          body: { deviceList: b64(listBytes), deviceListSignature: b64(signature) },
        },
        z.object({ devices: z.number(), removed: z.array(z.number()) }),
      );
    } catch (err) {
      throw toUserFacing(err);
    }
    db.prepare(
      'UPDATE account SET device_list = ?, device_list_signature = ?, device_list_version = ? WHERE id = 1',
    ).run(listBytes, Buffer.from(signature), list.version);
  }

  /** True if this account is linked on other devices too (from the last device list seen). */
  hasOtherDevices(): boolean {
    const row = this.row();
    return !!row && parseDeviceList(row.device_list).devices.length > 1;
  }

  /**
   * Names of this account's devices, as typed when they were linked (kept on the devices only,
   * shared between them end-to-end encrypted; the server never sees them).
   */
  deviceNames(): Record<string, string> {
    const row = this.deps.db()?.prepare("SELECT value FROM meta WHERE key = 'device_names'").get() as
      { value: string } | undefined;
    try {
      const parsed: unknown = row ? JSON.parse(row.value) : {};
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  /** Adds or replaces device names (ID → name); unknown shapes are ignored. */
  setDeviceNames(patch: Record<string, unknown>, onlyMissing = false): void {
    const db = this.deps.db();
    if (!db) return;
    const names = this.deviceNames();
    for (const [id, name] of Object.entries(patch)) {
      if (!/^[1-9][0-9]?$/.test(id) || typeof name !== 'string' || !name.trim()) continue;
      if (onlyMissing && names[id]) continue;
      names[id] = name.trim().slice(0, 64);
    }
    const kept = Object.fromEntries(Object.entries(names).slice(0, 20));
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('device_names', ?)").run(
      JSON.stringify(kept),
    );
  }

  /** This device's ID on the account (1 for the device that created it). */
  deviceId(): number | null {
    return this.row()?.device_id ?? null;
  }

  /**
   * True if this account can sign in at `url` with its device key — i.e. that
   * server really holds this account. Changes nothing; used before moving the
   * account to a new address it was not told about by a signed note.
   */
  async canSignInAt(url: string): Promise<boolean> {
    const row = this.row();
    if (!row || !this.deps.identity.signer()) return false;
    const { requestJson } = this.deps;
    try {
      const { challenge } = await requestJson(
        `${url}${API_PREFIX}/auth/challenge`,
        { method: 'POST', body: { purpose: 'session' } },
        challengeResponseSchema,
      );
      const signature = this.signWithDevice(sessionMessage(unb64(challenge), row.river_id, row.device_id));
      await requestJson(
        `${url}${API_PREFIX}/auth/session`,
        {
          method: 'POST',
          body: { riverId: row.river_id, deviceId: row.device_id, challenge, signature: b64(signature) },
        },
        sessionResponseSchema,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Opens a session with the device key and checks that the server holds the
   * device list we signed. Never throws; problems are reported in status().
   */
  async connect(): Promise<AccountStatus> {
    const row = this.row();
    const signer = this.deps.identity.signer();
    if (!row || !signer) return this.status();
    // Asking again cannot help; the person decides (Settings → Account → Set up again).
    if (this.missing) return this.status();
    this.setConnection('connecting');
    const { requestJson } = this.deps;
    try {
      const { challenge } = await requestJson(
        `${row.server_url}${API_PREFIX}/auth/challenge`,
        { method: 'POST', body: { purpose: 'session' } },
        challengeResponseSchema,
      );
      const signature = this.signWithDevice(sessionMessage(unb64(challenge), row.river_id, row.device_id));
      const session = await requestJson(
        `${row.server_url}${API_PREFIX}/auth/session`,
        {
          method: 'POST',
          body: { riverId: row.river_id, deviceId: row.device_id, challenge, signature: b64(signature) },
        },
        sessionResponseSchema,
      );
      this.token = session.token;

      const account = await requestJson(
        `${row.server_url}${API_PREFIX}/accounts/me`,
        { method: 'GET', token: session.token },
        accountResponseSchema,
      );
      // Keep the username the server has (the operator may have set one for us; we may have set it here).
      if (account.username !== undefined && account.username !== row.username) {
        this.deps
          .db()
          ?.prepare('UPDATE account SET username = ? WHERE id = 1')
          .run(account.username ?? null);
      }
      const listBytes = unb64(account.deviceList);
      const genuine =
        account.riverId === row.river_id &&
        Buffer.from(unb64(account.identityKey)).equals(Buffer.from(signer.publicKey)) &&
        verify(signer.publicKey, deviceListMessage(listBytes), unb64(account.deviceListSignature)) &&
        parseDeviceList(listBytes).version >= row.device_list_version;
      if (!genuine) {
        this.token = null;
        this.deps.log.error('Server returned an account record not signed by this identity');
        this.setConnection(
          'error',
          'The server returned account data that is not signed by your identity. River stopped talking to it.',
        );
        return this.status();
      }
      // Another of this account's devices changed the device list (linked or removed a device).
      const serverVersion = parseDeviceList(listBytes).version;
      if (serverVersion > row.device_list_version) {
        this.deps
          .db()
          ?.prepare(
            'UPDATE account SET device_list = ?, device_list_signature = ?, device_list_version = ? WHERE id = 1',
          )
          .run(listBytes, unb64(account.deviceListSignature), serverVersion);
      }
      this.setConnection('online');
    } catch (err) {
      this.token = null;
      if (err instanceof NetworkError) this.setConnection('offline', 'Server unreachable');
      else if (err instanceof ApiError && err.status === 401 && err.code === 'unauthorized') {
        // The server is there and answered the challenge, but not for this account.
        this.missing = true;
        this.deps.log.warn('Account not recognised by its server');
        this.setConnection(
          'error',
          wasLinked(row)
            ? 'This device can no longer sign in to your account — it was probably removed on one of your other devices. Link it again from a device that still has your account, or set up a new account.'
            : 'Your account is no longer on this River server — it may have been removed. Set it up again to keep using River.',
        );
      } else {
        this.deps.log.warn(`Account connect failed: ${(err as Error).name}`);
        this.setConnection('error', toUserFacing(err).message);
      }
    }
    return this.status();
  }

  /**
   * Deletes this account from its server for good (1.0.18): proves it with a
   * fresh challenge signed by this device's key, then forgets the account on
   * this device. Your identity, contacts and messages on this device stay.
   */
  async deleteAccount(): Promise<void> {
    const row = this.row();
    if (!row) throw new UserFacingError('There is no account to delete.');
    const token = this.token ?? (await this.connect(), this.token);
    if (!token) throw new UserFacingError('Connect to your server first, then try again.');
    const { requestJson } = this.deps;
    const { challenge } = await requestJson(
      `${row.server_url}${API_PREFIX}/auth/challenge`,
      { method: 'POST', body: { purpose: 'session' } },
      challengeResponseSchema,
    );
    const signature = this.signWithDevice(
      deleteAccountMessage(unb64(challenge), row.river_id, row.device_id),
    );
    await requestJson(
      `${row.server_url}${API_PREFIX}/accounts/me`,
      { method: 'DELETE', token, body: { challenge, deviceId: row.device_id, signature: b64(signature) } },
      z.object({ ok: z.literal(true) }),
    );
    this.token = null;
    this.deps.db()?.prepare('DELETE FROM account WHERE id = 1').run();
    this.setConnection('offline');
  }

  /**
   * The server no longer knows this account. Forgets it on this device (your
   * identity, contacts and messages stay) so a new account can be created.
   * Returns the address the old account used.
   */
  forgetMissing(): string {
    const row = this.row();
    if (!row) throw new UserFacingError('There is no account to set up again.');
    if (!this.missing) throw new UserFacingError('Your account is fine — nothing to set up again.');
    this.token = null;
    this.missing = false;
    const db = this.deps.db();
    db?.prepare('DELETE FROM account WHERE id = 1').run();
    db?.prepare('DELETE FROM server_instance').run();
    this.setConnection('offline');
    return row.server_url;
  }

  /**
   * "Link this device again": this device was removed from its account. Forgets the account and
   * the identity here (both come back from the account's other device when it links this one
   * again) and the protocol state of the old device, whose sessions and prekeys would not match
   * the new one. Contacts, messages and settings stay. Returns the River ID the link must bring
   * back: this device's messages belong to that account.
   */
  forgetForRelink(): string {
    const row = this.row();
    const db = this.deps.db();
    if (!row || !db) throw new UserFacingError('There is no account to link again.');
    if (!this.missing) throw new UserFacingError('Your account is fine — this device is still linked.');
    db.transaction(() => {
      db.prepare('DELETE FROM account WHERE id = 1').run();
      db.prepare('DELETE FROM server_instance').run();
      db.prepare('DELETE FROM identity WHERE id = 1 AND river_id = ?').run(row.river_id);
      db.prepare(
        `DELETE FROM signal_store WHERE kind IN ('session', 'prekey', 'signed', 'kyber')
            OR (kind = 'meta' AND id IN ('dm:keysUploaded', 'dm:signedAt', 'dm:contactsSynced'))`,
      ).run();
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('relink_river_id', ?)").run(row.river_id);
    })();
    this.token = null;
    this.missing = false;
    this.removed = false;
    this.deps.log.info('Forgot the removed device; it can be linked again');
    this.setConnection('offline');
    return row.river_id;
  }

  /** After "Link this device again": the account this device's messages belong to. */
  relinkTarget(): string | null {
    const row = this.deps.db()?.prepare("SELECT value FROM meta WHERE key = 'relink_river_id'").get() as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  private signWithDevice(message: Uint8Array): Uint8Array {
    const db = this.deps.db();
    const { device_private_key } = db!
      .prepare('SELECT device_private_key FROM account WHERE id = 1')
      .get() as {
      device_private_key: Uint8Array;
    };
    try {
      return sign(device_private_key, message);
    } finally {
      device_private_key.fill(0);
    }
  }

  private row(): AccountRow | null {
    const db = this.deps.db();
    if (!db) return null;
    return (
      (db
        .prepare(
          `SELECT server_url, river_id, username, device_id, device_public_key, device_list,
                  device_list_signature, device_list_version FROM account WHERE id = 1`,
        )
        .get() as AccountRow | undefined) ?? null
    );
  }

  /** Finds someone by @username, to add them as a friend. */
  async lookupUser(rawUsername: unknown): Promise<{ username: string; riverId: string }> {
    const row = this.row();
    if (!row || !this.token) throw new UserFacingError('Connect to your server first, then try again.');
    const username = (typeof rawUsername === 'string' ? rawUsername : '').trim().replace(/^@/, '');
    try {
      return await this.deps.requestJson(
        `${row.server_url}${API_PREFIX}/users/lookup?username=${encodeURIComponent(username)}`,
        { method: 'GET', token: this.token },
        usernameResponseSchema,
      );
    } catch (err) {
      throw toUserFacing(err);
    }
  }

  /** Chooses or changes your username on the server (people find you by it). */
  async setUsername(rawUsername: unknown): Promise<AccountStatus> {
    const db = this.deps.db();
    const row = this.row();
    if (!db || !row) throw new UserFacingError('Create your account first.');
    if (!this.token) throw new UserFacingError('Connect to your server first, then try again.');
    // "@alice" is how people write it; the username itself has no @.
    const username = typeof rawUsername === 'string' ? rawUsername.trim().replace(/^@+/, '') : '';
    try {
      const res = await this.deps.requestJson(
        `${row.server_url}${API_PREFIX}/accounts/me/username`,
        { method: 'PUT', body: { username }, token: this.token },
        usernameResponseSchema,
      );
      db.prepare('UPDATE account SET username = ? WHERE id = 1').run(res.username);
      this.setConnection(this.connection);
      return this.status();
    } catch (err) {
      throw toUserFacing(err);
    }
  }

  /**
   * The same server, reachable at a new address (see ServerLocator). The
   * account, keys and session stay as they are.
   */
  moveServer(url: string): void {
    const db = this.deps.db();
    if (!db) return;
    db.prepare('UPDATE account SET server_url = ? WHERE id = 1').run(url);
    this.setConnection('connecting');
  }

  /** Tells listeners again (the share address can change without the connection changing). */
  refresh(): void {
    this.setConnection(this.connection, this.message);
  }

  private setConnection(connection: typeof this.connection, message?: string): void {
    this.connection = connection;
    this.message = message;
    const status = this.status();
    for (const l of this.listeners) l(status);
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

const REMOVED_MESSAGE =
  'Your account is still on this server, but this device was removed from it. Link this device again from one of your devices that still has your account.';

/** This device was one of several (or was linked to the account): a refusal most likely means it was removed. */
function wasLinked(row: AccountRow): boolean {
  return row.device_id !== 1 || parseDeviceList(row.device_list).devices.length > 1;
}

/** An error whose message is safe and meaningful to show the user. */
export class UserFacingError extends Error {
  /** The server could not be reached at all (as opposed to refusing). */
  readonly unreachable: boolean;
  /** The server's error code when it refused (e.g. 'signup_invite_only'). */
  readonly code: string | undefined;
  constructor(message: string, options: { unreachable?: boolean; code?: string } = {}) {
    super(message);
    this.name = 'UserFacingError';
    this.unreachable = options.unreachable ?? false;
    this.code = options.code;
  }
}

function toUserFacing(err: unknown): UserFacingError {
  if (err instanceof UserFacingError) return err;
  if (err instanceof NetworkError)
    return new UserFacingError('Could not reach the server. Check the address and your connection.', {
      unreachable: true,
    });
  if (err instanceof ApiError) {
    const code = { code: err.code };
    switch (err.code) {
      case 'registration_closed':
        return new UserFacingError('This server is not accepting new accounts.', code);
      case 'account_exists':
        return new UserFacingError('Your identity already has an account on this server.', code);
      case 'rate_limited':
        return new UserFacingError('The server is busy. Try again in a minute.', code);
      case 'username_taken':
      case 'bad_username':
      case 'signup_invite_only':
      case 'invalid_signup':
      case 'account_suspended':
        return new UserFacingError(err.message, code);
      case 'unauthorized':
        return new UserFacingError('The server did not recognise this device.', code);
      default:
        return new UserFacingError('The server rejected the request.', code);
    }
  }
  return new UserFacingError('Something went wrong talking to the server.');
}
