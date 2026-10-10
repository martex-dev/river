import { API_PREFIX, instanceResponseSchema } from '@river/protocol';
import { HOME_SERVER } from '../shared/home-server.ts';
import { UserFacingError, type AccountService } from './account/account-service.ts';
import type { FetchBytes, RequestJson } from './http.ts';
import type { Logger } from './logger.ts';
import { latestNote } from './community/server-locator.ts';

const MAX_RELAY_BYTES = 256 * 1024;
const RETRY_MS = 60_000;

export class HomeServerUnavailable extends Error {
  constructor() {
    super(
      'River’s server is not reachable right now (its host PC may be off). Your account is set up automatically as soon as it is back.',
    );
    this.name = 'HomeServerUnavailable';
  }
}

export interface HomeServerDeps {
  fetchBytes: FetchBytes;
  requestJson: RequestJson;
  /** The address if this PC hosts the home server itself (the maintainer's PC). */
  hostedHere(): string | null;
  /** Tests only: another server identity instead of River's. */
  server?: { instanceId: string; publicKey: string; relay: string; topic: string };
}

/** The home server's current address, verified to be the home server. */
export async function locateHomeServer(deps: HomeServerDeps): Promise<string> {
  const here = deps.hostedHere();
  if (here) return here;
  const home = deps.server ?? HOME_SERVER;
  const pin = { instance_id: home.instanceId, public_key: home.publicKey };
  let note;
  try {
    const raw = await deps.fetchBytes(`${home.relay}/${home.topic}/json?poll=1&since=24h`, MAX_RELAY_BYTES);
    note = latestNote(new TextDecoder().decode(raw), pin);
  } catch {
    throw new HomeServerUnavailable();
  }
  if (!note) throw new HomeServerUnavailable();
  const url = note.url.replace(/\/+$/, '');
  try {
    const info = await deps.requestJson(
      `${url}${API_PREFIX}/instance`,
      { method: 'GET' },
      instanceResponseSchema,
    );
    if (info.id !== home.instanceId || info.publicKey !== home.publicKey) {
      throw new HomeServerUnavailable();
    }
  } catch {
    throw new HomeServerUnavailable();
  }
  return url;
}

export interface HomeAccountDeps extends HomeServerDeps {
  /** Installed builds only: development runs and tests never create accounts on the real server. */
  enabled: boolean;
  account: AccountService;
  /** True once the user has an identity and their local data is open. */
  ready(): boolean;
  /** A server the user chose themselves (Settings → Server); then River leaves the choice to them. */
  chosenServer(): string | null;
  onRegistered(url: string): void;
  log: Logger;
}

/**
 * Creates the user's account on the home server by itself — right after they
 * pick a name, with no server address or button. If the server is not
 * reachable yet, it keeps trying quietly in the background.
 */
export class HomeAccount {
  private readonly deps: HomeAccountDeps;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waiting = false;
  private readonly listeners = new Set<() => void>();

  constructor(deps: HomeAccountDeps) {
    this.deps = deps;
  }

  /** River's server is used at all (installed builds). */
  enabled(): boolean {
    return this.deps.enabled;
  }

  /** The account is being set up but the server is not reachable yet. */
  isWaiting(): boolean {
    return this.waiting;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Makes sure an account exists; throws HomeServerUnavailable if it cannot be made now. */
  ensure(): Promise<void> {
    this.running ??= this.attempt().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Tries now, and keeps trying every minute until it works. Never throws. */
  kick(): void {
    if (!this.needed()) return;
    void this.ensure().catch(() => {
      if (this.timer) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.kick();
      }, RETRY_MS);
    });
  }

  private needed(): boolean {
    return (
      this.deps.enabled &&
      this.deps.ready() &&
      this.deps.account.status().state === 'none' &&
      !this.deps.chosenServer()
    );
  }

  private async attempt(): Promise<void> {
    if (!this.deps.enabled) {
      throw new UserFacingError(
        'This development build does not use River’s server. Choose “Use a different server”.',
      );
    }
    if (!this.needed()) return;
    try {
      const url = await locateHomeServer(this.deps);
      await this.deps.account.register(url);
      this.deps.onRegistered(url);
      this.deps.log.info('Account created on River’s server');
      this.setWaiting(false);
    } catch (err) {
      this.setWaiting(true);
      throw err;
    }
  }

  private setWaiting(waiting: boolean): void {
    if (this.waiting === waiting) return;
    this.waiting = waiting;
    for (const l of this.listeners) l();
  }
}
