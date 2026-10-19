import { msg } from '../../../shared/i18n/index.ts';
/**
 * Built-in slash commands (1.0.25). Pure: parsing and text commands here;
 * the composer runs the ones that act (poll, nick, status, mute).
 */
export interface SlashCommand {
  name: string;
  args: string;
  help: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'shrug', args: '[message]', help: msg('Adds ¯\\_(ツ)_/¯') },
  { name: 'tableflip', args: '[message]', help: msg('Adds (╯°□°)╯︵ ┻━┻') },
  { name: 'unflip', args: '[message]', help: msg('Adds ┬─┬ノ( º _ ºノ)') },
  { name: 'lenny', args: '[message]', help: msg('Adds ( ͡° ͜ʖ ͡°)') },
  { name: 'me', args: 'action', help: msg('Shows your message as an action') },
  { name: 'spoiler', args: 'message', help: msg('Hides your message until clicked') },
  { name: 'poll', args: '', help: msg('Starts a poll') },
  { name: 'nick', args: '[nickname]', help: msg('Changes your nickname here (empty: back to your name)') },
  { name: 'status', args: '[text]', help: msg('Sets your custom status (empty: clears it)') },
  { name: 'online', args: '', help: msg('Shows you as Online') },
  { name: 'idle', args: '', help: msg('Shows you as Idle') },
  { name: 'dnd', args: '', help: msg('Do Not Disturb: no notifications or sounds') },
  { name: 'invisible', args: '', help: msg('Appear offline') },
  { name: 'mute', args: '[15m|1h|8h|24h]', help: msg('Mutes this channel (no length: until you unmute)') },
  { name: 'unmute', args: '', help: msg('Unmutes this channel') },
];

export interface ParsedSlash {
  command: string;
  arg: string;
}

/** A known command at the start of the text, or null (so "/r/subreddit" stays a message). */
export function parseSlash(text: string): ParsedSlash | null {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const command = m[1]!.toLowerCase();
  if (!SLASH_COMMANDS.some((c) => c.name === command)) return null;
  return { command, arg: (m[2] ?? '').trim() };
}

/** Commands that only change the text, or null if this command does something else. */
export function slashText(p: ParsedSlash): string | null {
  const add = (face: string): string => (p.arg ? `${p.arg} ${face}` : face);
  switch (p.command) {
    case 'shrug':
      return add('¯\\\\\\_(ツ)\\_/¯');
    case 'tableflip':
      return add('(╯°□°)╯︵ ┻━┻');
    case 'unflip':
      return add('┬─┬ノ( º _ ºノ)');
    case 'lenny':
      return add('( ͡° ͜ʖ ͡°)');
    case 'me':
      return p.arg ? `_${p.arg}_` : null;
    case 'spoiler':
      return p.arg ? `||${p.arg}||` : null;
    default:
      return null;
  }
}

/** Mute length from "15m", "1h", "8h", "24h"; null = until you unmute; undefined = not understood. */
export function muteLength(arg: string): number | null | undefined {
  if (!arg) return null;
  const m = /^(\d{1,3})\s*(m|min|h|hr|d)$/i.exec(arg.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  const ms = unit.startsWith('m') ? n * 60_000 : unit === 'd' ? n * 86_400_000 : n * 3_600_000;
  return ms > 0 && ms <= 30 * 86_400_000 ? ms : undefined;
}

/** Commands whose names start with what is typed after "/" (for the suggestion list). */
export function suggestCommands(typed: string): SlashCommand[] {
  const q = typed.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(q)).slice(0, 8);
}
