/**
 * A small, dependency-free syntax highlighter for code blocks (1.0.17).
 * It recognises comments, strings, numbers and keywords well enough for chat;
 * output is a list of typed spans rendered as React text (never HTML).
 */
export type TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'plain';
export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS: Record<string, string[]> = {
  js: 'const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of null undefined true false this super yield interface type enum implements public private protected readonly static'.split(
    ' ',
  ),
  py: 'def return if elif else for while break continue class import from as with try except finally raise lambda yield pass None True False and or not in is global nonlocal async await self'.split(
    ' ',
  ),
  rs: 'fn let mut pub struct enum impl trait use mod crate self Self match if else for while loop return break continue as ref move async await dyn where true false const static unsafe'.split(
    ' ',
  ),
  go: 'func package import var const type struct interface map chan go defer return if else for range switch case break continue nil true false select'.split(
    ' ',
  ),
  c: 'int char float double void long short unsigned signed struct union enum typedef static const return if else for while do switch case break continue sizeof include define class public private protected template namespace using new delete true false nullptr auto'.split(
    ' ',
  ),
  sh: 'if then else elif fi for in do done case esac while function return export local echo cd'.split(' '),
  sql: 'select from where insert into values update set delete create table drop alter join left right inner outer on group by order having limit as and or not null primary key'.split(
    ' ',
  ),
};

const ALIASES: Record<string, string> = {
  javascript: 'js',
  typescript: 'js',
  ts: 'js',
  tsx: 'js',
  jsx: 'js',
  json: 'js',
  python: 'py',
  rust: 'rs',
  golang: 'go',
  cpp: 'c',
  'c++': 'c',
  cs: 'c',
  csharp: 'c',
  java: 'c',
  kotlin: 'c',
  swift: 'c',
  bash: 'sh',
  shell: 'sh',
  zsh: 'sh',
  powershell: 'sh',
  ps1: 'sh',
};

export function languageOf(tag: string): string | null {
  const t = tag.toLowerCase();
  const key = ALIASES[t] ?? t;
  return KEYWORDS[key] ? key : null;
}

export function highlight(code: string, lang: string | null): Token[] {
  if (!lang) return [{ kind: 'plain', text: code }];
  const keywords = new Set(KEYWORDS[lang]);
  const lineComment = lang === 'py' || lang === 'sh' ? '#' : lang === 'sql' ? '--' : '//';
  const blockComments = lang !== 'py' && lang !== 'sh' && lang !== 'sql';
  const out: Token[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain) out.push({ kind: 'plain', text: plain });
    plain = '';
  };
  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);
    let m: RegExpMatchArray | null = null;
    if (rest.startsWith(lineComment)) {
      const end = code.indexOf('\n', i);
      flush();
      const text = code.slice(i, end < 0 ? code.length : end);
      out.push({ kind: 'comment', text });
      i += text.length;
    } else if (blockComments && rest.startsWith('/*')) {
      const end = code.indexOf('*/', i + 2);
      flush();
      const text = code.slice(i, end < 0 ? code.length : end + 2);
      out.push({ kind: 'comment', text });
      i += text.length;
    } else if ((m = rest.match(/^("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?)/))) {
      flush();
      out.push({ kind: 'string', text: m[0] });
      i += m[0].length;
    } else if ((m = rest.match(/^\d[\d_]*(\.\d+)?([eE][+-]?\d+)?/)) && !/[\w$]/.test(code[i - 1] ?? ' ')) {
      flush();
      out.push({ kind: 'number', text: m[0] });
      i += m[0].length;
    } else if ((m = rest.match(/^[A-Za-z_$][\w$]*/))) {
      const word = m[0];
      if (keywords.has(lang === 'sql' ? word.toLowerCase() : word)) {
        flush();
        out.push({ kind: 'keyword', text: word });
      } else plain += word;
      i += word.length;
    } else {
      plain += code[i];
      i += 1;
    }
  }
  flush();
  return out;
}
