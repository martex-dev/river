import { generateKeyPair, sign, verify } from '@river/crypto';
import {
  API_PREFIX,
  accountResponseSchema,
  challengeResponseSchema,
  checkCompatibility,
  deviceListMessage,
  parseDeviceList,
  registerResponseSchema,
  registrationMessage,
  sessionMessage,
  sessionResponseSchema,
  versionResponseSchema,
  type DeviceList,
  type RegisterRequest,
} from '@river/protocol';
import type { AccountStatus } from '../../shared/ipc.ts';
import { serverUrlSchema } from '../../shared/settings.ts';
import { ApiError, NetworkError, type RequestJson } from '../http.ts';
import type { IdentityService } from '../identity/identity-service.ts';
import type { Logger } from '../logger.ts';
import type { LocalDatabase } from '../storage/database.ts';

interface AccountRow {
  server_url: string;
  river_id: string;
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
}

/**
 * The user's account on a River server. Registration proves possession of the
 * identity key and a fresh per-device key; later sessions use only the device
 * key (challenge–response). Session tokens live in memory, never on disk.
 */
export class AccountService {
  private readonly deps: AccountServiceDeps;
  private token: string | null = null;
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
      riverId: row.river_id,
      deviceId: row.device_id,
      devices: list.devices.length,
      listVersion: row.device_list_version,
      connection: this.connection,
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

  async register(rawServerUrl: unknown): Promise<AccountStatus> {
    const db = this.deps.db();
    const signer = this.deps.identity.signer();
    if (!db || !signer) throw new UserFacingError('Create your identity before creating an account.');
    if (this.row()) throw new UserFacingError('This device already has an account.');
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
      } finally {
        device.privateKey.fill(0);
      }
      this.token = res.session.token;
      this.deps.log.info('Account registered');
      this.setConnection('online');
      return this.status();
    } catch (err) {
      throw toUserFacing(err);
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
      this.setConnection('online');
    } catch (err) {
      this.token = null;
      if (err instanceof NetworkError) this.setConnection('offline', 'Server unreachable');
      else {
        this.deps.log.warn(`Account connect failed: ${(err as Error).name}`);
        this.setConnection('error', toUserFacing(err).message);
      }
    }
    return this.status();
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
          `SELECT server_url, river_id, device_id, device_public_key, device_list, device_list_signature,
                  device_list_version FROM account WHERE id = 1`,
        )
        .get() as AccountRow | undefined) ?? null
    );
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

/** An error whose message is safe and meaningful to show the user. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

function toUserFacing(err: unknown): UserFacingError {
  if (err instanceof UserFacingError) return err;
  if (err instanceof NetworkError)
    return new UserFacingError('Could not reach the server. Check the address and your connection.');
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'registration_closed':
        return new UserFacingError('This server is not accepting new accounts.');
      case 'account_exists':
        return new UserFacingError('Your identity already has an account on this server.');
      case 'rate_limited':
        return new UserFacingError('The server is busy. Try again in a minute.');
      case 'unauthorized':
        return new UserFacingError('The server did not recognise this device.');
      default:
        return new UserFacingError('The server rejected the request.');
    }
  }
  return new UserFacingError('Something went wrong talking to the server.');
}
