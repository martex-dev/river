import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { API_PREFIX, beaconMessage, instanceAddressRequestSchema } from '@river/protocol';
import type { ServerConfig } from '../config.ts';
import type { RiverDatabase } from '../db/database.ts';
import { requireHost } from '../host-auth.ts';

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
    requireHost(request, hostToken);
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
