import { createPublicKey, verify } from 'node:crypto';
import {
  API_PREFIX,
  beaconMessage,
  beaconNoteSchema,
  instanceResponseSchema,
  type BeaconNote,
} from '@river/protocol';
import type { AccountService } from '../account/account-service.ts';
import type { FetchBytes, RequestJson } from '../http.ts';
import type { Logger } from '../logger.ts';
import type { LocalDatabase } from '../storage/database.ts';

interface Pin {
  instance_id: string;
  public_key: string;
  relay: string | null;
  topic: string | null;
}

const MAX_RELAY_BYTES = 256 * 1024;

export interface ServerLocatorDeps {
  db: () => LocalDatabase | null;
  account: AccountService;
  requestJson: RequestJson;
  fetchBytes: FetchBytes;
  log: Logger;
  /** Called after the account moved to a new address (e.g. to update Settings → Server). */
  onMoved?: (url: string) => void;
}

/**
 * Finds your River server again after its address changed — a home PC behind
 * a free tunnel gets a new address every restart.
 *
 * While connected, River remembers the server's identity key and where it
 * announces new addresses. When the server cannot be reached, River reads the
 * announcements, keeps only notes the same key signed, checks the new address
 * really is the same server, and moves your account there. A forged note or a
 * different server at the new address is ignored.
 */
export class ServerLocator {
  private readonly deps: ServerLocatorDeps;

  constructor(deps: ServerLocatorDeps) {
    this.deps = deps;
  }

  /** Remembers who the current server is (call while connected). */
  async pin(): Promise<void> {
    const status = this.deps.account.status();
    const db = this.deps.db();
    if (status.state !== 'registered' || !db) return;
    const info = await this.deps.requestJson(
      `${status.serverUrl}${API_PREFIX}/instance`,
      { method: 'GET' },
      instanceResponseSchema,
    );
    const known = this.current();
    // Never let a server silently replace the identity we pinned.
    if (known && (known.instance_id !== info.id || known.public_key !== info.publicKey)) {
      this.deps.log.warn('Server identity changed; keeping the identity first seen');
      return;
    }
    db.prepare(
      `INSERT INTO server_instance (id, instance_id, public_key, relay, topic) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET relay = excluded.relay, topic = excluded.topic`,
    ).run(info.id, info.publicKey, info.beacon?.relay ?? null, info.beacon?.topic ?? null);
  }

  /**
   * Looks for a newer signed address. Returns the new address if the account
   * moved there, or null if nothing changed.
   */
  async follow(): Promise<string | null> {
    const pin = this.current();
    const status = this.deps.account.status();
    if (!pin?.relay || !pin.topic || status.state !== 'registered') return null;
    const raw = await this.deps.fetchBytes(
      `${pin.relay}/${pin.topic}/json?poll=1&since=24h`,
      MAX_RELAY_BYTES,
    );
    const latest = latestNote(new TextDecoder().decode(raw), pin);
    if (!latest || sameUrl(latest.url, status.serverUrl)) return null;
    // The note is genuine; still check the address answers as the same server before moving.
    const info = await this.deps.requestJson(
      `${latest.url}${API_PREFIX}/instance`,
      { method: 'GET' },
      instanceResponseSchema,
    );
    if (info.id !== pin.instance_id || info.publicKey !== pin.public_key) {
      this.deps.log.warn('A signed address pointed at a different server; ignored');
      return null;
    }
    const url = latest.url.replace(/\/+$/, '');
    this.deps.account.moveServer(url);
    this.deps.onMoved?.(url);
    this.deps.log.info('Followed the server to its new address');
    return url;
  }

  /** The instance ID pinned for your account's server, if any. */
  pinnedId(): string | null {
    return this.current()?.instance_id ?? null;
  }

  private current(): Pin | null {
    const db = this.deps.db();
    if (!db) return null;
    return (
      (db.prepare('SELECT instance_id, public_key, relay, topic FROM server_instance WHERE id = 1').get() as
        Pin | undefined) ?? null
    );
  }
}

const sameUrl = (a: string, b: string): boolean => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/** The newest note in a relay response (one JSON object per line) that the pinned key signed. */
export function latestNote(
  body: string,
  pin: { instance_id: string; public_key: string },
): BeaconNote | null {
  const key = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pin.public_key, 'base64').toString('base64url') },
    format: 'jwk',
  });
  let best: BeaconNote | null = null;
  for (const line of body.split('\n')) {
    try {
      const event = JSON.parse(line) as { event?: string; message?: string };
      if (event.event !== 'message' || typeof event.message !== 'string') continue;
      const note = beaconNoteSchema.parse(JSON.parse(event.message));
      const genuine = verify(
        null,
        beaconMessage(pin.instance_id, note.url, note.issuedAt),
        key,
        Buffer.from(note.sig, 'base64'),
      );
      if (genuine && (!best || note.issuedAt > best.issuedAt)) best = note;
    } catch {
      // not a note, or not ours: skip
    }
  }
  return best;
}
