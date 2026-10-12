import { describe, expect, it } from 'vitest';
import { auditText, filterAudit } from '../src/shared/audit-filter.ts';

const e = (id: string, actor: string, action: string, summary: string) => ({
  id,
  actor,
  actorName: actor.toUpperCase(),
  action,
  summary,
  at: `2026-10-1${id}T00:00:00Z`,
});
const all = [
  e('1', 'a', 'member.ban', 'banned Bob'),
  e('2', 'b', 'role.create', 'created a role'),
  e('3', 'a', 'channel.update', 'changed #general'),
];

describe('audit filter', () => {
  it('filters by kind, person and text', () => {
    expect(filterAudit(all, { group: 'moderation', actor: null, text: '' }).map((x) => x.id)).toEqual(['1']);
    expect(filterAudit(all, { group: null, actor: 'a', text: '' }).map((x) => x.id)).toEqual(['1', '3']);
    expect(filterAudit(all, { group: null, actor: null, text: 'general' }).map((x) => x.id)).toEqual(['3']);
  });
  it('copies as tab-separated lines', () => {
    expect(auditText([all[0]!])).toBe('2026-10-11T00:00:00Z\tA\tbanned Bob');
  });
});
