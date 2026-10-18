/**
 * A @username suggested from the name someone typed on the first screen (2.14), so claiming one
 * later is a single tap. It follows the server's rule (protocol `usernameSchema`): 3–32 of
 * a–z, 0–9, "_" and ".", not starting or ending with ".". Nothing is claimed by suggesting it.
 */

/** Bulgarian (and most other) Cyrillic letters, spelled the way Bulgaria's own law writes them. */
const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sht',
  ъ: 'a',
  ы: 'y',
  ь: 'y',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  є: 'ye',
  і: 'i',
  ї: 'yi',
  ґ: 'g',
};

const VALID = /^[a-z0-9_][a-z0-9_.]{1,30}[a-z0-9_]$/;

export function suggestUsername(name: string): string {
  const latin = [...name.trim().toLowerCase()].map((ch) => CYRILLIC[ch] ?? ch).join('');
  const plain = latin
    // é → e, ß stays out (it is dropped below), and so on.
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s-]+/g, '.')
    .replace(/[^a-z0-9_.]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 32)
    .replace(/\.+$/, '');
  return VALID.test(plain) ? plain : '';
}
