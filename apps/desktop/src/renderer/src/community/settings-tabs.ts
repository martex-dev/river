import { Permission } from '@river/protocol/permissions';
import type { CommunityTab } from './store.ts';
import { msg } from '../../../shared/i18n/index.ts';

const can = (perms: number, p: number): boolean => (perms & p) === p;

/**
 * The tabs of Community settings and whether you see each one. Members, Emoji, Stickers and
 * Soundboard are open to everyone to look at; the rest are for running the community.
 */
export function communityTabs(perms: number): Array<[CommunityTab, string, boolean]> {
  return [
    ['overview', msg('Overview'), can(perms, Permission.MANAGE_COMMUNITY)],
    ['onboarding', msg('Rules & roles'), can(perms, Permission.MANAGE_COMMUNITY)],
    ['roles', msg('Roles'), can(perms, Permission.MANAGE_ROLES)],
    ['members', msg('Members'), true],
    ['emoji', msg('Emoji'), true],
    ['stickers', msg('Stickers'), true],
    ['sounds', msg('Soundboard'), true],
    ['bans', msg('Bans'), can(perms, Permission.BAN_MEMBERS)],
    ['invites', msg('Invites'), can(perms, Permission.MANAGE_COMMUNITY)],
    ['webhooks', msg('Webhooks'), can(perms, Permission.MANAGE_CHANNELS)],
    ['reports', msg('Reports'), can(perms, Permission.MANAGE_MESSAGES)],
    [
      'insights',
      msg('Insights'),
      can(perms, Permission.MANAGE_COMMUNITY) || can(perms, Permission.VIEW_AUDIT_LOG),
    ],
    ['audit', msg('Audit log'), can(perms, Permission.VIEW_AUDIT_LOG)],
  ];
}

/** Tabs everyone sees; they alone do not make "Community settings" worth offering. */
const EVERYONE: readonly CommunityTab[] = ['members', 'emoji', 'stickers', 'sounds'];

/**
 * Whether to offer "Community settings": some management tab is open to you, or you manage
 * members or expressions in the tabs everyone sees. One rule for every place that offers it.
 */
export function canOpenCommunitySettings(perms: number): boolean {
  return (
    communityTabs(perms).some(([id, , shown]) => shown && !EVERYONE.includes(id)) ||
    can(perms, Permission.KICK_MEMBERS) ||
    can(perms, Permission.MODERATE_MEMBERS) ||
    can(perms, Permission.MANAGE_EXPRESSIONS)
  );
}
