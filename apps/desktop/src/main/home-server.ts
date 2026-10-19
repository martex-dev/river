import { API_PREFIX, instanceResponseSchema } from '@river/protocol';
import { HOME_SERVER } from '../shared/home-server.ts';
import { UserFacingError, type AccountService } from './account/account-service.ts';
import type { FetchBytes, RequestJson } from './http.ts';
import type { Logger } from './logger.ts';
import { latestNote } from './community/server-locator.ts';
import { msg } from '../shared/i18n/index.ts';

const MAX_RELAY_BYTES = 256 * 1024;
/** First retries come quickly (a tunnel blip lasts seconds), then settle at once a minute. */
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;

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
  /** False after the user deleted their account: no account is made unless they ask (1.0.18). */
  autoAccount?(): boolean;
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

  /** River's server's current address (verified), for links made with its permanent address. */
  locate(): Promise<string> {
    if (!this.deps.enabled) {
      throw new UserFacingError(msg('This development build does not use River’s server.'));
    }
    return locateHomeServer(this.deps);
  }

  /** The account is being set up but the server is not reachable yet. */
  isWaiting(): boolean {
    return this.waiting;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Makes sure an account exists; throws HomeServerUnavailable if it cannot be made now.
   * `force`: the person asked for it (Set up again, creating or joining a community), so a
   * server saved in settings does not stop it — callers check that server is River's first
   * (isHomeServer), because River saves the home server's address there once it made the account.
   */
  ensure(options: { force?: boolean } = {}): Promise<void> {
    if (!options.force) {
      this.running ??= this.track(this.attempt(false));
      return this.running;
    }
    // After any attempt already running (which may have stopped at the saved server), try once more.
    const before = this.running?.catch(() => undefined);
    this.running = this.track(
      (async () => {
        await before;
        await this.attempt(true);
      })(),
    );
    return this.running;
  }

  private track(attempt: Promise<void>): Promise<void> {
    const tracked: Promise<void> = attempt.finally(() => {
      if (this.running === tracked) this.running = null;
    });
    return tracked;
  }

  /** The server at `url` is River's own (checked against its identity, not its address). */
  async isHomeServer(url: string): Promise<boolean> {
    if (!this.deps.enabled) return false;
    if (this.deps.hostedHere() === url) return true;
    const home = this.deps.server ?? HOME_SERVER;
    try {
      const info = await this.deps.requestJson(
        `${url.replace(/\/+$/, '')}${API_PREFIX}/instance`,
        { method: 'GET' },
        instanceResponseSchema,
      );
      return info.id === home.instanceId && info.publicKey === home.publicKey;
    } catch {
      return false;
    }
  }

  private retryMs = RETRY_MIN_MS;

  private inviteOnly = false;

  /** River's server said it only takes invited people: the account needs a sign-up link. */
  needsInvite(): boolean {
    return this.inviteOnly && this.deps.account.status().state === 'none';
  }

  /**
   * Tries now, and keeps trying (5 s, 10 s, 20 s … then every minute) until it works. Never throws.
   * A server that only takes invited people stops it: asking again cannot help without a sign-up
   * link (the next kick, e.g. River starting again, asks once more).
   */
  kick(): void {
    if (!this.needed() || this.deps.autoAccount?.() === false) return;
    void this.ensure().then(
      () => {
        this.retryMs = RETRY_MIN_MS;
        this.setInviteOnly(false);
      },
      (err: unknown) => {
        if (err instanceof UserFacingError && err.code === 'signup_invite_only') {
          this.deps.log.info('River’s server only accepts invited people; waiting for a sign-up link');
          this.setWaiting(false);
          this.setInviteOnly(true);
          return;
        }
        if (this.timer) return;
        const wait = this.retryMs;
        this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
        this.timer = setTimeout(() => {
          this.timer = null;
          this.kick();
        }, wait);
      },
    );
  }

  private needed(force = false): boolean {
    return (
      this.deps.enabled &&
      this.deps.ready() &&
      this.deps.account.status().state === 'none' &&
      (force || !this.deps.chosenServer())
    );
  }

  private async attempt(force = false): Promise<void> {
    if (!this.deps.enabled) {
      throw new UserFacingError(
        msg('This development build does not use River’s server. Choose “Use a different server”.'),
      );
    }
    if (!this.needed(force)) return;
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

  private setInviteOnly(inviteOnly: boolean): void {
    if (this.inviteOnly === inviteOnly) return;
    this.inviteOnly = inviteOnly;
    for (const l of this.listeners) l();
  }

  private setWaiting(waiting: boolean): void {
    if (this.waiting === waiting) return;
    this.waiting = waiting;
    for (const l of this.listeners) l();
  }
}
