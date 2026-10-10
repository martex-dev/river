import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createIdentity, generateKeyPair, sign, type IdentityKeys } from '@river/crypto';
import {
  challengeResponseSchema,
  deviceListMessage,
  registerResponseSchema,
  registrationMessage,
} from '@river/protocol';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../src/db/database.ts';

export const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
export const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

/** A fresh in-memory server. */
export async function startServer(): Promise<{ app: FastifyInstance; database: RiverDatabase }> {
  const database = openDatabase('sqlite::memory:');
  await migrateToLatest(database.db);
  const app = await buildApp({
    config: loadConfig({
      RIVER_LOG_LEVEL: 'silent',
      RIVER_RATE_LIMIT_PER_MINUTE: '10000',
      RIVER_ATTACHMENT_DIR: join(tmpdir(), `river-blobs-${Math.random().toString(36).slice(2)}`),
    }),
    database,
  });
  return { app, database };
}

/** Registers an account with one device; returns its identity and a session token. */
export async function registerUser(
  a: FastifyInstance,
  options: { signupCode?: string } = {},
): Promise<{
  riverId: string;
  token: string;
  identity: IdentityKeys;
  device: ReturnType<typeof generateKeyPair>;
}> {
  const identity = createIdentity();
  const device = generateKeyPair();
  const listBytes = Buffer.from(
    JSON.stringify({
      version: 1,
      riverId: identity.riverId,
      devices: [
        {
          deviceId: 1,
          authKey: b64(device.publicKey),
          registrationId: identity.registrationId,
          addedAt: new Date().toISOString(),
        },
      ],
    }),
  );
  const chal = Buffer.from(
    challengeResponseSchema.parse(
      (
        await a.inject({ method: 'POST', url: '/v1/auth/challenge', payload: { purpose: 'register' } })
      ).json(),
    ).challenge,
    'base64',
  );
  const msg = registrationMessage(chal, listBytes);
  const res = await a.inject({
    method: 'POST',
    url: '/v1/accounts',
    payload: {
      identityKey: b64(identity.publicKey),
      deviceId: 1,
      deviceList: b64(listBytes),
      deviceListSignature: b64(sign(identity.privateKey, deviceListMessage(listBytes))),
      challenge: b64(chal),
      identitySignature: b64(sign(identity.privateKey, msg)),
      deviceSignature: b64(sign(device.privateKey, msg)),
      ...(options.signupCode ? { signupCode: options.signupCode } : {}),
    },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  return {
    riverId: identity.riverId,
    token: registerResponseSchema.parse(res.json()).session.token,
    identity,
    device,
  };
}
