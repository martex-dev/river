import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
} from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { API_PREFIX, beaconMessage, instanceAddressRequestSchema } from '@river/protocol';
import type { ServerConfig } from '../config.ts';
import type { RiverDatabase } from '../db/database.ts';
import { HttpError } from '../http-error.ts';

/**
 * Who this server is, and where it can be found after its address changes.
 *
 * A server on a home PC behind a free tunnel gets a new public address every
 * time the PC restarts. So the server keeps an Ed25519 key; River Host tells
 * it its new address, and it publishes a signed note ("I am now at …") to a
 * public relay under a random topic. Members' apps pin the key while
 * connected, read the relay when the server disappears, and move only to an
 * address the same server signed.
 */
interface Instance {
  id: string;
  publicKey: string;
  privateKeyPem: string;
  topic: string;
}

async function meta(db: RiverDatabase['db'], key: string, make: () => string): Promise<string> {
  const row = await db.selectFrom('server_meta').select('value').where('key', '=', key).executeTakeFirst();
  if (row) return row.value;
  const value = make();
  await db
    .insertInto('server_meta')
    .values({ key, value })
    .onConflict((oc) => oc.column('key').doNothing())
    .execute();
  return (await db.selectFrom('server_meta').select('value').where('key', '=', key).executeTakeFirstOrThrow())
    .value;
}

async function loadInstance(db: RiverDatabase['db']): Promise<Instance> {
  const id = await meta(db, 'instance_id', () => randomBytes(16).toString('hex'));
  const privateKeyPem = await meta(db, 'instance_signing_key', () =>
    generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  );
  const topic = await meta(db, 'beacon_topic', () => `river-${randomBytes(18).toString('base64url')}`);
  const jwk = createPublicKey(createPrivateKey(privateKeyPem)).export({ format: 'jwk' });
  return { id, publicKey: Buffer.from(jwk.x!, 'base64url').toString('base64'), privateKeyPem, topic };
}

/** A request that arrived straight from this machine, not through the tunnel or a proxy. */
function fromThisMachine(request: FastifyRequest): boolean {
  const remote = request.socket.remoteAddress ?? '';
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const proxied = ['x-forwarded-for', 'cf-connecting-ip', 'forwarded', 'x-real-ip'].some(
    (h) => request.headers[h] !== undefined,
  );
  return loopback && !proxied;
}

function sameSecret(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerInstanceRoutes(
  app: FastifyInstance,
  deps: { config: ServerConfig; database: RiverDatabase; fetch?: typeof fetch; now: () => Date },
): void {
  const { config } = deps;
  const instance = loadInstance(deps.database.db);
  const publish = deps.fetch ?? fetch;

  /** The last public address River Host announced (it is public anyway). */
  let address: string | null = null;

  app.get(`${API_PREFIX}/instance`, async () => {
    const i = await instance;
    return {
      id: i.id,
      publicKey: i.publicKey,
      beacon: config.beaconRelay ? { relay: config.beaconRelay, topic: i.topic } : null,
      address,
    };
  });

  // Only River Host on this same machine, with the token it started the server with, may announce.
  if (!config.hostToken) return;
  const hostToken = config.hostToken;
  app.post(`${API_PREFIX}/instance/address`, async (request) => {
    if (!fromThisMachine(request)) throw new HttpError(404, 'not_found', 'Not found');
    const auth = request.headers.authorization?.replace(/^Bearer /, '');
    if (!sameSecret(auth, hostToken)) throw new HttpError(401, 'unauthorized', 'Wrong host token');
    const { url } = instanceAddressRequestSchema.parse(request.body);
    const i = await instance;
    const issuedAt = deps.now().toISOString();
    const sig = sign(null, beaconMessage(i.id, url, issuedAt), createPrivateKey(i.privateKeyPem)).toString(
      'base64',
    );
    let published = false;
    if (config.beaconRelay) {
      try {
        const res = await publish(`${config.beaconRelay}/${i.topic}`, {
          method: 'POST',
          body: JSON.stringify({ url, issuedAt, sig }),
          headers: { 'content-type': 'text/plain' },
          signal: AbortSignal.timeout(15_000),
        });
        published = res.ok;
      } catch (err) {
        request.log.warn({ err: { message: (err as Error).message } }, 'beacon publish failed');
      }
    }
    address = url;
    return { ok: true, published, note: { url, issuedAt, sig } };
  });
}
