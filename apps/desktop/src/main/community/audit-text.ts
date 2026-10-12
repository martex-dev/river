import type { AuditEntry } from '@river/protocol';
import type { AuditView, CommunityView } from '../../shared/ipc.ts';

/**
 * Turns an audit entry (IDs and numbers from the server) into a sentence,
 * using the names this device can decrypt. Unknown IDs stay generic.
 */
export function describeAudit(
  e: AuditEntry,
  community: CommunityView,
  knownName: (riverId: string) => string | undefined,
): AuditView {
  const person = (id: string | null): string =>
    (id && (community.members.find((m) => m.riverId === id)?.name ?? knownName(id))) ?? 'someone';
  const role = (id: string | null): string =>
    community.roles.find((r) => r.id === id)?.name ?? 'a role that was deleted';
  const channel = (id: string | null): string => {
    const ch = community.channels.find((c) => c.id === id);
    return ch ? (ch.kind === 'text' ? `#${ch.name}` : ch.name) : 'a channel';
  };
  const category = (id: string | null): string =>
    community.categories.find((k) => k.id === id)?.name ?? 'a category';
  const roles = (ids: unknown): string =>
    Array.isArray(ids) ? ids.map((id) => role(String(id))).join(', ') : '';
  const changes = (d: Record<string, unknown>, labels: Record<string, string>): string => {
    const what = Object.keys(labels)
      .filter((k) => d[k] !== undefined)
      .map((k) => labels[k]);
    return what.length ? ` (${what.join(', ')})` : '';
  };
  const d = e.details;
  const t = e.target;
  const summary = ((): string => {
    switch (e.action) {
      case 'event.create':
        return 'planned an event';
      case 'event.update':
        return 'changed an event';
      case 'event.cancel':
        return 'cancelled an event';
      case 'event.delete':
        return 'deleted an event';
      case 'emoji.create':
        return 'added a custom emoji';
      case 'report.resolved':
        return `resolved a report about ${person(t)}`;
      case 'report.dismissed':
        return `dismissed a report about ${person(t)}`;
      case 'report.open':
        return `reopened a report about ${person(t)}`;
      case 'sticker.create':
        return 'added a sticker';
      case 'sticker.delete':
        return 'removed a sticker';
      case 'sound.create':
        return 'added a soundboard sound';
      case 'sound.update':
        return 'changed a soundboard sound';
      case 'sound.delete':
        return 'removed a soundboard sound';
      case 'emoji.update':
        return 'renamed a custom emoji';
      case 'emoji.delete':
        return 'removed a custom emoji';
      case 'member.join':
        return 'joined the community';
      case 'member.leave':
        return 'left the community';
      case 'message.purge': {
        const n = Number(d.count ?? 0);
        return `deleted ${n} message${n === 1 ? '' : 's'} by ${person(t)}`;
      }
      case 'member.tempban':
        return `made ${person(t)}'s ban end ${typeof d.until === 'string' ? new Date(d.until).toLocaleString() : 'later'}`;
      case 'note.create':
        return `added a moderator note about ${person(t)}`;
      case 'note.delete':
        return `removed a moderator note about ${person(t)}`;
      case 'community.onboarding':
        return d.screening
          ? 'changed the rules (new members must accept them)'
          : 'changed the rules and onboarding';
      case 'member.selfRoles':
        return 'picked their roles';
      case 'message.bulkDelete': {
        const n = Number(d.count ?? 0);
        return `deleted ${n} message${n === 1 ? '' : 's'} in ${channel(typeof d.channelId === 'string' ? d.channelId : null)}`;
      }
      case 'member.tempRole':
        return `gave ${person(t)} ${role(typeof d.role === 'string' ? d.role : null)} for a while`;
      case 'invite.revoke':
        return 'revoked an invite';
      case 'member.kick':
        return `kicked ${person(t)}`;
      case 'member.ban':
        return `banned ${person(t)}`;
      case 'member.unban':
        return `unbanned ${person(t)}`;
      case 'member.timeout':
        return `timed out ${person(t)} until ${typeof d.until === 'string' ? new Date(d.until).toLocaleString() : 'later'}`;
      case 'member.timeout.end':
        return `ended the timeout of ${person(t)}`;
      case 'member.roles': {
        const added = roles(d.added);
        const removed = roles(d.removed);
        if (added && removed) return `gave ${person(t)} ${added} and removed ${removed}`;
        if (added) return `gave ${person(t)} ${added}`;
        if (removed) return `removed ${removed} from ${person(t)}`;
        return `changed the roles of ${person(t)}`;
      }
      case 'role.create':
        return `created the role ${role(t)}`;
      case 'role.update':
        return `changed the role ${role(t)}${changes(d, { name: 'name', color: 'colour', before: 'permissions', position: 'position' })}`;
      case 'role.delete':
        return 'deleted a role';
      case 'channel.create':
        return `created ${channel(t)}`;
      case 'channel.update':
        return `changed ${channel(t)}${changes(d, { name: 'name', overwrites: 'permissions', parentId: 'category', position: 'order', synced: 'permission sync' })}`;
      case 'channel.delete':
        return 'deleted a channel';
      case 'category.create':
        return `created the category ${category(t)}`;
      case 'category.update':
        return `changed the category ${category(t)}${changes(d, { name: 'name', overwrites: 'permissions' })}`;
      case 'category.delete':
        return 'deleted a category';
      case 'channels.reorder':
        return 'rearranged the channel list';
      case 'invite.create':
        return 'created an invite link';
      case 'message.delete':
        return `deleted a message by ${person(t)} in ${channel(typeof d.channelId === 'string' ? d.channelId : null)}`;
      case 'community.update':
        return "changed the community's name, icon or description";
      default:
        return e.action;
    }
  })();
  return { id: e.id, actor: e.actor, actorName: person(e.actor), action: e.action, summary, at: e.at };
}
