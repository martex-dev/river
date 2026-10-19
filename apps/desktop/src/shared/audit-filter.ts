import type { AuditView } from './ipc.ts';
import { msg } from './i18n/index.ts';

/** Groups of audit actions for the audit log's filter (1.0.24). */
export const AUDIT_GROUPS: Array<{ id: string; label: string; prefixes: string[] }> = [
  { id: 'members', label: msg('Members'), prefixes: ['member.', 'invite.'] },
  {
    id: 'moderation',
    label: msg('Moderation'),
    prefixes: [
      'member.kick',
      'member.ban',
      'member.unban',
      'member.timeout',
      'member.tempban',
      'message.',
      'report.',
      'note.',
    ],
  },
  { id: 'roles', label: msg('Roles'), prefixes: ['role.', 'member.roles', 'member.selfRoles'] },
  { id: 'channels', label: msg('Channels'), prefixes: ['channel.', 'category.', 'thread.'] },
  { id: 'community', label: msg('Community'), prefixes: ['community.'] },
  { id: 'expressions', label: msg('Emoji & sounds'), prefixes: ['emoji.', 'sound.'] },
  { id: 'events', label: msg('Events'), prefixes: ['event.'] },
];

export interface AuditFilter {
  group: string | null;
  actor: string | null;
  text: string;
}

export function filterAudit(entries: AuditView[], f: AuditFilter): AuditView[] {
  const group = AUDIT_GROUPS.find((g) => g.id === f.group);
  const q = f.text.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (!group || group.prefixes.some((p) => (e.action ?? '').startsWith(p))) &&
      (!f.actor || e.actor === f.actor) &&
      (!q || `${e.actorName} ${e.summary}`.toLowerCase().includes(q)),
  );
}

/** Plain text of the shown entries, one per line, for copying or saving. */
export function auditText(entries: AuditView[]): string {
  return entries.map((e) => `${e.at}\t${e.actorName}\t${e.summary}`).join('\n');
}
