/**
 * Code signing changes the Windows installer's bytes, so what the auto-updater
 * checks — the sha512 and size in latest.yml — must be rewritten for the signed
 * file. electron-updater refuses an update whose checksum does not match.
 *
 * latest.yml as electron-builder writes it:
 *
 *   version: 1.0.43
 *   files:
 *     - url: River-Setup-1.0.43.exe
 *       sha512: <base64>
 *       size: 123456
 *   path: River-Setup-1.0.43.exe
 *   sha512: <base64>
 *   releaseDate: '2026-10-13T00:00:00.000Z'
 */
export function updateLatestYml(text: string, file: string, sha512: string, size: number): string {
  const unquote = (v: string): string => v.trim().replace(/^(['"])(.*)\1$/, '$2');
  const lines = text.split('\n');
  let inEntry = false;
  let found = false;
  let topLevelPath: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const url = /^(\s*)-\s+url:\s*(.+?)\s*$/.exec(line);
    if (url) {
      inEntry = unquote(url[2]!) === file;
      found ||= inEntry;
      continue;
    }
    if (/^\S/.test(line)) {
      inEntry = false;
      const path = /^path:\s*(.+?)\s*$/.exec(line);
      if (path) topLevelPath = unquote(path[1]!);
      if (/^sha512:/.test(line) && topLevelPath === file) lines[i] = `sha512: ${sha512}`;
      continue;
    }
    if (inEntry) {
      const field = /^(\s+)(sha512|size):/.exec(line);
      if (field) lines[i] = `${field[1]}${field[2]}: ${field[2] === 'sha512' ? sha512 : size}`;
    }
  }
  if (!found) throw new Error(`latest.yml does not list ${file}`);
  return lines.join('\n');
}
