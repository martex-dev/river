import { Permission, TIMEOUT_DENIES } from '@river/protocol/permissions';

/**
 * "Why can (or can't) this person do that here?" (1.0.26). Follows the same
 * order the server uses: owner → @everyone and roles → administrator →
 * channel @everyone override → role overrides (deny, then allow) → timeout
 * → rules not accepted → announcement channels. Pure, so it is tested.
 */
export interface ExplainRole {
  id: string;
  name: string;
  permissions: number;
}

export interface ExplainInput {
  ownerId: string;
  everyoneRoleId: string;
  roles: ExplainRole[];
  member: { riverId: string; roles: string[]; timedOut?: boolean; pending?: boolean };
  channel?: {
    name: string;
    overwrites: Array<{ roleId: string; allow: number; deny: number }>;
    announcement?: boolean;
  };
}

export interface Explanation {
  allowed: boolean;
  /** Plain-language steps that decided it, in order; the last one is the final word. */
  because: string[];
}

export function explainPermission(input: ExplainInput, bit: number): Explanation {
  const { member, roles } = input;
  if (member.riverId === input.ownerId)
    return { allowed: true, because: ['They own the community: owners can do everything.'] };
  const byId = new Map(roles.map((r) => [r.id, r]));
  const name = (id: string): string =>
    id === input.everyoneRoleId ? '@everyone' : (byId.get(id)?.name ?? 'a role');
  const because: string[] = [];
  const everyone = byId.get(input.everyoneRoleId);
  let allowed = !!((everyone?.permissions ?? 0) & bit);
  because.push(`@everyone ${allowed ? 'allows' : 'does not allow'} it.`);
  const granting = member.roles.filter((id) => ((byId.get(id)?.permissions ?? 0) & bit) !== 0);
  if (!allowed && granting.length) {
    allowed = true;
    because.push(`Their role ${granting.map(name).join(', ')} allows it.`);
  }
  const admin = member.roles.find(
    (id) => ((byId.get(id)?.permissions ?? 0) & Permission.ADMINISTRATOR) !== 0,
  );
  if (admin || ((everyone?.permissions ?? 0) & Permission.ADMINISTRATOR) !== 0) {
    return {
      allowed: true,
      because: [
        ...because,
        `${admin ? `Their role ${name(admin)}` : '@everyone'} has Administrator, which allows everything.`,
      ],
    };
  }
  const ch = input.channel;
  if (ch) {
    const ow = ch.overwrites.find((o) => o.roleId === input.everyoneRoleId);
    if (ow && ow.deny & bit) {
      allowed = false;
      because.push(`In #${ch.name}, @everyone is denied it.`);
    }
    if (ow && ow.allow & bit) {
      allowed = true;
      because.push(`In #${ch.name}, @everyone is allowed it.`);
    }
    const mine = ch.overwrites.filter(
      (o) => o.roleId !== input.everyoneRoleId && member.roles.includes(o.roleId),
    );
    const denying = mine.filter((o) => o.deny & bit);
    const allowing = mine.filter((o) => o.allow & bit);
    if (denying.length && !allowing.length) {
      allowed = false;
      because.push(
        `In #${ch.name}, their role ${denying.map((o) => name(o.roleId)).join(', ')} is denied it.`,
      );
    }
    if (allowing.length) {
      allowed = true;
      because.push(
        `In #${ch.name}, their role ${allowing.map((o) => name(o.roleId)).join(', ')} is allowed it${
          denying.length ? ' (an allow on a role beats a deny on another)' : ''
        }.`,
      );
    }
  }
  if (member.pending && allowed && bit !== Permission.VIEW_CHANNELS) {
    allowed = false;
    because.push('They have not accepted the rules yet, so they can only read.');
  }
  if (member.timedOut && allowed && bit & TIMEOUT_DENIES) {
    allowed = false;
    because.push('They are timed out.');
  }
  if (ch?.announcement && bit === Permission.SEND_MESSAGES && allowed) {
    const manages =
      ((everyone?.permissions ?? 0) |
        member.roles.reduce((p, id) => p | (byId.get(id)?.permissions ?? 0), 0)) &
      Permission.MANAGE_MESSAGES;
    if (!manages) {
      allowed = false;
      because.push(`#${ch.name} is an announcement channel: only people who manage messages post there.`);
    }
  }
  return { allowed, because };
}
