import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What any River that ever ran on this phone leaves in its data folder: settings, the encrypted
 * storage and its key, attachments, saved files, downloaded updates, and the log every start
 * writes. Checked before this start writes anything.
 */
const RIVER_FILES = [
  'settings.json',
  'data',
  'logs',
  'attachments',
  'documents',
  'downloads',
  'updates',
] as const;

/**
 * A new install (2.11.2): nothing of River on this phone yet. Kept conservative, since a new
 * install turns Stay connected on by itself: any trace of an earlier River counts as an existing
 * install, which is asked instead. Call it before the logger creates `logs`.
 */
export function isFreshInstall(userData: string, exists: (path: string) => boolean = existsSync): boolean {
  return RIVER_FILES.every((name) => !exists(join(userData, name)));
}
