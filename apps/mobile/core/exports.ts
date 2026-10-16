import { ask } from './host.ts';

/**
 * Saving a file on iOS: the shell hands out a private path to write to, and
 * only once the file is written can it offer it in iOS's "Save to Files"
 * sheet. Whether it was saved is known when that sheet closes, so the write
 * of such a file waits for it: a cancelled export fails the save rather than
 * reporting it as saved. (Android asks where to save first and writes there.)
 */

const pending = new Set<string>();

/** The shell gave `path` for a save that it still has to offer. */
export function expectExport(path: string): void {
  pending.add(path);
}

/** After a file was written: offers it if it is an export, and fails unless it was saved. */
export async function finishExport(path: string): Promise<void> {
  if (!pending.delete(path)) return;
  const result = await ask<{ saved?: boolean } | null>('exportFile', { path });
  if (!result?.saved) throw new Error('The file was not saved.');
}
