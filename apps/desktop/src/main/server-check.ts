import {
  API_PREFIX,
  checkCompatibility,
  versionResponseSchema,
  type Compatibility,
  type VersionResponse,
} from '@river/protocol';
import { serverUrlSchema } from '../shared/settings.ts';
import type { ServerCheckResult } from '../shared/ipc.ts';
import type { FetchBytes } from './http.ts';

const MAX_VERSION_BYTES = 16 * 1024;

const COMPATIBILITY_MESSAGE: Record<Compatibility, string> = {
  compatible: 'Compatible',
  'client-too-old': 'This server needs a newer version of River. Update River to use it.',
  'server-too-old': 'This server runs an older River protocol than this app supports.',
};

/**
 * Asks a River server for its version. Nothing about the user is sent — this
 * is an anonymous GET of a public endpoint.
 */
export async function checkServer(rawUrl: unknown, fetchBytes: FetchBytes): Promise<ServerCheckResult> {
  const parsedUrl = serverUrlSchema.safeParse(rawUrl);
  if (!parsedUrl.success) {
    return {
      ok: false,
      reason: 'invalid-url',
      message: parsedUrl.error.issues[0]?.message ?? 'Invalid address',
    };
  }
  const url = parsedUrl.data;

  let bytes: Uint8Array;
  try {
    bytes = await fetchBytes(`${url}${API_PREFIX}/version`, MAX_VERSION_BYTES);
  } catch (err) {
    const message = (err as Error).message ?? '';
    if (/too large/.test(message))
      return { ok: false, reason: 'not-river', message: 'That address is not a River server.' };
    if (/HTTP \d+/.test(message))
      return { ok: false, reason: 'not-river', message: 'That address is not a River server.' };
    return {
      ok: false,
      reason: 'unreachable',
      message: 'Could not reach the server. Check the address and your connection.',
    };
  }

  let info: VersionResponse;
  try {
    info = versionResponseSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
  } catch {
    return { ok: false, reason: 'not-river', message: 'That address is not a River server.' };
  }

  const compatibility = checkCompatibility(info.protocol);
  if (compatibility !== 'compatible') {
    return { ok: false, reason: 'incompatible', message: COMPATIBILITY_MESSAGE[compatibility] };
  }
  return { ok: true, url, version: info.version, protocol: info.protocol.current };
}
