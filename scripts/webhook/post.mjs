#!/usr/bin/env node
/**
 * Post to a River channel through an incoming webhook (ADR 0004).
 *
 *   node scripts/webhook/post.mjs "<webhook address>" "Build #42 passed"
 *
 * The address is shown once when the webhook is made. Everything after "#"
 * (the token and the key) stays on this machine: the post is sealed here with
 * AES-256-GCM, exactly like messages written in River, and the server only
 * receives ciphertext. Needs Node 20+; no dependencies.
 */
import { createCipheriv, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/** Splits a webhook address into where to post and the secrets after "#". */
export function parseAddress(address) {
  const url = new URL(address);
  const params = new URLSearchParams(url.hash.slice(1));
  const secret = {
    communityId: params.get('c') ?? '',
    channelId: params.get('ch') ?? '',
    token: params.get('t') ?? '',
    key: Buffer.from(params.get('k') ?? '', 'base64url'),
  };
  if (!secret.communityId || !secret.channelId || !secret.token || secret.key.length !== 32)
    throw new Error('This is not a complete River webhook address.');
  url.hash = '';
  return { endpoint: url.toString(), ...secret };
}

/** Seals { text } for the channel: base64(nonce ‖ ciphertext ‖ tag), AAD binds community and channel. */
export function sealPost({ communityId, channelId, key }, text) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`river-community-v1|${communityId}|message:${channelId}`, 'utf8'));
  const ct = Buffer.concat([
    cipher.update(JSON.stringify({ text: String(text).slice(0, 4000) }), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]).toString('base64');
}

export async function post(address, text) {
  const hook = parseAddress(address);
  const res = await fetch(hook.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${hook.token}` },
    body: JSON.stringify({ id: randomBytes(16).toString('base64url'), body: sealPost(hook, text) }),
  });
  if (!res.ok) throw new Error(`River answered ${res.status}: ${await res.text()}`);
  return res.json();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [address, ...words] = process.argv.slice(2);
  if (!address || !words.length) {
    console.error('Usage: node scripts/webhook/post.mjs "<webhook address>" "message text"');
    process.exit(2);
  }
  post(address, words.join(' ')).then(
    () => console.log('Posted.'),
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}
