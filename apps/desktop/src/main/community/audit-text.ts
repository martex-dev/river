import type { AuditEntry } from '@river/protocol';
import type { AuditView, CommunityView } from '../../shared/ipc.ts';
import { msg, translate, translatePlural, type Language, type Vars } from '../../shared/i18n/index.ts';

/**
 * Turns an audit entry (IDs and numbers from the server) into a sentence,
 * using the names this device can decrypt. Unknown IDs stay generic.
 * Each sentence is written whole in every language (no English pieces glued on).
 */
export function describeAudit(
  e: AuditEntry,
  community: CommunityView,
  knownName: (riverId: string) => string | undefined,
  /** River's language (English by default). */
  lang: Language = 'en',
): AuditView {
  const t = (text: string, vars?: Vars): string => translate(lang, text, vars);
  const tn = (key: string, count: number, vars?: Vars): string => translatePlural(lang, key, count, vars);
  const person = (id: string | null): string =>
    (id && (community.members.find((m) => m.riverId === id)?.name ?? knownName(id))) ?? t('someone');
  const role = (id: string | null): string =>
    community.roles.find((r) => r.id === id)?.name ?? t('a role that was deleted');
  const channel = (id: string | null): string => {
    const ch = community.channels.find((c) => c.id === id);
    return ch ? (ch.kind === 'text' ? `#${ch.name}` : ch.name) : t('a channel');
  };
  const category = (id: string | null): string =>
    community.categories.find((k) => k.id === id)?.name ?? t('a category');
  const roles = (ids: unknown): string =>
    Array.isArray(ids) ? ids.map((id) => role(String(id))).join(', ') : '';
  const changes = (d: Record<string, unknown>, labels: Record<string, string>): string => {
    const what = Object.keys(labels)
      .filter((k) => d[k] !== undefined)
      .map((k) => t(labels[k]!));
    return what.length ? ` (${what.join(', ')})` : '';
  };
  const d = e.details;
  const target = e.target;
  const when = (): string => (typeof d.until === 'string' ? new Date(d.until).toLocaleString() : t('later'));
  const inChannel = (): string => channel(typeof d.channelId === 'string' ? d.channelId : null);
  const summary = ((): string => {
    switch (e.action) {
      case 'event.create':
        return t('planned an event');
      case 'event.update':
        return t('changed an event');
      case 'event.cancel':
        return t('cancelled an event');
      case 'event.delete':
        return t('deleted an event');
      case 'emoji.create':
        return t('added a custom emoji');
      case 'report.resolved':
        return t('resolved a report about {name}', { name: person(target) });
      case 'report.dismissed':
        return t('dismissed a report about {name}', { name: person(target) });
      case 'report.open':
        return t('reopened a report about {name}', { name: person(target) });
      case 'sticker.create':
        return t('added a sticker');
      case 'sticker.delete':
        return t('removed a sticker');
      case 'sound.create':
        return t('added a soundboard sound');
      case 'sound.update':
        return t('changed a soundboard sound');
      case 'sound.delete':
        return t('removed a soundboard sound');
      case 'emoji.update':
        return t('renamed a custom emoji');
      case 'emoji.delete':
        return t('removed a custom emoji');
      case 'member.join':
        return t('joined the community');
      case 'member.leave':
        return t('left the community');
      case 'message.purge': {
        const n = Number(d.count ?? 0);
        return tn('deleted {count} messages by {name}', n, { name: person(target) });
      }
      case 'member.tempban':
        return t("made {name}'s ban end {when}", { name: person(target), when: when() });
      case 'note.create':
        return t('added a moderator note about {name}', { name: person(target) });
      case 'note.delete':
        return t('removed a moderator note about {name}', { name: person(target) });
      case 'community.onboarding':
        return d.screening
          ? t('changed the rules (new members must accept them)')
          : t('changed the rules and onboarding');
      case 'member.selfRoles':
        return t('picked their roles');
      case 'message.bulkDelete': {
        const n = Number(d.count ?? 0);
        return tn('deleted {count} messages in {channel}', n, { channel: inChannel() });
      }
      case 'member.tempRole':
        return t('gave {name} {role} for a while', {
          name: person(target),
          role: role(typeof d.role === 'string' ? d.role : null),
        });
      case 'voice.move':
        return t('moved someone to another voice channel');
      case 'webhook.create':
        return t('made a webhook');
      case 'webhook.revoke':
        return t('deleted a webhook');
      case 'invite.revoke':
        return t('revoked an invite');
      case 'member.kick':
        return t('kicked {name}', { name: person(target) });
      case 'member.ban':
        return t('banned {name}', { name: person(target) });
      case 'member.unban':
        return t('unbanned {name}', { name: person(target) });
      case 'member.timeout':
        return t('timed out {name} until {when}', { name: person(target), when: when() });
      case 'member.timeout.end':
        return t('ended the timeout of {name}', { name: person(target) });
      case 'member.roles': {
        const added = roles(d.added);
        const removed = roles(d.removed);
        const name = person(target);
        if (added && removed) return t('gave {name} {added} and removed {removed}', { name, added, removed });
        if (added) return t('gave {name} {added}', { name, added });
        if (removed) return t('removed {removed} from {name}', { name, removed });
        return t('changed the roles of {name}', { name });
      }
      case 'role.create':
        return t('created the role {role}', { role: role(target) });
      case 'role.update':
        return (
          t('changed the role {role}', { role: role(target) }) +
          changes(d, {
            name: msg('name'),
            color: msg('colour'),
            before: msg('permissions'),
            position: msg('position'),
          })
        );
      case 'role.delete':
        return t('deleted a role');
      case 'role.reorder':
        return t('rearranged the roles');
      case 'channel.create':
        return t('created {channel}', { channel: channel(target) });
      case 'channel.update':
        return (
          t('changed {channel}', { channel: channel(target) }) +
          changes(d, {
            name: msg('name'),
            overwrites: msg('permissions'),
            parentId: msg('category'),
            position: msg('order'),
            synced: msg('permission sync'),
          })
        );
      case 'channel.delete':
        return t('deleted a channel');
      case 'category.create':
        return t('created the category {category}', { category: category(target) });
      case 'category.update':
        return (
          t('changed the category {category}', { category: category(target) }) +
          changes(d, { name: msg('name'), overwrites: msg('permissions') })
        );
      case 'category.delete':
        return t('deleted a category');
      case 'channels.reorder':
        return t('rearranged the channel list');
      case 'invite.create':
        return t('created an invite link');
      case 'message.delete':
        return t('deleted a message by {name} in {channel}', { name: person(target), channel: inChannel() });
      case 'community.update':
        return t("changed the community's name, icon or description");
      default:
        return e.action;
    }
  })();
  return { id: e.id, actor: e.actor, actorName: person(e.actor), action: e.action, summary, at: e.at };
}
