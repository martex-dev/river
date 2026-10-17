import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  API_PREFIX,
  DEFAULT_EVERYONE,
  Permission,
  channelIdSchema,
  clientEventSchema,
  communityIdSchema,
  createCategoryRequestSchema,
  createChannelRequestSchema,
  createThreadRequestSchema,
  createCommunityRequestSchema,
  createInviteRequestSchema,
  createRoleRequestSchema,
  editMessageRequestSchema,
  joinRequestSchema,
  layoutMoveRequestSchema,
  layoutRequestSchema,
  memberRolesRequestSchema,
  messageIdSchema,
  profileRequestSchema,
  reactRequestSchema,
  reactionTagSchema,
  riverIdSchema,
  roleIdSchema,
  roleOrderRequestSchema,
  rotateKeyRequestSchema,
  rotateKeyResponseSchema,
  sendMessageRequestSchema,
  timeoutRequestSchema,
  updateCategoryRequestSchema,
  createEventRequestSchema,
  transferOwnershipRequestSchema,
  createReportRequestSchema,
  createStickerRequestSchema,
  MAX_COMMUNITY_STICKERS,
  bulkDeleteRequestSchema,
  updateOnboardingRequestSchema,
  tempRoleRequestSchema,
  createWebhookRequestSchema,
  webhookPostRequestSchema,
  MAX_WEBHOOKS,
  updateArtRequestSchema,
  selfRolesRequestSchema,
  createNoteRequestSchema,
  MAX_NOTES_PER_MEMBER,
  createSoundRequestSchema,
  updateSoundRequestSchema,
  MAX_COMMUNITY_SOUNDS,
  SOUND_COOLDOWN_MS,
  banRequestSchema,
  MAX_BAN_DELETES,
  updateReportRequestSchema,
  MAX_OPEN_REPORTS,
  updateEmojiRequestSchema,
  createEmojiRequestSchema,
  MAX_COMMUNITY_EMOJI,
  updateEventRequestSchema,
  updateChannelRequestSchema,
  updateThreadRequestSchema,
  updateCommunityRequestSchema,
  updateRoleRequestSchema,
  type ServerEvent,
  type OverwriteWire,
  MAX_CALL_ROOM,
  RELAY_BURST,
  RELAY_FRAMES_PER_SECOND,
  decodeRelayOut,
  encodeRelayIn,
} from '@river/protocol';
import { authenticate, renewSession } from '../accounts/auth-store.ts';
import type { Hub, HubSocket } from '../communities/hub.ts';
import type { Transaction } from 'kysely';
import type { ChannelModel, CommunityModel } from '../communities/model.ts';
import type { Database } from '../db/schema.ts';
import { communityOfChannel, lastMessageTimes, loadCommunity, loadMessages } from '../communities/model.ts';
import type { ServerConfig } from '../config.ts';
import { HttpError } from '../http-error.ts';
import { linkAttachments } from './attachments.ts';
import type { RiverDatabase } from '../db/database.ts';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_MAX_USES = 100;
const MAX_CHANNELS = 100;
const MAX_ROLES = 100;
const MAX_CATEGORIES = 50;
const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
const PAGE = 100;
/** Realtime events per second a client may send on average, and the burst allowed. */
const SOCKET_RATE = 40;
/** Bytes queued for a slow connection beyond which relayed voice frames are dropped. */
const MAX_RELAY_BUFFER = 256 * 1024;
/** Different reactions one message may carry (joining an existing one is always possible). */
const MAX_REACTION_KINDS = 20;
/** Bytes queued for a connection that stopped reading beyond which it is closed (code 4408). */
const MAX_EVENT_BUFFER = 4 * 1024 * 1024;
/** Server → client WebSocket ping interval; two missed pongs close the connection. */
const HEARTBEAT_MS = 25_000;
/** A member whose last connection dropped is announced offline only after this long. */
const PRESENCE_GRACE_MS = 15_000;
const SOCKET_BURST = 400;
/** An open realtime connection's session is checked again this often (expiry, sign-out, suspension). */
const SESSION_RECHECK_MS = 5 * 60_000;
/** A claimed key epoch nobody else reports having in this long is asked for again (2.11). */
const ROTATION_ADOPT_MS = 10 * 60_000;
/** How often a rotation that reached nobody is asked for again before the server gives up. */
const ROTATION_MAX_RETRIES = 3;
/** Stuck rotations are looked for at most this often per process (2.11.2). */
const ROTATION_RECHECK_MS = 60_000;
/** How long the server remembers that a member used River (for stuck rotations). */
const ACTIVE_MEMORY_MS = 24 * 60 * 60_000;

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const day = (d: Date): string => d.toISOString().slice(0, 10);

const forbidden = (what = 'You do not have permission to do that'): HttpError =>
  new HttpError(403, 'forbidden', what);
const notFound = (): HttpError => new HttpError(404, 'not_found', 'Not found');
const bad = (msg = 'Bad request'): HttpError => new HttpError(400, 'bad_request', msg);

function parse<T>(
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw bad();
  return r.data;
}

/** Communities, roles, moderation, channels, messages, invites and the realtime socket. */
/** What the operator's admin routes reuse, so removals behave exactly like members' own. */
export interface CommunityOps {
  /** Removes someone from every community they are in (key rotation, voice, notifications). */
  removeEverywhere(riverId: string): Promise<void>;
  /** Deletes a community and tells its members. */
  deleteCommunity(communityId: string): Promise<boolean>;
}

/**
 * Overwrites that deny whatever either set denies (2.11.2): a role keeps `base`'s allowances only
 * where `extra` does not deny them.
 */
export function mergeDenials(
  base: readonly OverwriteWire[],
  extra: readonly OverwriteWire[],
): OverwriteWire[] {
  const out = new Map<string, OverwriteWire>();
  for (const o of base) out.set(o.roleId, { ...o });
  for (const o of extra) {
    const had = out.get(o.roleId);
    const deny = (had?.deny ?? 0) | o.deny;
    out.set(o.roleId, { roleId: o.roleId, allow: (had?.allow ?? 0) & ~deny, deny });
  }
  return [...out.values()];
}

export async function registerCommunityRoutes(
  app: FastifyInstance,
  deps: {
    config: ServerConfig;
    database: RiverDatabase;
    now: () => Date;
    hub: Hub;
    /** How often an open realtime connection's session is checked again (tests shorten it). */
    sessionRecheckMs?: number;
    /** How long a claimed key epoch may go unreported before it is asked for again (tests shorten it). */
    rotationAdoptMs?: number;
    /** How often stuck rotations are looked for at most (tests set 0). */
    rotationRecheckMs?: number;
    /** Bytes a connection may have queued before it is closed (tests lower it). */
    maxEventBuffer?: number;
  },
): Promise<CommunityOps> {
  const { db } = deps.database;
  const { hub } = deps;
  const sessionRecheckMs = deps.sessionRecheckMs ?? SESSION_RECHECK_MS;
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  /** When each member last made a request here, in memory only (ms). */
  const lastActive = new Map<string, number>();
  const requireSession = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = token ? await authenticate(db, token, deps.now()) : null;
    if (!session) {
      await reply.code(401).send({ error: { code: 'unauthorized', message: 'A valid session is required' } });
      return;
    }
    request.session = session;
    // When each member last used River here (in memory): a stuck key rotation is asked for again
    // only once someone else had a chance to receive it (see recheckRotations).
    lastActive.set(session.riverId, deps.now().getTime());
  };
  const authed = { preHandler: requireSession };
  const me = (r: FastifyRequest): string => r.session!.riverId;

  /** Loads a community the caller belongs to (404 otherwise). */
  const community = async (id: unknown, riverId: string): Promise<CommunityModel> => {
    const cid = parse(communityIdSchema, id);
    const model = await loadCommunity(db, cid);
    if (!model || !model.member(riverId)) throw notFound();
    return model;
  };
  const channelCommunity = async (
    channelId: unknown,
    riverId: string,
  ): Promise<{ model: CommunityModel; channelId: string }> => {
    const id = parse(channelIdSchema, channelId);
    const cid = await communityOfChannel(db, id);
    if (!cid) throw notFound();
    const model = await community(cid, riverId);
    if (!model.can(riverId, Permission.VIEW_CHANNELS, id)) throw notFound();
    return { model, channelId: id };
  };
  const messageContext = async (messageId: unknown, riverId: string) => {
    const id = parse(messageIdSchema, messageId);
    const msg = await db.selectFrom('messages').selectAll().where('id', '=', id).executeTakeFirst();
    if (!msg) throw notFound();
    const { model } = await channelCommunity(msg.channel_id, riverId);
    return { model, msg };
  };

  // ---- broadcasting --------------------------------------------------------------------------
  const toMembers = (model: CommunityModel, event: ServerEvent): void =>
    hub.sendTo(
      model.members.map((m) => m.riverId),
      event,
    );
  const changed = (model: CommunityModel): void =>
    toMembers(model, { t: 'community', communityId: model.id });
  /** Members a moderator just moved: they may join that channel once even if it is full (1.0.39). */
  const movePasses = new Map<string, { channelId: string; until: number }>();
  const voiceUpdate = async (communityId: string, channelId: string): Promise<void> => {
    const model = await loadCommunity(db, communityId);
    if (!model) return;
    hub.sendTo(model.viewers(channelId), {
      t: 'voice',
      communityId,
      channelId,
      participants: hub.participants(channelId),
      states: hub.statesOf(channelId),
    });
  };
  hub.onSeatExpired = (left) => void voiceUpdate(left.communityId, left.channelId).catch(() => undefined);
  const pushMessage = async (model: CommunityModel, messageId: string): Promise<void> => {
    const row = await db.selectFrom('messages').selectAll().where('id', '=', messageId).executeTakeFirst();
    if (!row) return;
    const [message] = await loadMessages(db, [row]);
    hub.sendTo(model.viewers(row.channel_id), { t: 'message', communityId: model.id, message: message! });
  };
  /**
   * Records an administrative action. Only IDs and numbers go in: the server
   * never has names or content. Entries older than 90 days are dropped.
   */
  const audit = async (
    communityId: string,
    actor: string,
    action: string,
    target: string | null,
    details: Record<string, unknown> = {},
  ): Promise<void> => {
    const at = deps.now();
    await db
      .insertInto('audit_log')
      .values({
        id: randomBytes(16).toString('base64url'),
        community_id: communityId,
        actor,
        action,
        target,
        details: JSON.stringify(details),
        created_at: at.toISOString(),
      })
      .execute();
    await db
      .deleteFrom('audit_log')
      .where('community_id', '=', communityId)
      .where('created_at', '<', new Date(at.getTime() - AUDIT_RETENTION_MS).toISOString())
      .execute();
  };

  const removeMember = async (
    model: CommunityModel,
    riverId: string,
    reason: 'kicked' | 'banned' | 'left',
    actor: string = riverId,
  ): Promise<void> => {
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('member_roles')
        .where('community_id', '=', model.id)
        .where('river_id', '=', riverId)
        .execute();
      await trx
        .deleteFrom('community_members')
        .where('community_id', '=', model.id)
        .where('river_id', '=', riverId)
        .execute();
      // The removed person still knows the current key: a member must replace it.
      await trx
        .updateTable('communities')
        .set({ rotation_needed: 1, rotation_retries: 0 })
        .where('id', '=', model.id)
        .execute();
    });
    if (hub.voiceChannelOf(riverId) && model.channel(hub.voiceChannelOf(riverId)!)) {
      const left = hub.leaveVoice(riverId);
      hub.sendTo([riverId], { t: 'voice.disconnect' });
      if (left) await voiceUpdate(left.communityId, left.channelId);
    }
    hub.sendTo([riverId], { t: 'removed', communityId: model.id, reason });
    await audit(
      model.id,
      actor,
      reason === 'left' ? 'member.leave' : `member.${reason === 'kicked' ? 'kick' : 'ban'}`,
      riverId,
    );
    changed(model);
  };

  /**
   * Channel and category overwrites may only allow what the actor holds there (`mine`) and never
   * Administrator, or managing channels would be a way to hand out any permission. Bits a role's
   * overwrite already allowed (`before`: an edit resends the unchanged ones) stay allowed.
   */
  const checkOverwrites = (
    model: CommunityModel,
    overwrites: readonly OverwriteWire[],
    mine: number,
    before: readonly OverwriteWire[] = [],
  ): void => {
    for (const o of overwrites) {
      if (!model.role(o.roleId)) throw bad('Unknown role');
      const had = before.find((b) => b.roleId === o.roleId)?.allow ?? 0;
      // Only newly adding Administrator is refused: a legacy overwrite that already allows it must
      // stay editable (the editor resends the existing allow bits unchanged).
      if (o.allow & ~had & Permission.ADMINISTRATOR) throw bad('Overwrites cannot grant Administrator');
      if ((o.allow & ~had & ~mine) !== 0) throw forbidden('You cannot grant permissions you do not have');
    }
  };

  /**
   * A synced channel leaving its category (category deleted, channel moved out or elsewhere)
   * keeps the permissions it had: the category's overwrites become its own and it stops being
   * synced. Without this a private category's channels would turn public the moment they leave.
   */
  const keepAccess = async (
    trx: Transaction<Database>,
    ch: ChannelModel,
    alsoDeny: readonly OverwriteWire[] = [],
  ): Promise<void> => {
    if (!ch.synced) return;
    await trx.deleteFrom('channel_overwrites').where('channel_id', '=', ch.id).execute();
    for (const o of mergeDenials(ch.overwrites, alsoDeny))
      await trx
        .insertInto('channel_overwrites')
        .values({ channel_id: ch.id, role_id: o.roleId, allow: o.allow, deny: o.deny })
        .execute();
    await trx.updateTable('channels').set({ synced: 0 }).where('id', '=', ch.id).execute();
  };

  /**
   * A channel moved to `parentId` (2.11.2). Leaving a category (for none, or another one) it keeps
   * the permissions it had (keepAccess). Moving into a category from none, it is synced to that
   * category, as older servers did: a channel moved into a private category must not keep its old
   * public overwrites (that failed open). `synced: false` in the request keeps its own instead.
   */
  const moved = async (
    trx: Transaction<Database>,
    ch: ChannelModel,
    parentId: string | null,
    synced?: boolean,
    into: readonly OverwriteWire[] = [],
  ): Promise<void> => {
    if (parentId === ch.parentId) return;
    if (ch.parentId !== null) {
      // From one category into another, a synced channel keeps the old category's denials and
      // takes the new one's too: neither a private old nor a private new category fails open.
      if (parentId !== null && ch.synced && synced !== false) return keepAccess(trx, ch, into);
      return keepAccess(trx, ch);
    }
    if (parentId === null || synced === false) return;
    await trx.updateTable('channels').set({ synced: 1 }).where('id', '=', ch.id).execute();
  };

  /** Ends everyone's seat in the given voice channels and tells them (channel or community deleted). */
  const endVoice = (channelIds: Iterable<string>): void => {
    for (const channelId of channelIds) {
      for (const id of hub.participants(channelId)) {
        hub.leaveVoice(id);
        hub.sendTo([id], { t: 'voice.disconnect' });
      }
    }
  };

  // ---- communities ---------------------------------------------------------------------------
  app.get(`${API_PREFIX}/communities`, authed, async (request) => {
    // Stuck rotations are noticed here too, not only by the minute timer.
    await recheckRotations().catch(() => undefined);
    const rows = await db
      .selectFrom('community_members')
      .select('community_id')
      .where('river_id', '=', me(request))
      .execute();
    const models = (await Promise.all(rows.map((r) => loadCommunity(db, r.community_id)))).filter(
      (m): m is CommunityModel => m !== null,
    );
    const last = await lastMessageTimes(
      db,
      models.flatMap((m) => m.channels.map((c) => c.id)),
    );
    return {
      communities: models.map((m) => m.wireFor(me(request), (id) => hub.visibleStatus(id), last)),
    };
  });

  app.post(`${API_PREFIX}/communities`, authed, async (request, reply) => {
    const req = parse(createCommunityRequestSchema, request.body);
    if (new Set(req.channels.map((c) => c.id)).size !== req.channels.length)
      throw bad('Duplicate channel IDs');
    const today = day(deps.now());
    try {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('communities')
          .values({ id: req.id, owner: me(request), meta: req.meta, created_on: today })
          .execute();
        await trx
          .insertInto('roles')
          .values({
            id: req.id,
            community_id: req.id,
            name: '',
            color: 0,
            permissions: DEFAULT_EVERYONE,
            position: 0,
          })
          .execute();
        await trx
          .insertInto('community_members')
          .values({
            community_id: req.id,
            river_id: me(request),
            role: 'owner',
            profile: req.profile,
            joined_on: today,
          })
          .execute();
        await trx
          .insertInto('channels')
          .values(
            req.channels.map((c, i) => ({
              id: c.id,
              community_id: req.id,
              kind: c.kind,
              name: c.name,
              position: i,
            })),
          )
          .execute();
      });
    } catch {
      throw new HttpError(409, 'conflict', 'Community or channel ID already exists');
    }
    const model = await loadCommunity(db, req.id);
    return reply.code(201).send(model!.wireFor(me(request), (id) => hub.visibleStatus(id)));
  });

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    if (!model.can(me(request), Permission.MANAGE_COMMUNITY)) throw forbidden();
    const req = parse(updateCommunityRequestSchema, request.body);
    await db.updateTable('communities').set({ meta: req.meta }).where('id', '=', model.id).execute();
    await audit(model.id, me(request), 'community.update', model.id);
    changed(model);
    return { ok: true };
  });

  // ---- onboarding (1.0.24) ----------------------------------------------------------------------
  /** Permissions a self-assignable role may not carry: nothing that moderates or manages. */
  const SELF_ROLE_FORBIDDEN =
    Permission.ADMINISTRATOR |
    Permission.MANAGE_COMMUNITY |
    Permission.MANAGE_CHANNELS |
    Permission.MANAGE_ROLES |
    Permission.MANAGE_MESSAGES |
    Permission.KICK_MEMBERS |
    Permission.BAN_MEMBERS |
    Permission.MUTE_MEMBERS |
    Permission.MOVE_MEMBERS |
    Permission.MODERATE_MEMBERS |
    Permission.VIEW_AUDIT_LOG |
    Permission.MENTION_EVERYONE |
    Permission.MANAGE_EVENTS |
    Permission.MANAGE_EXPRESSIONS;

  app.put<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/onboarding`,
    { ...authed, bodyLimit: 64 * 1024 },
    async (request) => {
      const model = await community(request.params.id, me(request));
      if (!model.can(me(request), Permission.MANAGE_COMMUNITY)) throw forbidden();
      const req = parse(updateOnboardingRequestSchema, request.body);
      const top = model.ownerId === me(request) ? Infinity : model.top(me(request));
      for (const id of req.selfRoles) {
        const role = model.role(id);
        if (!role || id === model.everyoneRoleId) throw bad('Unknown role');
        if (role.permissions & SELF_ROLE_FORBIDDEN)
          throw bad('Roles members give themselves cannot moderate or manage anything');
        if (role.position >= top) throw forbidden('You can only offer roles below your highest role');
      }
      await db
        .updateTable('communities')
        .set({
          onboarding: req.onboarding,
          screening: req.screening ? 1 : 0,
          self_roles: JSON.stringify([...new Set(req.selfRoles)]),
        })
        .where('id', '=', model.id)
        .execute();
      await audit(model.id, me(request), 'community.onboarding', model.id, {
        screening: req.screening,
        selfRoles: req.selfRoles.length,
      });
      changed(model);
      return { ok: true };
    },
  );

  app.put<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/art`,
    { ...authed, bodyLimit: 256 * 1024 },
    async (request) => {
      const model = await community(request.params.id, me(request));
      if (!model.can(me(request), Permission.MANAGE_COMMUNITY)) throw forbidden();
      const req = parse(updateArtRequestSchema, request.body);
      await db.updateTable('communities').set({ art: req.art }).where('id', '=', model.id).execute();
      await audit(model.id, me(request), 'community.art', model.id);
      changed(model);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string; member: string } }>(
    `${API_PREFIX}/communities/:id/members/:member/temp-role`,
    authed,
    async (request) => {
      const model = await community(request.params.id, me(request));
      const target = parse(riverIdSchema, request.params.member);
      if (!model.member(target)) throw notFound();
      if (!model.can(me(request), Permission.MANAGE_ROLES)) throw forbidden();
      const req = parse(tempRoleRequestSchema, request.body);
      const role = model.role(req.roleId);
      if (!role || role.id === model.everyoneRoleId) throw bad('Unknown role');
      const top = model.ownerId === me(request) ? Infinity : model.top(me(request));
      if (role.position >= top) throw forbidden('You can only give roles below your highest role');
      if (target !== me(request) && !model.outranks(me(request), target) && model.ownerId !== me(request))
        throw forbidden('You can only change roles of members below you');
      const expiresAt = new Date(deps.now().getTime() + req.seconds * 1000).toISOString();
      await db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom('member_roles')
          .where('community_id', '=', model.id)
          .where('river_id', '=', target)
          .where('role_id', '=', role.id)
          .execute();
        await trx
          .insertInto('member_roles')
          .values({ community_id: model.id, river_id: target, role_id: role.id, expires_at: expiresAt })
          .execute();
      });
      await audit(model.id, me(request), 'member.tempRole', target, { role: role.id, until: expiresAt });
      changed(model);
      return { ok: true, expiresAt };
    },
  );

  app.post<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/accept`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    await db
      .updateTable('community_members')
      .set({ accepted: 1 })
      .where('community_id', '=', model.id)
      .where('river_id', '=', me(request))
      .execute();
    changed(model);
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/self-roles`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    if (model.pending(me(request))) throw forbidden('Accept the rules first');
    const req = parse(selfRolesRequestSchema, request.body);
    if (req.roles.some((id) => !model.selfRoles.includes(id)))
      throw forbidden('That role is not self-assignable');
    // Checked again here: a role may have been given more permissions after it was offered.
    for (const id of req.roles) {
      const role = model.role(id);
      if (!role || id === model.everyoneRoleId) throw bad('Unknown role');
      if (role.permissions & SELF_ROLE_FORBIDDEN) throw forbidden('That role is not self-assignable');
    }
    const current = model.member(me(request))!.roles;
    // Keep every role that is not self-assignable; set the self-assignable ones to the choice.
    const next = [...new Set([...current.filter((id) => !model.selfRoles.includes(id)), ...req.roles])];
    const nowIso = deps.now().toISOString();
    await db.transaction().execute(async (trx) => {
      // A temporary role still held keeps its end time; a run-out row is not carried over.
      const expiry = new Map(
        (
          await trx
            .selectFrom('member_roles')
            .select(['role_id', 'expires_at'])
            .where('community_id', '=', model.id)
            .where('river_id', '=', me(request))
            .where('expires_at', '>', nowIso)
            .execute()
        )
          .filter((r) => current.includes(r.role_id))
          .map((r) => [r.role_id, r.expires_at ?? null]),
      );
      await trx
        .deleteFrom('member_roles')
        .where('community_id', '=', model.id)
        .where('river_id', '=', me(request))
        .execute();
      for (const id of next)
        await trx
          .insertInto('member_roles')
          .values({
            community_id: model.id,
            river_id: me(request),
            role_id: id,
            expires_at: expiry.get(id) ?? null,
          })
          .execute();
    });
    await audit(model.id, me(request), 'member.selfRoles', me(request), { roles: req.roles });
    changed(model);
    return { ok: true };
  });

  const deleteCommunity = async (model: CommunityModel): Promise<void> => {
    // Nobody stays in a voice channel of a community that no longer exists.
    endVoice(hub.rooms(model.id).map((r) => r.channelId));
    for (const m of model.members)
      hub.sendTo([m.riverId], { t: 'removed', communityId: model.id, reason: 'deleted' });
    await db.deleteFrom('communities').where('id', '=', model.id).execute();
  };

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    if (model.ownerId !== me(request)) throw forbidden('Only the owner can delete the community');
    await deleteCommunity(model);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/leave`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    if (model.ownerId === me(request)) throw bad('The owner cannot leave; delete the community instead');
    await removeMember(model, me(request), 'left');
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/profile`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    const req = parse(profileRequestSchema, request.body);
    await db
      .updateTable('community_members')
      .set({ profile: req.profile })
      .where('community_id', '=', model.id)
      .where('river_id', '=', me(request))
      .execute();
    const m = model.member(me(request))!;
    toMembers(model, {
      t: 'member',
      communityId: model.id,
      member: {
        riverId: m.riverId,
        role: m.legacyRole,
        roles: m.roles,
        profile: req.profile,
        online: true,
        timeoutUntil: model.timedOut(m.riverId) ? m.timeoutUntil : null,
        ...(/^\d{4}-\d{2}-\d{2}$/.test(m.joinedOn) ? { joinedOn: m.joinedOn } : {}),
      },
    });
    return { ok: true };
  });

  // ---- channels --------------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/channels`,
    authed,
    async (request, reply) => {
      const model = await community(request.params.id, me(request));
      if (!model.can(me(request), Permission.MANAGE_CHANNELS)) throw forbidden();
      const req = parse(createChannelRequestSchema, request.body);
      if (model.channels.length >= MAX_CHANNELS) throw bad('Too many channels');
      if (req.parentId && !model.category(req.parentId)) throw bad('Unknown category');
      const parentId = req.parentId ?? null;
      // A new channel in a category may copy the category's overwrites.
      checkOverwrites(
        model,
        req.overwrites ?? [],
        parentId ? model.categoryPerms(me(request), parentId) : model.perms(me(request)),
        parentId ? model.category(parentId)!.overwrites : [],
      );
      const position = model.channels.length;
      try {
        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto('channels')
            .values({
              id: req.id,
              community_id: model.id,
              kind: req.kind,
              name: req.name,
              position,
              parent_id: parentId,
              synced: parentId && !req.overwrites?.length ? 1 : 0,
              forum: req.forum && req.kind === 'text' ? 1 : 0,
              stage: req.stage && req.kind === 'voice' ? 1 : 0,
            })
            .execute();
          for (const o of req.overwrites ?? []) {
            if (!model.role(o.roleId)) throw bad('Unknown role');
            await trx
              .insertInto('channel_overwrites')
              .values({ channel_id: req.id, role_id: o.roleId, allow: o.allow, deny: o.deny })
              .execute();
          }
        });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(409, 'conflict', 'Channel ID already exists');
      }
      await audit(model.id, me(request), 'channel.create', req.id, { kind: req.kind, parentId });
      changed(model);
      return reply.code(201).send({
        id: req.id,
        kind: req.kind,
        name: req.name,
        position,
        overwrites: req.overwrites ?? [],
        parentId,
      });
    },
  );

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/channels/:id`, authed, async (request) => {
    const { model, channelId } = await channelCommunity(request.params.id, me(request));
    if (!model.can(me(request), Permission.MANAGE_CHANNELS, channelId)) throw forbidden();
    const req = parse(updateChannelRequestSchema, request.body);
    if (req.parentId && !model.category(req.parentId)) throw bad('Unknown category');
    if (req.overwrites) {
      checkOverwrites(
        model,
        req.overwrites,
        model.perms(me(request), channelId),
        model.channel(channelId)!.overwrites,
      );
    }
    // Editing a channel's own permissions unsyncs it from its category; synced: true syncs it again.
    const synced = req.synced !== undefined ? req.synced : req.overwrites ? false : undefined;
    const current = model.channel(channelId)!;
    await db.transaction().execute(async (trx) => {
      // Moved into a category: synced to it (unless synced: false). Out of one: keeps its access.
      if (req.parentId !== undefined && synced !== true)
        await moved(
          trx,
          current,
          req.parentId,
          synced,
          req.parentId ? model.category(req.parentId)?.overwrites : [],
        );
      if (synced !== undefined) {
        await trx
          .updateTable('channels')
          .set({ synced: synced ? 1 : 0 })
          .where('id', '=', channelId)
          .execute();
      }
      if (
        req.name !== undefined ||
        req.position !== undefined ||
        req.parentId !== undefined ||
        req.announcement !== undefined ||
        req.slowmode !== undefined ||
        req.userLimit !== undefined ||
        req.forum !== undefined ||
        req.stage !== undefined
      ) {
        await trx
          .updateTable('channels')
          .set({
            ...(req.name !== undefined ? { name: req.name } : {}),
            ...(req.position !== undefined ? { position: req.position } : {}),
            ...(req.parentId !== undefined ? { parent_id: req.parentId } : {}),
            ...(req.announcement !== undefined ? { announcement: req.announcement ? 1 : 0 } : {}),
            ...(req.slowmode !== undefined ? { slowmode: req.slowmode } : {}),
            ...(req.userLimit !== undefined ? { user_limit: req.userLimit } : {}),
            ...(req.forum !== undefined ? { forum: req.forum ? 1 : 0 } : {}),
            ...(req.stage !== undefined ? { stage: req.stage ? 1 : 0 } : {}),
          })
          .where('id', '=', channelId)
          .execute();
      }
      if (req.overwrites) {
        await trx.deleteFrom('channel_overwrites').where('channel_id', '=', channelId).execute();
        for (const o of req.overwrites) {
          if (!model.role(o.roleId)) throw bad('Unknown role');
          await trx
            .insertInto('channel_overwrites')
            .values({ channel_id: channelId, role_id: o.roleId, allow: o.allow, deny: o.deny })
            .execute();
        }
      }
    });
    await audit(model.id, me(request), 'channel.update', channelId, {
      ...(req.name !== undefined ? { name: true } : {}),
      ...(req.position !== undefined ? { position: req.position } : {}),
      ...(req.parentId !== undefined ? { parentId: req.parentId } : {}),
      ...(req.overwrites ? { overwrites: req.overwrites } : {}),
      ...(synced !== undefined ? { synced } : {}),
      ...(req.announcement !== undefined ? { announcement: req.announcement } : {}),
      ...(req.slowmode !== undefined ? { slowmode: req.slowmode } : {}),
      ...(req.userLimit !== undefined ? { userLimit: req.userLimit } : {}),
      ...(req.forum !== undefined ? { forum: req.forum } : {}),
      ...(req.stage !== undefined ? { stage: req.stage } : {}),
    });
    changed(model);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/channels/:id`, authed, async (request) => {
    const { model, channelId } = await channelCommunity(request.params.id, me(request));
    if (!model.can(me(request), Permission.MANAGE_CHANNELS, channelId)) throw forbidden();
    if (model.channels.length <= 1) throw bad('A community needs at least one channel');
    endVoice([channelId]);
    await db.transaction().execute(async (trx) => {
      // Its webhooks can never post again (their messages go with the channel).
      await trx.deleteFrom('webhooks').where('channel_id', '=', channelId).execute();
      await trx.deleteFrom('channels').where('id', '=', channelId).execute();
    });
    await audit(model.id, me(request), 'channel.delete', channelId);
    changed(model);
    return { ok: true };
  });

  // ---- scheduled events (1.0.18) --------------------------------------------------------------
  const MAX_EVENTS = 100;
  /** How long after it ends an event is still listed (as past). */
  const KEEP_PAST_MS = 7 * 24 * 3600_000;
  const eventsChanged = (model: CommunityModel): void =>
    toMembers(model, { t: 'events', communityId: model.id });

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/events`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    const since = new Date(deps.now().getTime() - KEEP_PAST_MS).toISOString();
    const rows = await db
      .selectFrom('community_events')
      .selectAll()
      .where('community_id', '=', model.id)
      .where('ends_at', '>=', since)
      .orderBy('starts_at')
      .execute();
    const rsvps = rows.length
      ? await db
          .selectFrom('community_event_rsvps')
          .selectAll()
          .where(
            'event_id',
            'in',
            rows.map((r) => r.id),
          )
          .execute()
      : [];
    return {
      events: rows
        // An event in a voice channel you cannot see stays hidden from you.
        .filter((r) => !r.channel_id || model.can(me(request), Permission.VIEW_CHANNELS, r.channel_id))
        .map((r) => ({
          id: r.id,
          communityId: r.community_id,
          createdBy: r.created_by,
          data: r.data,
          startsAt: r.starts_at,
          endsAt: r.ends_at,
          channelId: r.channel_id,
          canceled: r.canceled === 1,
          interested: rsvps.filter((x) => x.event_id === r.id).map((x) => x.river_id),
        })),
    };
  });

  const checkEventTimes = (startsAt: string, endsAt: string): void => {
    const start = Date.parse(startsAt);
    const end = Date.parse(endsAt);
    if (end <= start) throw bad('An event must end after it starts');
    if (end - start > 14 * 24 * 3600_000) throw bad('An event can last at most two weeks');
  };

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/events`,
    authed,
    async (request, reply) => {
      const model = await community(request.params.id, me(request));
      if (!model.can(me(request), Permission.MANAGE_EVENTS)) throw forbidden();
      const req = parse(createEventRequestSchema, request.body);
      checkEventTimes(req.startsAt, req.endsAt);
      if (Date.parse(req.endsAt) < deps.now().getTime()) throw bad('That event would already be over');
      if (req.channelId && model.channel(req.channelId)?.kind !== 'voice') throw bad('Unknown voice channel');
      const upcoming = await db
        .selectFrom('community_events')
        .select(db.fn.countAll<number>().as('n'))
        .where('community_id', '=', model.id)
        .where('ends_at', '>=', deps.now().toISOString())
        .executeTakeFirstOrThrow();
      if (Number(upcoming.n) >= MAX_EVENTS) throw bad('Too many upcoming events');
      try {
        await db
          .insertInto('community_events')
          .values({
            id: req.id,
            community_id: model.id,
            created_by: me(request),
            data: req.data,
            starts_at: new Date(req.startsAt).toISOString(),
            ends_at: new Date(req.endsAt).toISOString(),
            channel_id: req.channelId,
            canceled: 0,
            created_at: deps.now().toISOString(),
          })
          .execute();
      } catch {
        throw new HttpError(409, 'conflict', 'Event ID already exists');
      }
      await audit(model.id, me(request), 'event.create', req.id);
      eventsChanged(model);
      return reply.code(201).send({ id: req.id });
    },
  );

  const eventOf = async (
    eventId: unknown,
    riverId: string,
  ): Promise<{
    model: CommunityModel;
    row: { id: string; created_by: string; starts_at: string; ends_at: string };
  }> => {
    const id = parse(channelIdSchema, eventId);
    const row = await db
      .selectFrom('community_events')
      .select(['id', 'community_id', 'created_by', 'starts_at', 'ends_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound();
    return { model: await community(row.community_id, riverId), row };
  };

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/events/:id`, authed, async (request) => {
    const { model, row } = await eventOf(request.params.id, me(request));
    if (!model.can(me(request), Permission.MANAGE_EVENTS)) throw forbidden();
    const req = parse(updateEventRequestSchema, request.body);
    const startsAt = req.startsAt ? new Date(req.startsAt).toISOString() : row.starts_at;
    const endsAt = req.endsAt ? new Date(req.endsAt).toISOString() : row.ends_at;
    checkEventTimes(startsAt, endsAt);
    if (req.channelId && model.channel(req.channelId)?.kind !== 'voice') throw bad('Unknown voice channel');
    await db
      .updateTable('community_events')
      .set({
        ...(req.data ? { data: req.data } : {}),
        starts_at: startsAt,
        ends_at: endsAt,
        ...(req.channelId !== undefined ? { channel_id: req.channelId } : {}),
        ...(req.canceled !== undefined ? { canceled: req.canceled ? 1 : 0 } : {}),
      })
      .where('id', '=', row.id)
      .execute();
    await audit(model.id, me(request), req.canceled ? 'event.cancel' : 'event.update', row.id);
    eventsChanged(model);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/events/:id`, authed, async (request) => {
    const { model, row } = await eventOf(request.params.id, me(request));
    if (!model.can(me(request), Permission.MANAGE_EVENTS)) throw forbidden();
    await db.deleteFrom('community_events').where('id', '=', row.id).execute();
    await audit(model.id, me(request), 'event.delete', row.id);
    eventsChanged(model);
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>(`${API_PREFIX}/events/:id/interested`, authed, async (request) => {
    const { model, row } = await eventOf(request.params.id, me(request));
    await db
      .insertInto('community_event_rsvps')
      .values({ event_id: row.id, river_id: me(request) })
      .onConflict((oc) => oc.doNothing())
      .execute();
    eventsChanged(model);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/events/:id/interested`, authed, async (request) => {
    const { model, row } = await eventOf(request.params.id, me(request));
    await db
      .deleteFrom('community_event_rsvps')
      .where('event_id', '=', row.id)
      .where('river_id', '=', me(request))
      .execute();
    eventsChanged(model);
    return { ok: true };
  });

  // ---- custom emoji (1.0.19) -------------------------------------------------------------------
  const emojisChanged = (model: CommunityModel): void =>
    toMembers(model, { t: 'emojis', communityId: model.id });

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/emojis`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    const rows = await db
      .selectFrom('community_emojis')
      .select(['id', 'created_by', 'data'])
      .where('community_id', '=', model.id)
      .orderBy('created_at')
      .execute();
    return { emojis: rows.map((r) => ({ id: r.id, createdBy: r.created_by, data: r.data })) };
  });

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/emojis`,
    authed,
    async (request, reply) => {
      const model = await community(request.params.id, me(request));
      if (!model.can(me(request), Permission.MANAGE_EXPRESSIONS)) throw forbidden();
      const req = parse(createEmojiRequestSchema, request.body);
      const count = await db
        .selectFrom('community_emojis')
        .select(db.fn.countAll<number>().as('n'))
        .where('community_id', '=', model.id)
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= MAX_COMMUNITY_EMOJI)
        throw bad(`A community can have up to ${MAX_COMMUNITY_EMOJI} emoji`);
      try {
        await db
          .insertInto('community_emojis')
          .values({
            id: req.id,
            community_id: model.id,
            created_by: me(request),
            data: req.data,
            created_at: deps.now().toISOString(),
          })
          .execute();
      } catch {
        throw new HttpError(409, 'conflict', 'Emoji ID already exists');
      }
      await audit(model.id, me(request), 'emoji.create', req.id);
      emojisChanged(model);
      return reply.code(201).send({ id: req.id });
    },
  );

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/emojis/:id`, authed, async (request) => {
    const id = parse(channelIdSchema, request.params.id);
    const row = await db
      .selectFrom('community_emojis')
      .select(['community_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound();
    const model = await community(row.community_id, me(request));
    if (!model.can(me(request), Permission.MANAGE_EXPRESSIONS)) throw forbidden();
    await db.deleteFrom('community_emojis').where('id', '=', id).execute();
    await audit(model.id, me(request), 'emoji.delete', id);
    emojisChanged(model);
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/emojis/:id`, authed, async (request) => {
    const id = parse(channelIdSchema, request.params.id);
    const req = parse(updateEmojiRequestSchema, request.body);
    const row = await db
      .selectFrom('community_emojis')
      .select(['community_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound();
    const model = await community(row.community_id, me(request));
    if (!model.can(me(request), Permission.MANAGE_EXPRESSIONS)) throw forbidden();
    await db.updateTable('community_emojis').set({ data: req.data }).where('id', '=', id).execute();
    await audit(model.id, me(request), 'emoji.update', id);
    emojisChanged(model);
    return { ok: true };
  });

  // ---- stickers (1.0.24) -----------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/stickers`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    const rows = await db
      .selectFrom('community_stickers')
      .select(['id', 'created_by', 'data'])
      .where('community_id', '=', model.id)
      .orderBy('created_at')
      .execute();
    return { stickers: rows.map((r) => ({ id: r.id, createdBy: r.created_by, data: r.data })) };
  });

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/stickers`,
    { ...authed, bodyLimit: 320 * 1024 },
    async (request, reply) => {
      const model = await community(request.params.id, me(request));
      if (!model.can(me(request), Permission.MANAGE_EXPRESSIONS)) throw forbidden();
      const req = parse(createStickerRequestSchema, request.body);
      const count = await db
        .selectFrom('community_stickers')
        .select(db.fn.countAll<number>().as('n'))
        .where('community_id', '=', model.id)
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= MAX_COMMUNITY_STICKERS)
        throw bad(`A community can have up to ${MAX_COMMUNITY_STICKERS} stickers`);
      try {
        await db
          .insertInto('community_stickers')
          .values({
            id: req.id,
            community_id: model.id,
            created_by: me(request),
            data: req.data,
            created_at: deps.now().toISOString(),
          })
          .execute();
      } catch {
        throw new HttpError(409, 'conflict', 'Sticker ID already exists');
      }
      await audit(model.id, me(request), 'sticker.create', req.id);
      toMembers(model, { t: 'stickers', communityId: model.id });
      return reply.code(201).send({ id: req.id });
    },
  );

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/stickers/:id`, authed, async (request) => {
    const id = parse(channelIdSchema, request.params.id);
    const row = await db
      .selectFrom('community_stickers')
      .select(['community_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound();
    const model = await community(row.community_id, me(request));
    if (!model.can(me(request), Permission.MANAGE_EXPRESSIONS)) throw forbidden();
    await db.deleteFrom('community_stickers').where('id', '=', id).execute();
    await audit(model.id, me(request), 'sticker.delete', id);
    toMembers(model, { t: 'stickers', communityId: model.id });
    return { ok: true };
  });

  // ---- moderator notes (1.0.23) ----------------------------------------------------------------
  /** Notes are for people who may moderate members (time out, kick or ban). */
  const mayNote = (model: CommunityModel, riverId: string): boolean =>
    model.can(riverId, Permission.MODERATE_MEMBERS) ||
    model.can(riverId, Permission.KICK_MEMBERS) ||
    model.can(riverId, Permission.BAN_MEMBERS);

  app.get<{ Params: { id: string; member: string } }>(
    `${API_PREFIX}/communities/:id/members/:member/notes`,
    authed,
    async (request) => {
      const model = await community(request.params.id, me(request));
      if (!mayNote(model, me(request))) throw forbidden();
      const target = parse(riverIdSchema, request.params.member);
      const rows = await db
        .selectFrom('member_notes')
        .selectAll()
        .where('community_id', '=', model.id)
        .where('target', '=', target)
        .orderBy('created_at')
        .execute();
      return {
        notes: rows.map((r) => ({ id: r.id, author: r.author, data: r.data, createdAt: r.created_at })),
      };
    },
  );

  app.post<{ Params: { id: string; member: string } }>(
    `${API_PREFIX}/communities/:id/members/:member/notes`,
    authed,
    async (request, reply) => {
      const model = await community(request.params.id, me(request));
      if (!mayNote(model, me(request))) throw forbidden();
      const target = parse(riverIdSchema, request.params.member);
      const req = parse(createNoteRequestSchema, request.body);
      const count = await db
        .selectFrom('member_notes')
        .select(db.fn.countAll<number>().as('n'))
        .where('community_id', '=', model.id)
        .where('target', '=', target)
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= MAX_NOTES_PER_MEMBER) throw bad('That member has too many notes');
      try {
        await db
          .insertInto('member_notes')
          .values({
            id: req.id,
            community_id: model.id,
            target,
            author: me(request),
            data: req.data,
            created_at: deps.now().toISOString(),
          })
          .execute();
      } catch {
        throw new HttpError(409, 'conflict', 'Note ID already exists');
      }
      await audit(model.id, me(request), 'note.create', target);
      return reply.code(201).send({ id: req.id });
    },
  );

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/notes/:id`, authed, async (request) => {
    const id = parse(channelIdSchema, request.params.id);
    const row = await db.selectFrom('member_notes').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound();
    const model = await community(row.community_id, me(request));
    if (!mayNote(model, me(request))) throw forbidden();
    await db.deleteFrom('member_notes').where('id', '=', id).execute();
    await audit(model.id, me(request), 'note.delete', row.target);
    return { ok: true };
  });

  // ---- soundboard (1.0.22) ---------------------------------------------------------------------
  const soundsChanged = (model: CommunityModel): void =>
    toMembers(model, { t: 'sounds', communityId: model.id });

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/sounds`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    const rows = await db
      .selectFrom('community_sounds')
      .select(['id', 'created_by', 'data'])
      .where('community_id', '=', model.id)
      .orderBy('created_at')
      .execute();
    return { sounds: rows.map((r) => ({ id: r.id, createdBy: r.created_by, data: r.data })) };
  });

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/sounds`,
    { ...authed, bodyLimit: 400 * 1024 },
    async (request, reply) => {
      const model = await community(request.params.id, me(request));
      if (!model.can(me(request), Permission.MANAGE_EXPRESSIONS)) throw forbidden();
      const req = parse(createSoundRequestSchema, request.body);
      const count = await db
        .selectFrom('community_sounds')
        .select(db.fn.countAll<number>().as('n'))
        .where('community_id', '=', model.id)
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= MAX_COMMUNITY_SOUNDS)
        throw bad(`A community can have up to ${MAX_COMMUNITY_SOUNDS} sounds`);
      try {
        await db
          .insertInto('community_sounds')
          .values({
            id: req.id,
            community_id: model.id,
            created_by: me(request),
            data: req.data,
            created_at: deps.now().toISOString(),
          })
          .execute();
      } catch {
        throw new HttpError(409, 'conflict', 'Sound ID already exists');
      }
      await audit(model.id, me(request), 'sound.create', req.id);
      soundsChanged(model);
      return reply.code(201).send({ id: req.id });
    },
  );

  const soundOf = async (request: FastifyRequest<{ Params: { id: string } }>) => {
    const id = parse(channelIdSchema, request.params.id);
    const row = await db
      .selectFrom('community_sounds')
      .select(['community_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound();
    const model = await community(row.community_id, me(request));
    if (!model.can(me(request), Permission.MANAGE_EXPRESSIONS)) throw forbidden();
    return { id, model };
  };

  app.patch<{ Params: { id: string } }>(
    `${API_PREFIX}/sounds/:id`,
    { ...authed, bodyLimit: 400 * 1024 },
    async (request) => {
      const { id, model } = await soundOf(request);
      const req = parse(updateSoundRequestSchema, request.body);
      await db.updateTable('community_sounds').set({ data: req.data }).where('id', '=', id).execute();
      await audit(model.id, me(request), 'sound.update', id);
      soundsChanged(model);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/sounds/:id`, authed, async (request) => {
    const { id, model } = await soundOf(request);
    await db.deleteFrom('community_sounds').where('id', '=', id).execute();
    await audit(model.id, me(request), 'sound.delete', id);
    soundsChanged(model);
    return { ok: true };
  });

  // ---- reports (1.0.21) ------------------------------------------------------------------------
  /** People who review reports for a channel: they may manage messages there. */
  const reviewers = (model: CommunityModel, channelId: string): string[] =>
    model.members.map((m) => m.riverId).filter((id) => model.can(id, Permission.MANAGE_MESSAGES, channelId));

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/reports`,
    authed,
    async (request, reply) => {
      const req = parse(createReportRequestSchema, request.body);
      const { model, msg } = await messageContext(req.messageId, me(request));
      if (model.id !== request.params.id) throw notFound();
      if (msg.sender === me(request)) throw bad('You cannot report your own message');
      const open = await db
        .selectFrom('community_reports')
        .select(db.fn.countAll<number>().as('n'))
        .where('community_id', '=', model.id)
        .where('reporter', '=', me(request))
        .where('status', '=', 'open')
        .executeTakeFirstOrThrow();
      if (Number(open.n) >= MAX_OPEN_REPORTS) throw bad('You have too many open reports here');
      try {
        await db
          .insertInto('community_reports')
          .values({
            id: req.id,
            community_id: model.id,
            channel_id: msg.channel_id,
            message_id: msg.id,
            reporter: me(request),
            target: msg.sender,
            data: req.data,
            status: 'open',
            resolved_by: null,
            created_at: deps.now().toISOString(),
            resolved_at: null,
          })
          .execute();
      } catch {
        throw new HttpError(409, 'conflict', 'You already reported this message');
      }
      hub.sendTo(reviewers(model, msg.channel_id), { t: 'reports', communityId: model.id });
      return reply.code(201).send({ id: req.id });
    },
  );

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/reports`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    const rows = await db
      .selectFrom('community_reports')
      .selectAll()
      .where('community_id', '=', model.id)
      .orderBy('created_at', 'desc')
      .limit(200)
      .execute();
    // Only reports from channels where you may manage messages.
    const mine = rows.filter((r) => model.can(me(request), Permission.MANAGE_MESSAGES, r.channel_id));
    if (!mine.length && !model.can(me(request), Permission.MANAGE_MESSAGES)) throw forbidden();
    return {
      reports: mine.map((r) => ({
        id: r.id,
        channelId: r.channel_id,
        messageId: r.message_id,
        reporter: r.reporter,
        target: r.target,
        data: r.data,
        status: r.status,
        resolvedBy: r.resolved_by,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
      })),
    };
  });

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/reports/:id`, authed, async (request) => {
    const id = parse(channelIdSchema, request.params.id);
    const req = parse(updateReportRequestSchema, request.body);
    const row = await db.selectFrom('community_reports').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound();
    const model = await community(row.community_id, me(request));
    if (!model.can(me(request), Permission.MANAGE_MESSAGES, row.channel_id)) throw forbidden();
    const done = req.status !== 'open';
    await db
      .updateTable('community_reports')
      .set({
        status: req.status,
        resolved_by: done ? me(request) : null,
        resolved_at: done ? deps.now().toISOString() : null,
      })
      .where('id', '=', id)
      .execute();
    await audit(model.id, me(request), `report.${req.status}`, row.target, { report: id });
    hub.sendTo(reviewers(model, row.channel_id), { t: 'reports', communityId: model.id });
    return { ok: true };
  });

  // ---- ownership (1.0.19) ----------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/transfer`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    if (model.ownerId !== me(request)) throw forbidden('Only the owner can hand over a community');
    const req = parse(transferOwnershipRequestSchema, request.body);
    if (req.riverId === me(request)) throw bad('You already own it');
    if (!model.members.some((m) => m.riverId === req.riverId)) throw bad('They are not a member');
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('communities').set({ owner: req.riverId }).where('id', '=', model.id).execute();
      await trx
        .updateTable('community_members')
        .set({ role: 'member' })
        .where('community_id', '=', model.id)
        .where('river_id', '=', me(request))
        .execute();
      await trx
        .updateTable('community_members')
        .set({ role: 'owner' })
        .where('community_id', '=', model.id)
        .where('river_id', '=', req.riverId)
        .execute();
    });
    await audit(model.id, me(request), 'community.transfer', req.riverId);
    changed(model);
    return { ok: true };
  });

  // ---- categories and layout -----------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/categories`,
    authed,
    async (request, reply) => {
      const model = await community(request.params.id, me(request));
      if (!model.can(me(request), Permission.MANAGE_CHANNELS)) throw forbidden();
      const req = parse(createCategoryRequestSchema, request.body);
      if (model.categories.length >= MAX_CATEGORIES) throw bad('Too many categories');
      const position = model.categories.length;
      try {
        await db
          .insertInto('categories')
          .values({ id: req.id, community_id: model.id, name: req.name, position })
          .execute();
      } catch {
        throw new HttpError(409, 'conflict', 'Category ID already exists');
      }
      await audit(model.id, me(request), 'category.create', req.id);
      changed(model);
      return reply.code(201).send({ id: req.id, name: req.name, position });
    },
  );

  const categoryCommunity = async (
    categoryId: unknown,
    riverId: string,
  ): Promise<{ model: CommunityModel; categoryId: string }> => {
    const id = parse(channelIdSchema, categoryId);
    const row = await db
      .selectFrom('categories')
      .select('community_id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound();
    const model = await community(row.community_id, riverId);
    if (!model.can(riverId, Permission.MANAGE_CHANNELS)) throw forbidden();
    return { model, categoryId: id };
  };

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/categories/:id`, authed, async (request) => {
    const { model, categoryId } = await categoryCommunity(request.params.id, me(request));
    const req = parse(updateCategoryRequestSchema, request.body);
    checkOverwrites(
      model,
      req.overwrites ?? [],
      model.categoryPerms(me(request), categoryId),
      model.category(categoryId)!.overwrites,
    );
    await db.transaction().execute(async (trx) => {
      if (req.name !== undefined)
        await trx.updateTable('categories').set({ name: req.name }).where('id', '=', categoryId).execute();
      if (req.overwrites) {
        await trx.deleteFrom('category_overwrites').where('category_id', '=', categoryId).execute();
        for (const o of req.overwrites)
          await trx
            .insertInto('category_overwrites')
            .values({ category_id: categoryId, role_id: o.roleId, allow: o.allow, deny: o.deny })
            .execute();
      }
    });
    await audit(model.id, me(request), 'category.update', categoryId, {
      ...(req.name !== undefined ? { name: true } : {}),
      ...(req.overwrites ? { overwrites: req.overwrites } : {}),
    });
    changed(model);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/categories/:id`, authed, async (request) => {
    const { model, categoryId } = await categoryCommunity(request.params.id, me(request));
    await db.transaction().execute(async (trx) => {
      // Its channels keep the category's permissions (a private category's stay private).
      for (const ch of model.channels.filter((c) => c.parentId === categoryId)) await keepAccess(trx, ch);
      await trx
        .updateTable('channels')
        .set({ parent_id: null })
        .where('parent_id', '=', categoryId)
        .execute();
      await trx.deleteFrom('categories').where('id', '=', categoryId).execute();
    });
    await audit(model.id, me(request), 'category.delete', categoryId);
    changed(model);
    return { ok: true };
  });

  /** The whole sidebar order at once, so a drag and drop is applied atomically. */
  app.put<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/layout`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    const actor = me(request);
    if (!model.can(actor, Permission.MANAGE_CHANNELS)) throw forbidden();
    const req = parse(layoutRequestSchema, request.body);
    for (const k of req.categories) if (!model.category(k.id)) throw bad('Unknown category');
    for (const c of req.channels) {
      if (!model.channel(c.id)) throw bad('Unknown channel');
      if (!model.can(actor, Permission.MANAGE_CHANNELS, c.id)) throw forbidden();
      if (c.parentId !== null && !model.category(c.parentId)) throw bad('Unknown category');
    }
    await db.transaction().execute(async (trx) => {
      for (const k of req.categories) {
        await trx.updateTable('categories').set({ position: k.position }).where('id', '=', k.id).execute();
      }
      for (const c of req.channels) {
        const current = model.channel(c.id)!;
        if (c.synced !== true)
          await moved(
            trx,
            current,
            c.parentId,
            c.synced,
            c.parentId ? model.category(c.parentId)?.overwrites : [],
          );
        await trx
          .updateTable('channels')
          .set({
            position: c.position,
            parent_id: c.parentId,
            ...(c.synced !== undefined ? { synced: c.synced && c.parentId !== null ? 1 : 0 } : {}),
          })
          .where('id', '=', c.id)
          .execute();
      }
    });
    await audit(model.id, actor, 'channels.reorder', null, {
      categories: req.categories.length,
      channels: req.channels.length,
    });
    changed(model);
    return { ok: true };
  });

  /**
   * One drag and drop, relative to a neighbour (2.10.13). The positions are worked out here over
   * the whole list, hidden channels included, so nothing ties with a channel the mover cannot see,
   * and only the moved channel needs Manage channels. Applied in one transaction.
   */
  app.put<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/layout/move`,
    authed,
    async (request) => {
      const model = await community(request.params.id, me(request));
      const actor = me(request);
      if (!model.can(actor, Permission.MANAGE_CHANNELS)) throw forbidden();
      const req = parse(layoutMoveRequestSchema, request.body);
      if (req.kind === 'category') {
        if (!model.category(req.id)) throw bad('Unknown category');
        if (req.afterId !== null && (req.afterId === req.id || !model.category(req.afterId)))
          throw bad('Unknown category');
        const rest = [...model.categories]
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
          .filter((k) => k.id !== req.id);
        const at = req.afterId === null ? 0 : rest.findIndex((k) => k.id === req.afterId) + 1;
        const order = [...rest.slice(0, at), model.category(req.id)!, ...rest.slice(at)];
        await db.transaction().execute(async (trx) => {
          for (const [position, k] of order.entries())
            if (k.position !== position)
              await trx.updateTable('categories').set({ position }).where('id', '=', k.id).execute();
        });
        await audit(model.id, actor, 'channels.reorder', req.id, { categories: 1, channels: 0 });
        changed(model);
        return { ok: true };
      }
      const moving = model.channel(req.id);
      if (!moving) throw bad('Unknown channel');
      if (!model.can(actor, Permission.MANAGE_CHANNELS, req.id)) throw forbidden();
      if (req.parentId !== null && !model.category(req.parentId)) throw bad('Unknown category');
      const groupOf = (c: ChannelModel): string | null =>
        c.parentId !== null && model.category(c.parentId) ? c.parentId : null;
      const byPosition = (a: ChannelModel, b: ChannelModel): number =>
        a.position - b.position ||
        (a.kind === b.kind ? 0 : a.kind === 'text' ? -1 : 1) ||
        a.id.localeCompare(b.id);
      let rest = model.channels
        .filter((c) => c.id !== req.id && groupOf(c) === req.parentId)
        .sort(byPosition);
      // Without categories the sidebar lists text channels before voice channels.
      if (model.categories.length === 0)
        rest = [...rest.filter((c) => c.kind === 'text'), ...rest.filter((c) => c.kind !== 'text')];
      if (req.afterId !== null && !rest.some((c) => c.id === req.afterId)) throw bad('Unknown channel');
      const at = req.afterId === null ? 0 : rest.findIndex((c) => c.id === req.afterId) + 1;
      const order = [...rest.slice(0, at), moving, ...rest.slice(at)];
      if (order.length > 1000) throw bad();
      await db.transaction().execute(async (trx) => {
        await moved(
          trx,
          moving,
          req.parentId,
          undefined,
          req.parentId ? model.category(req.parentId)?.overwrites : [],
        );
        for (const [position, c] of order.entries()) {
          if (c === moving) {
            await trx
              .updateTable('channels')
              .set({ position, parent_id: req.parentId })
              .where('id', '=', c.id)
              .execute();
          } else if (c.position !== position) {
            await trx.updateTable('channels').set({ position }).where('id', '=', c.id).execute();
          }
        }
      });
      await audit(model.id, actor, 'channels.reorder', req.id, { categories: 0, channels: 1 });
      changed(model);
      return { ok: true };
    },
  );

  // ---- roles -----------------------------------------------------------------------------------
  const checkGrant = (model: CommunityModel, actor: string, permissions: number): void => {
    const mine = model.perms(actor);
    if ((permissions & ~mine) !== 0) throw forbidden('You cannot grant permissions you do not have');
  };

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/roles`,
    authed,
    async (request, reply) => {
      const model = await community(request.params.id, me(request));
      if (!model.can(me(request), Permission.MANAGE_ROLES)) throw forbidden();
      const req = parse(createRoleRequestSchema, request.body);
      if (model.roles.length >= MAX_ROLES) throw bad('Too many roles');
      checkGrant(model, me(request), req.permissions);
      try {
        await db.transaction().execute(async (trx) => {
          // New roles go just above @everyone; everything else moves up one.
          for (const r of model.roles.filter((r) => r.id !== model.everyoneRoleId)) {
            await trx
              .updateTable('roles')
              .set({ position: r.position + 1 })
              .where('id', '=', r.id)
              .execute();
          }
          await trx
            .insertInto('roles')
            .values({
              id: req.id,
              community_id: model.id,
              name: req.name,
              color: req.color,
              permissions: req.permissions,
              position: 1,
            })
            .execute();
        });
      } catch {
        throw new HttpError(409, 'conflict', 'Role ID already exists');
      }
      await audit(model.id, me(request), 'role.create', req.id, {
        permissions: req.permissions,
        color: req.color,
      });
      changed(model);
      return reply.code(201).send({ ok: true });
    },
  );

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/roles/:id`, authed, async (request) => {
    const roleId = parse(roleIdSchema, request.params.id);
    const row = await db
      .selectFrom('roles')
      .select('community_id')
      .where('id', '=', roleId)
      .executeTakeFirst();
    if (!row) throw notFound();
    const model = await community(row.community_id, me(request));
    const role = model.role(roleId)!;
    if (!model.can(me(request), Permission.MANAGE_ROLES)) throw forbidden();
    if (role.id !== model.everyoneRoleId && role.position >= model.top(me(request))) {
      throw forbidden('You can only edit roles below your highest role');
    }
    const req = parse(updateRoleRequestSchema, request.body);
    if (req.permissions !== undefined) checkGrant(model, me(request), req.permissions & ~role.permissions);
    // A role members give themselves must stay harmless (see the onboarding settings).
    if (
      req.permissions !== undefined &&
      model.selfRoles.includes(roleId) &&
      (req.permissions & SELF_ROLE_FORBIDDEN) !== 0
    )
      throw bad('Roles members give themselves cannot moderate or manage anything');
    if (
      role.id === model.everyoneRoleId &&
      (req.name !== undefined || req.position !== undefined || req.color !== undefined)
    ) {
      throw bad('@everyone can only change permissions');
    }
    if (req.position !== undefined && req.position >= model.top(me(request)))
      throw forbidden('Cannot move a role above your own');
    await db
      .updateTable('roles')
      .set({
        ...(req.name !== undefined ? { name: req.name } : {}),
        ...(req.color !== undefined ? { color: req.color } : {}),
        ...(req.permissions !== undefined ? { permissions: req.permissions } : {}),
        ...(req.position !== undefined ? { position: req.position } : {}),
      })
      .where('id', '=', roleId)
      .execute();
    await audit(model.id, me(request), 'role.update', roleId, {
      ...(req.name !== undefined ? { name: true } : {}),
      ...(req.color !== undefined ? { color: req.color } : {}),
      ...(req.permissions !== undefined ? { before: role.permissions, after: req.permissions } : {}),
      ...(req.position !== undefined ? { position: req.position } : {}),
    });
    changed(model);
    return { ok: true };
  });

  /**
   * Reorders roles in one go (2.10.13): either every new position is applied or none is, so a
   * refused step can never leave half an order behind. Only roles below the mover's highest role
   * move, and only to places below it; no two roles end up sharing a position.
   */
  app.put<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/role-order`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    const actor = me(request);
    if (!model.can(actor, Permission.MANAGE_ROLES)) throw forbidden();
    const req = parse(roleOrderRequestSchema, request.body);
    const top = model.top(actor);
    const ids = new Set(req.roles.map((r) => r.id));
    const positions = new Set(req.roles.map((r) => r.position));
    if (ids.size !== req.roles.length || positions.size !== req.roles.length) throw bad();
    for (const r of req.roles) {
      const role = model.role(r.id);
      if (!role || role.id === model.everyoneRoleId) throw bad('Unknown role');
      if (role.position >= top) throw forbidden('You can only move roles below your highest role');
      if (r.position >= top) throw forbidden('Cannot move a role above your own');
    }
    for (const role of model.roles) {
      if (role.id === model.everyoneRoleId || ids.has(role.id)) continue;
      if (positions.has(role.position)) throw bad('Two roles cannot share a position');
    }
    await db.transaction().execute(async (trx) => {
      for (const r of req.roles)
        await trx.updateTable('roles').set({ position: r.position }).where('id', '=', r.id).execute();
    });
    await audit(model.id, actor, 'role.reorder', null, { roles: req.roles.length });
    changed(model);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/roles/:id`, authed, async (request) => {
    const roleId = parse(roleIdSchema, request.params.id);
    const row = await db
      .selectFrom('roles')
      .select('community_id')
      .where('id', '=', roleId)
      .executeTakeFirst();
    if (!row) throw notFound();
    const model = await community(row.community_id, me(request));
    if (!model.can(me(request), Permission.MANAGE_ROLES)) throw forbidden();
    if (roleId === model.everyoneRoleId) throw bad('@everyone cannot be deleted');
    const gone = model.role(roleId)!;
    if (gone.position >= model.top(me(request))) throw forbidden('You can only delete roles below your own');
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('channel_overwrites').where('role_id', '=', roleId).execute();
      await trx.deleteFrom('category_overwrites').where('role_id', '=', roleId).execute();
      await trx.deleteFrom('roles').where('id', '=', roleId).execute();
      // Close the gap, so positions stay 1..n (creating a role shifts every other one up).
      await trx
        .updateTable('roles')
        .set((eb) => ({ position: eb('position', '-', 1) }))
        .where('community_id', '=', model.id)
        .where('id', '!=', model.everyoneRoleId)
        .where('position', '>', gone.position)
        .execute();
    });
    await audit(model.id, me(request), 'role.delete', roleId);
    changed(model);
    return { ok: true };
  });

  app.put<{ Params: { id: string; member: string } }>(
    `${API_PREFIX}/communities/:id/members/:member/roles`,
    authed,
    async (request) => {
      const model = await community(request.params.id, me(request));
      const target = parse(riverIdSchema, request.params.member);
      if (!model.member(target)) throw notFound();
      if (!model.can(me(request), Permission.MANAGE_ROLES)) throw forbidden();
      const req = parse(memberRolesRequestSchema, request.body);
      const top = model.top(me(request));
      const before = new Set(model.member(target)!.roles);
      const after = new Set(req.roles);
      for (const id of new Set([...before, ...after])) {
        if (before.has(id) === after.has(id)) continue;
        const role = model.role(id);
        if (!role || id === model.everyoneRoleId) throw bad('Unknown role');
        if (role.position >= top) throw forbidden('You can only assign roles below your highest role');
      }
      if (target !== me(request) && !model.outranks(me(request), target) && model.ownerId !== me(request)) {
        throw forbidden('You can only change roles of members below you');
      }
      const nowIso = deps.now().toISOString();
      await db.transaction().execute(async (trx) => {
        // A temporary role that stays keeps its end time (1.0.30). A role whose time ran out is
        // not held any more: giving it again gives it for good, not with the old (past) end time.
        const expiry = new Map(
          (
            await trx
              .selectFrom('member_roles')
              .select(['role_id', 'expires_at'])
              .where('community_id', '=', model.id)
              .where('river_id', '=', target)
              .where('expires_at', '>', nowIso)
              .execute()
          )
            .filter((r) => before.has(r.role_id))
            .map((r) => [r.role_id, r.expires_at ?? null]),
        );
        await trx
          .deleteFrom('member_roles')
          .where('community_id', '=', model.id)
          .where('river_id', '=', target)
          .execute();
        for (const id of after)
          await trx
            .insertInto('member_roles')
            .values({
              community_id: model.id,
              river_id: target,
              role_id: id,
              expires_at: expiry.get(id) ?? null,
            })
            .execute();
      });
      await audit(model.id, me(request), 'member.roles', target, {
        added: [...after].filter((id) => !before.has(id)),
        removed: [...before].filter((id) => !after.has(id)),
      });
      changed(model);
      return { ok: true };
    },
  );

  // ---- moderation ------------------------------------------------------------------------------
  /** Deletes someone's messages in a community from the last `seconds` (a ban option, 1.0.21). */
  const purgeMessages = async (model: CommunityModel, sender: string, seconds: number): Promise<number> => {
    const since = new Date(deps.now().getTime() - seconds * 1000).toISOString();
    const channelIds = model.channels.map((c) => c.id);
    if (!channelIds.length) return 0;
    const rows = await db
      .selectFrom('messages')
      .select(['id', 'channel_id', 'thread_id'])
      .where('sender', '=', sender)
      .where('channel_id', 'in', channelIds)
      .where('sent_at', '>=', since)
      .orderBy('sent_at', 'desc')
      .limit(MAX_BAN_DELETES)
      .execute();
    if (!rows.length) return 0;
    const ids = rows.map((r) => r.id);
    const touchedThreads = new Set<string>();
    await db.transaction().execute(async (trx) => {
      for (const r of rows) {
        await trx.deleteFrom('messages').where('thread_id', '=', r.id).execute();
        await trx.deleteFrom('threads').where('id', '=', r.id).execute();
        if (r.thread_id && !ids.includes(r.thread_id)) {
          touchedThreads.add(r.thread_id);
          await trx
            .updateTable('threads')
            .set((eb) => ({ count: eb('count', '-', 1) }))
            .where('id', '=', r.thread_id)
            .execute();
        }
      }
      await trx.deleteFrom('messages').where('id', 'in', ids).execute();
    });
    for (const t of touchedThreads) await pushMessage(model, t);
    for (const r of rows)
      hub.sendTo(model.viewers(r.channel_id), {
        t: 'message.delete',
        communityId: model.id,
        channelId: r.channel_id,
        messageId: r.id,
      });
    return rows.length;
  };

  app.delete<{ Params: { id: string; member: string } }>(
    `${API_PREFIX}/communities/:id/members/:member`,
    authed,
    async (request) => {
      const model = await community(request.params.id, me(request));
      const target = parse(riverIdSchema, request.params.member);
      if (!model.member(target)) throw notFound();
      if (!model.can(me(request), Permission.KICK_MEMBERS) || !model.outranks(me(request), target))
        throw forbidden();
      await removeMember(model, target, 'kicked', me(request));
      return { ok: true };
    },
  );

  app.put<{ Params: { id: string; member: string } }>(
    `${API_PREFIX}/communities/:id/bans/:member`,
    authed,
    async (request) => {
      const model = await community(request.params.id, me(request));
      const target = parse(riverIdSchema, request.params.member);
      if (!model.can(me(request), Permission.BAN_MEMBERS)) throw forbidden();
      if (model.member(target) && !model.outranks(me(request), target)) throw forbidden();
      if (target === model.ownerId) throw forbidden();
      const req = parse(banRequestSchema, request.body ?? {});
      const until = req.durationSeconds
        ? new Date(deps.now().getTime() + req.durationSeconds * 1000).toISOString()
        : null;
      await db
        .insertInto('bans')
        .values({ community_id: model.id, river_id: target, banned_on: day(deps.now()), until })
        .onConflict((oc) => oc.columns(['community_id', 'river_id']).doUpdateSet({ until }))
        .execute();
      const deleted = req.deleteMessagesSeconds
        ? await purgeMessages(model, target, req.deleteMessagesSeconds)
        : 0;
      if (model.member(target)) await removeMember(model, target, 'banned', me(request));
      else await audit(model.id, me(request), 'member.ban', target);
      if (until) await audit(model.id, me(request), 'member.tempban', target, { until });
      if (deleted) await audit(model.id, me(request), 'message.purge', target, { count: deleted });
      return { ok: true, deleted };
    },
  );

  app.delete<{ Params: { id: string; member: string } }>(
    `${API_PREFIX}/communities/:id/bans/:member`,
    authed,
    async (request) => {
      const model = await community(request.params.id, me(request));
      if (!model.can(me(request), Permission.BAN_MEMBERS)) throw forbidden();
      const target = parse(riverIdSchema, request.params.member);
      await db
        .deleteFrom('bans')
        .where('community_id', '=', model.id)
        .where('river_id', '=', target)
        .execute();
      await audit(model.id, me(request), 'member.unban', target);
      return { ok: true };
    },
  );

  app.put<{ Params: { id: string; member: string } }>(
    `${API_PREFIX}/communities/:id/members/:member/timeout`,
    authed,
    async (request) => {
      const model = await community(request.params.id, me(request));
      const target = parse(riverIdSchema, request.params.member);
      if (!model.member(target)) throw notFound();
      if (!model.can(me(request), Permission.MODERATE_MEMBERS) || !model.outranks(me(request), target))
        throw forbidden('You can only time out members below you');
      const req = parse(timeoutRequestSchema, request.body);
      const now = deps.now().getTime();
      if (req.until !== null) {
        const until = Date.parse(req.until);
        if (until <= now) throw bad('A timeout must end in the future');
        if (until > now + MAX_TIMEOUT_MS) throw bad('A timeout can last at most 28 days');
      }
      await db
        .updateTable('community_members')
        .set({ timeout_until: req.until })
        .where('community_id', '=', model.id)
        .where('river_id', '=', target)
        .execute();
      // No talking from a timed-out member in voice either.
      if (req.until !== null && hub.voiceChannelOf(target) && model.channel(hub.voiceChannelOf(target)!)) {
        const left = hub.leaveVoice(target);
        hub.sendTo([target], { t: 'voice.disconnect' });
        if (left) await voiceUpdate(left.communityId, left.channelId);
      }
      await audit(model.id, me(request), req.until ? 'member.timeout' : 'member.timeout.end', target, {
        until: req.until,
      });
      changed(model);
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { before?: string; beforeId?: string } }>(
    `${API_PREFIX}/communities/:id/audit`,
    authed,
    async (request) => {
      const model = await community(request.params.id, me(request));
      if (!model.can(me(request), Permission.VIEW_AUDIT_LOG)) throw forbidden();
      const before = request.query.before;
      if (before !== undefined && Number.isNaN(Date.parse(before))) throw bad('Bad cursor');
      // The cursor is (time, ID) of the last entry seen, so entries sharing that time are not skipped.
      const beforeId = request.query.beforeId;
      if (beforeId !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(beforeId)) throw bad('Bad cursor');
      let q = db
        .selectFrom('audit_log')
        .selectAll()
        .where('community_id', '=', model.id)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(PAGE);
      if (before && beforeId)
        q = q.where((eb) =>
          eb.or([
            eb('created_at', '<', before),
            eb.and([eb('created_at', '=', before), eb('id', '<', beforeId)]),
          ]),
        );
      else if (before) q = q.where('created_at', '<', before);
      const rows = await q.execute();
      return {
        entries: rows.map((r) => ({
          id: r.id,
          actor: r.actor,
          action: r.action,
          target: r.target,
          details: JSON.parse(r.details) as Record<string, unknown>,
          at: r.created_at,
        })),
      };
    },
  );

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/bans`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    if (!model.can(me(request), Permission.BAN_MEMBERS)) throw forbidden();
    const rows = await db
      .selectFrom('bans')
      .select(['river_id', 'banned_on', 'until'])
      .where('community_id', '=', model.id)
      .execute();
    const now = deps.now().toISOString();
    return {
      bans: rows
        .filter((r) => !r.until || r.until > now)
        .map((r) => ({ riverId: r.river_id, bannedOn: r.banned_on, until: r.until })),
    };
  });

  // ---- invites ---------------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/invites`,
    { ...authed, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const model = await community(request.params.id, me(request));
      if (!model.can(me(request), Permission.CREATE_INVITE)) throw forbidden();
      const inviteReq = parse(createInviteRequestSchema, request.body ?? {});
      const code = randomBytes(16).toString('base64url');
      const expiresAt = new Date(deps.now().getTime() + INVITE_TTL_MS).toISOString();
      await db
        .insertInto('invites')
        .values({
          code_hash: sha256(code),
          community_id: model.id,
          expires_at: expiresAt,
          uses: 0,
          max_uses: INVITE_MAX_USES,
          check: inviteReq.check ?? null,
          id: randomBytes(12).toString('base64url'),
          created_by: me(request),
          created_at: deps.now().toISOString(),
        })
        .execute();
      await audit(model.id, me(request), 'invite.create', null, { expiresAt });
      return reply.code(201).send({ code, expiresAt });
    },
  );

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/invites`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    if (!model.can(me(request), Permission.MANAGE_COMMUNITY)) throw forbidden();
    const rows = await db
      .selectFrom('invites')
      .selectAll()
      .where('community_id', '=', model.id)
      .where('expires_at', '>', deps.now().toISOString())
      // Used up invites no longer work, so they are not listed as active.
      .where((eb) => eb('uses', '<', eb.ref('max_uses')))
      .orderBy('expires_at', 'desc')
      .execute();
    const joinedWith = await db
      .selectFrom('community_members')
      .select(['river_id', 'invite_id'])
      .where('community_id', '=', model.id)
      .where('invite_id', 'is not', null)
      .execute();
    return {
      invites: rows
        .filter((r) => r.id)
        .map((r) => ({
          id: r.id!,
          createdBy: r.created_by ?? null,
          createdAt: r.created_at ?? null,
          expiresAt: r.expires_at,
          uses: r.uses,
          maxUses: r.max_uses,
          joined: joinedWith.filter((m) => m.invite_id === r.id).map((m) => m.river_id),
        })),
    };
  });

  app.delete<{ Params: { id: string; invite: string } }>(
    `${API_PREFIX}/communities/:id/invites/:invite`,
    authed,
    async (request) => {
      const model = await community(request.params.id, me(request));
      const row = await db
        .selectFrom('invites')
        .select(['created_by'])
        .where('community_id', '=', model.id)
        .where('id', '=', String(request.params.invite).slice(0, 64))
        .executeTakeFirst();
      if (!row) throw notFound();
      if (row.created_by !== me(request) && !model.can(me(request), Permission.MANAGE_COMMUNITY))
        throw forbidden();
      await db
        .deleteFrom('invites')
        .where('community_id', '=', model.id)
        .where('id', '=', String(request.params.invite).slice(0, 64))
        .execute();
      await audit(model.id, me(request), 'invite.revoke', null);
      return { ok: true };
    },
  );

  app.post(
    `${API_PREFIX}/invites/join`,
    { ...authed, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const req = parse(joinRequestSchema, request.body);
      const now = deps.now();
      const invite = await db
        .selectFrom('invites')
        .selectAll()
        .where('code_hash', '=', sha256(req.code))
        .where('expires_at', '>', now.toISOString())
        .executeTakeFirst();
      if (!invite || invite.uses >= invite.max_uses)
        throw new HttpError(404, 'invalid_invite', 'This invite is invalid or expired');
      const banned = await db
        .selectFrom('bans')
        .select(['river_id', 'until'])
        .where('community_id', '=', invite.community_id)
        .where('river_id', '=', me(request))
        .executeTakeFirst();
      if (banned && (!banned.until || banned.until > deps.now().toISOString()))
        throw new HttpError(
          403,
          'banned',
          banned.until
            ? `You are banned from this community until ${banned.until.slice(0, 16).replace('T', ' ')} UTC`
            : 'You are banned from this community',
        );
      // A temporary ban that is over is forgotten.
      if (banned)
        await db
          .deleteFrom('bans')
          .where('community_id', '=', invite.community_id)
          .where('river_id', '=', me(request))
          .execute();
      let model = (await loadCommunity(db, invite.community_id))!;
      if (!model.member(me(request))) {
        await db.transaction().execute(async (trx) => {
          // Counted atomically: parallel joins cannot take more uses than the invite has.
          const used = await trx
            .updateTable('invites')
            .set((eb) => ({ uses: eb('uses', '+', 1) }))
            .where('code_hash', '=', invite.code_hash)
            .where((eb) => eb('uses', '<', eb.ref('max_uses')))
            .where('expires_at', '>', now.toISOString())
            .executeTakeFirst();
          if (Number(used.numUpdatedRows) !== 1)
            throw new HttpError(404, 'invalid_invite', 'This invite is invalid or expired');
          await trx
            .insertInto('community_members')
            .values({
              community_id: model.id,
              river_id: me(request),
              role: 'member',
              profile: req.profile,
              joined_on: day(now),
              accepted: model.screening ? 0 : 1,
              invite_id: invite.id ?? null,
            })
            .execute();
        });
        model = (await loadCommunity(db, invite.community_id))!;
        toMembers(model, {
          t: 'member',
          communityId: model.id,
          member: {
            riverId: me(request),
            role: 'member',
            roles: [],
            profile: req.profile,
            online: true,
            timeoutUntil: null,
            joinedOn: day(now),
          },
        });
        await audit(model.id, me(request), 'member.join', me(request));
      }
      const last = await lastMessageTimes(
        db,
        model.channels.map((c) => c.id),
      );
      return {
        ...model.wireFor(me(request), (id) => hub.visibleStatus(id), last),
        inviteCheck: invite.check,
      };
    },
  );

  /**
   * Compare-and-set for key rotation: the first member to move the epoch from
   * `from` to `from + 1` distributes the new key; everyone else waits for it.
   */
  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/epoch`,
    { ...authed, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const model = await community(request.params.id, me(request));
      // Apps rotate only when the server asks for it (someone left or was removed); then any
      // member who has accepted the rules may be the one. Otherwise only managers may move the key
      // on, so members cannot keep the community re-keying.
      if (model.pending(me(request))) throw forbidden('Accept the rules first');
      if (!model.rotationNeeded && !model.can(me(request), Permission.MANAGE_COMMUNITY))
        throw forbidden('The community key does not need replacing');
      const req = parse(rotateKeyRequestSchema, request.body);
      const res = await db
        .updateTable('communities')
        .set({
          key_epoch: req.from + 1,
          rotation_needed: 0,
          // Remembered until another member reports having the new key (see epoch/adopted).
          epoch_claimed_at: deps.now().toISOString(),
          epoch_claimed_by: me(request),
        })
        .where('id', '=', model.id)
        .where('key_epoch', '=', req.from)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) !== 1) {
        return reply
          .code(409)
          .send({ error: { code: 'epoch_conflict', message: 'The key was already replaced' } });
      }
      changed(model);
      return { epoch: req.from + 1 };
    },
  );

  /**
   * A member reports that the current epoch's key reached them (2.11). Once someone other than
   * the member who claimed the epoch has it, the rotation is done.
   */
  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/epoch/adopted`,
    { ...authed, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const model = await community(request.params.id, me(request));
      const req = parse(rotateKeyResponseSchema.strict(), request.body);
      await db
        .updateTable('communities')
        .set({ epoch_claimed_at: null, epoch_claimed_by: null })
        .where('id', '=', model.id)
        .where('key_epoch', '=', req.epoch)
        .where('epoch_claimed_by', '!=', me(request))
        .execute();
      return { ok: true };
    },
  );

  /**
   * A rotation nobody else reported having within ROTATION_ADOPT_MS never reached anyone (the
   * member who claimed it went away, or never sent it): ask for it again, a few times, so the
   * community does not stay on a key a removed member still has.
   */
  let lastRecheck = Number.NEGATIVE_INFINITY;
  const recheckRotations = async (): Promise<void> => {
    // At most once a minute per process (2.11.2): GET /communities runs it too, and it scans
    // every community.
    const nowMs = deps.now().getTime();
    if (nowMs - lastRecheck < (deps.rotationRecheckMs ?? ROTATION_RECHECK_MS)) return;
    lastRecheck = nowMs;
    for (const [id, at] of lastActive) if (nowMs - at > ACTIVE_MEMORY_MS) lastActive.delete(id);
    const cutoff = new Date(nowMs - (deps.rotationAdoptMs ?? ROTATION_ADOPT_MS)).toISOString();
    const stuck = await db
      .selectFrom('communities')
      .select(['id', 'key_epoch', 'epoch_claimed_at', 'epoch_claimed_by'])
      .where('epoch_claimed_at', 'is not', null)
      .where('epoch_claimed_at', '<', cutoff)
      .where('rotation_retries', '<', ROTATION_MAX_RETRIES)
      .execute();
    for (const c of stuck) {
      const members = (
        await db.selectFrom('community_members').select('river_id').where('community_id', '=', c.id).execute()
      ).map((m) => m.river_id);
      const alone = members.length <= 1;
      // Nobody else used River since the claim (offline, or older apps that never report the key):
      // the key may simply not have reached anyone yet. Asked again only once someone could have
      // taken it in, so offline members do not use up the retries.
      const claimedAt = Date.parse(c.epoch_claimed_at ?? '');
      const someoneCould = members.some(
        (id) =>
          id !== c.epoch_claimed_by && (hub.isOnline(id) || (lastActive.get(id) ?? -Infinity) >= claimedAt),
      );
      if (!alone && !someoneCould) continue;
      const res = await db
        .updateTable('communities')
        .set((eb) => ({
          rotation_needed: alone ? 0 : 1,
          epoch_claimed_at: null,
          epoch_claimed_by: null,
          rotation_retries: eb('rotation_retries', '+', 1),
        }))
        .where('id', '=', c.id)
        .where('key_epoch', '=', c.key_epoch)
        .where('epoch_claimed_at', '<', cutoff)
        .executeTakeFirst();
      if (!alone && Number(res.numUpdatedRows) === 1) {
        const model = await loadCommunity(db, c.id);
        if (model) changed(model);
      }
    }
  };
  const rotationTimer = setInterval(() => void recheckRotations().catch(() => undefined), 60_000);
  rotationTimer.unref?.();
  app.addHook('onClose', async () => clearInterval(rotationTimer));

  // ---- messages --------------------------------------------------------------------------------
  /**
   * The page of messages before a cursor, newest first. The cursor is the time of the oldest
   * message already seen and, from 2.12, its ID: messages sharing that time are ordered by ID, so
   * none of them is skipped at a page boundary. Without an ID it is the time alone, as before.
   */
  const messageRows = () => db.selectFrom('messages').selectAll();
  type MessageQuery = ReturnType<typeof messageRows>;
  const beforeCursor = (q: MessageQuery, before?: string, beforeId?: string): MessageQuery => {
    if (!before || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before)) return q;
    if (beforeId && /^[A-Za-z0-9_-]{22}$/.test(beforeId))
      return q.where((eb) =>
        eb.or([eb('sent_at', '<', before), eb.and([eb('sent_at', '=', before), eb('id', '<', beforeId)])]),
      );
    return q.where('sent_at', '<', before);
  };

  app.get<{
    Params: { id: string };
    Querystring: { before?: string; beforeId?: string; pinned?: string };
  }>(`${API_PREFIX}/channels/:id/messages`, authed, async (request) => {
    const { channelId } = await channelCommunity(request.params.id, me(request));
    let q = messageRows().where('channel_id', '=', channelId).where('thread_id', 'is', null);
    q = beforeCursor(q, request.query.before, request.query.beforeId);
    if (request.query.pinned === '1') q = q.where('pinned', '=', 1);
    const rows = await q.orderBy('sent_at', 'desc').orderBy('id', 'desc').limit(PAGE).execute();
    return { messages: await loadMessages(db, rows.reverse()) };
  });

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/channels/:id/messages`,
    { ...authed, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { model, channelId } = await channelCommunity(request.params.id, me(request));
      const ch = model.channel(channelId)!;
      if (ch.kind !== 'text') throw notFound();
      const req = parse(sendMessageRequestSchema, request.body);
      // Your own message sent again under its ID (its answer was lost): "already exists", before
      // slowmode, a timeout or anything else could refuse it as if it were a new one, so the app
      // recognises it was sent instead of showing it failed.
      const existing = await db
        .selectFrom('messages')
        .select('sender')
        .where('id', '=', req.id)
        .executeTakeFirst();
      if (existing?.sender === me(request)) throw new HttpError(409, 'conflict', 'Message ID already exists');
      if (!model.can(me(request), Permission.SEND_MESSAGES, channelId))
        throw forbidden('You cannot send messages here');
      if (req.thread && req.threadId) throw bad('A thread cannot start inside another thread');
      // In a forum every top-level message is a post: it starts its own titled thread.
      if (ch.forum && !req.threadId && !req.thread)
        throw new HttpError(400, 'forum_post', 'This is a forum: start a post with a title');
      const attachments = req.attachments ?? [];
      const managesMessages = model.can(me(request), Permission.MANAGE_MESSAGES, channelId);
      if (req.threadId) {
        const thread = await db
          .selectFrom('threads')
          .selectAll()
          .where('id', '=', req.threadId)
          .executeTakeFirst();
        if (!thread || thread.channel_id !== channelId) throw notFound();
        if (thread.archived && !managesMessages) throw forbidden('This thread is archived');
      } else if (
        ch.slowmode > 0 &&
        !managesMessages &&
        !model.can(me(request), Permission.MANAGE_CHANNELS, channelId)
      ) {
        const last = await db
          .selectFrom('messages')
          .select('sent_at')
          .where('channel_id', '=', channelId)
          .where('sender', '=', me(request))
          .where('thread_id', 'is', null)
          .orderBy('sent_at', 'desc')
          .limit(1)
          .executeTakeFirst();
        const wait = last
          ? Math.ceil((Date.parse(last.sent_at) + ch.slowmode * 1000 - deps.now().getTime()) / 1000)
          : 0;
        if (wait > 0) throw new HttpError(429, 'slowmode', `Slowmode is on: you can send again in ${wait}s.`);
      }
      if (attachments.length && !model.can(me(request), Permission.ATTACH_FILES, channelId)) {
        throw forbidden('You cannot attach files here');
      }
      try {
        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto('messages')
            .values({
              id: req.id,
              channel_id: channelId,
              sender: me(request),
              body: req.body,
              sent_at: deps.now().toISOString(),
              pinned: 0,
              thread_id: req.threadId ?? null,
            })
            .execute();
          await linkAttachments(trx, attachments, me(request), req.id);
          if (req.thread) {
            await trx
              .insertInto('threads')
              .values({
                id: req.id,
                channel_id: channelId,
                name: req.thread.name,
                creator: me(request),
                created_at: deps.now().toISOString(),
                last_at: null,
              })
              .execute();
          }
          if (req.threadId) {
            await trx
              .updateTable('threads')
              .set((eb) => ({ count: eb('count', '+', 1), last_at: deps.now().toISOString(), archived: 0 }))
              .where('id', '=', req.threadId)
              .execute();
          }
        });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(409, 'conflict', 'Message ID already exists');
      }
      await pushMessage(model, req.id);
      // The starting message shows the thread's reply count and last activity.
      if (req.threadId) await pushMessage(model, req.threadId);
      const row = await db
        .selectFrom('messages')
        .selectAll()
        .where('id', '=', req.id)
        .executeTakeFirstOrThrow();
      return reply.code(201).send((await loadMessages(db, [row]))[0]);
    },
  );

  // ---- incoming webhooks (1.0.32, ADR 0004) ----------------------------------------------------
  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/webhooks`,
    { ...authed, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const model = await community(request.params.id, me(request));
      const req = parse(createWebhookRequestSchema, request.body);
      const ch = model.channel(req.channelId);
      if (!ch || ch.kind !== 'text' || ch.forum) throw bad('Webhooks can post only in text channels');
      if (!model.can(me(request), Permission.MANAGE_CHANNELS, ch.id)) throw forbidden();
      if (model.webhooks.filter((w) => !w.revoked).length >= MAX_WEBHOOKS)
        throw bad(`A community can have up to ${MAX_WEBHOOKS} webhooks`);
      try {
        await db
          .insertInto('webhooks')
          .values({
            id: req.id,
            community_id: model.id,
            channel_id: ch.id,
            sealed: req.sealed,
            token_hash: req.tokenHash,
            created_by: me(request),
            created_at: deps.now().toISOString(),
          })
          .execute();
      } catch {
        throw new HttpError(409, 'conflict', 'Webhook ID already exists');
      }
      await audit(model.id, me(request), 'webhook.create', null, { channel: ch.id });
      changed(model);
      return reply.code(201).send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string; webhook: string } }>(
    `${API_PREFIX}/communities/:id/webhooks/:webhook`,
    authed,
    async (request) => {
      const model = await community(request.params.id, me(request));
      const hook = model.webhooks.find((w) => w.id === request.params.webhook);
      if (!hook) throw notFound();
      if (!model.can(me(request), Permission.MANAGE_CHANNELS, hook.channelId)) throw forbidden();
      // Keep the row (and its sealed key) so earlier posts stay readable; the token stops working.
      await db
        .updateTable('webhooks')
        .set({ revoked: 1, token_hash: null })
        .where('id', '=', hook.id)
        .where('community_id', '=', model.id)
        .execute();
      await audit(model.id, me(request), 'webhook.revoke', null, { channel: hook.channelId });
      changed(model);
      return { ok: true };
    },
  );

  /**
   * Posts per webhook per minute. Charged only once the token is verified, so nobody can use up a
   * webhook's budget by sending bad requests to its (not secret) address. In memory only.
   */
  const WEBHOOK_POSTS_PER_MINUTE = 30;
  const webhookPosts = new Map<string, { count: number; resetAt: number }>();
  const takeWebhookTurn = (hookId: string): boolean => {
    const now = Date.now();
    if (webhookPosts.size > 10_000)
      for (const [k, v] of webhookPosts) if (v.resetAt <= now) webhookPosts.delete(k);
    const bucket = webhookPosts.get(hookId);
    if (!bucket || bucket.resetAt <= now) {
      webhookPosts.set(hookId, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (bucket.count >= WEBHOOK_POSTS_PER_MINUTE) return false;
    bucket.count += 1;
    return true;
  };

  /** Outside services post here with the webhook's token; the body is already sealed. */
  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/webhooks/:id`,
    // Per address for anything (wrong tokens included); per webhook below once the token checks out,
    // so a leaked token used from many machines still cannot flood a channel.
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const unauthorized = new HttpError(401, 'unauthorized', 'Unknown webhook or wrong token');
      const header = request.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!token || token.length > 128) throw unauthorized;
      const hook = await db
        .selectFrom('webhooks')
        .selectAll()
        .where('id', '=', String(request.params.id).slice(0, 64))
        .executeTakeFirst();
      const given = Buffer.from(sha256(token), 'hex');
      const stored = Buffer.from(hook?.token_hash ?? '0'.repeat(64), 'hex');
      if (!hook || hook.revoked || !hook.token_hash || !timingSafeEqual(given, stored)) throw unauthorized;
      if (!takeWebhookTurn(hook.id))
        throw new HttpError(429, 'rate_limited', 'Too many requests. Try again shortly.');
      const model = await loadCommunity(db, hook.community_id);
      const ch = model?.channel(hook.channel_id);
      if (!model || !ch || ch.kind !== 'text' || ch.forum) throw notFound();
      // Posts appear as the webhook's creator: they must still be a member who may manage this
      // channel (not kicked, banned or demoted since), or the webhook is out of service.
      if (!model.member(hook.created_by) || !model.can(hook.created_by, Permission.MANAGE_CHANNELS, ch.id))
        throw new HttpError(
          403,
          'webhook_disabled',
          'The person who made this webhook can no longer post here',
        );
      const req = parse(webhookPostRequestSchema, request.body);
      try {
        await db
          .insertInto('messages')
          .values({
            id: req.id,
            channel_id: ch.id,
            sender: hook.created_by,
            body: req.body,
            sent_at: deps.now().toISOString(),
            pinned: 0,
            thread_id: null,
            webhook_id: hook.id,
          })
          .execute();
      } catch {
        throw new HttpError(409, 'conflict', 'Message ID already exists');
      }
      await pushMessage(model, req.id);
      return reply.code(201).send({ id: req.id });
    },
  );

  // ---- threads ----------------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/messages/:id/thread`,
    authed,
    async (request, reply) => {
      const { model, msg } = await messageContext(request.params.id, me(request));
      if (msg.thread_id) throw bad('A thread cannot start inside another thread');
      if (!model.can(me(request), Permission.SEND_MESSAGES, msg.channel_id)) throw forbidden();
      const req = parse(createThreadRequestSchema, request.body);
      try {
        await db
          .insertInto('threads')
          .values({
            id: msg.id,
            channel_id: msg.channel_id,
            name: req.name,
            creator: me(request),
            created_at: deps.now().toISOString(),
            last_at: null,
          })
          .execute();
      } catch {
        throw new HttpError(409, 'conflict', 'That message already has a thread');
      }
      await pushMessage(model, msg.id);
      return reply.code(201).send({ ok: true });
    },
  );

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/threads/:id`, authed, async (request) => {
    const { model, msg } = await messageContext(request.params.id, me(request));
    const thread = await db.selectFrom('threads').selectAll().where('id', '=', msg.id).executeTakeFirst();
    if (!thread) throw notFound();
    const manager =
      model.can(me(request), Permission.MANAGE_MESSAGES, msg.channel_id) ||
      model.can(me(request), Permission.MANAGE_CHANNELS, msg.channel_id);
    if (thread.creator !== me(request) && !manager) throw forbidden();
    const req = parse(updateThreadRequestSchema, request.body);
    await db
      .updateTable('threads')
      .set({
        ...(req.name !== undefined ? { name: req.name } : {}),
        ...(req.archived !== undefined ? { archived: req.archived ? 1 : 0 } : {}),
      })
      .where('id', '=', thread.id)
      .execute();
    await pushMessage(model, msg.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { before?: string; beforeId?: string } }>(
    `${API_PREFIX}/threads/:id/messages`,
    authed,
    async (request) => {
      const { msg } = await messageContext(request.params.id, me(request));
      let q = messageRows().where('thread_id', '=', msg.id);
      q = beforeCursor(q, request.query.before, request.query.beforeId);
      const rows = await q.orderBy('sent_at', 'desc').orderBy('id', 'desc').limit(PAGE).execute();
      return { messages: await loadMessages(db, rows.reverse()) };
    },
  );

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/messages/:id`, authed, async (request) => {
    const { model, msg } = await messageContext(request.params.id, me(request));
    if (msg.sender !== me(request) || msg.webhook_id) throw forbidden('You can only edit your own messages');
    const req = parse(editMessageRequestSchema, request.body);
    await db
      .updateTable('messages')
      .set({ body: req.body, edited_at: deps.now().toISOString() })
      .where('id', '=', msg.id)
      .execute();
    await pushMessage(model, msg.id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/messages/:id`, authed, async (request) => {
    const { model, msg } = await messageContext(request.params.id, me(request));
    if (msg.sender !== me(request) && !model.can(me(request), Permission.MANAGE_MESSAGES, msg.channel_id))
      throw forbidden();
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('messages').where('thread_id', '=', msg.id).execute();
      await trx.deleteFrom('threads').where('id', '=', msg.id).execute();
      await trx.deleteFrom('messages').where('id', '=', msg.id).execute();
      if (msg.thread_id)
        await trx
          .updateTable('threads')
          .set((eb) => ({ count: eb('count', '-', 1) }))
          .where('id', '=', msg.thread_id)
          .execute();
    });
    if (msg.thread_id) await pushMessage(model, msg.thread_id);
    if (msg.sender !== me(request))
      await audit(model.id, me(request), 'message.delete', msg.sender, { channelId: msg.channel_id });
    hub.sendTo(model.viewers(msg.channel_id), {
      t: 'message.delete',
      communityId: model.id,
      channelId: msg.channel_id,
      messageId: msg.id,
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/channels/:id/messages/bulk-delete`,
    authed,
    async (request) => {
      const { model, channelId } = await channelCommunity(request.params.id, me(request));
      if (!model.can(me(request), Permission.MANAGE_MESSAGES, channelId)) throw forbidden();
      const req = parse(bulkDeleteRequestSchema, request.body);
      const rows = await db
        .selectFrom('messages')
        .select(['id', 'thread_id'])
        .where('channel_id', '=', channelId)
        .where('id', 'in', [...new Set(req.ids)])
        .execute();
      if (!rows.length) return { ok: true, deleted: 0 };
      const ids = rows.map((r) => r.id);
      const touched = new Set<string>();
      await db.transaction().execute(async (trx) => {
        for (const r of rows) {
          await trx.deleteFrom('messages').where('thread_id', '=', r.id).execute();
          await trx.deleteFrom('threads').where('id', '=', r.id).execute();
          if (r.thread_id && !ids.includes(r.thread_id)) {
            touched.add(r.thread_id);
            await trx
              .updateTable('threads')
              .set((eb) => ({ count: eb('count', '-', 1) }))
              .where('id', '=', r.thread_id)
              .execute();
          }
        }
        await trx.deleteFrom('messages').where('id', 'in', ids).execute();
      });
      for (const t of touched) await pushMessage(model, t);
      for (const id of ids)
        hub.sendTo(model.viewers(channelId), {
          t: 'message.delete',
          communityId: model.id,
          channelId,
          messageId: id,
        });
      await audit(model.id, me(request), 'message.bulkDelete', null, { channelId, count: ids.length });
      return { ok: true, deleted: ids.length };
    },
  );

  const setPinned = (pinned: 0 | 1) => async (request: FastifyRequest<{ Params: { id: string } }>) => {
    const { model, msg } = await messageContext(request.params.id, me(request));
    const can =
      model.can(me(request), Permission.PIN_MESSAGES, msg.channel_id) ||
      model.can(me(request), Permission.MANAGE_MESSAGES, msg.channel_id);
    if (!can) throw forbidden();
    await db.updateTable('messages').set({ pinned }).where('id', '=', msg.id).execute();
    await pushMessage(model, msg.id);
    return { ok: true };
  };
  app.put<{ Params: { id: string } }>(`${API_PREFIX}/messages/:id/pin`, authed, setPinned(1));
  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/messages/:id/pin`, authed, setPinned(0));

  app.put<{ Params: { id: string; tag: string } }>(
    `${API_PREFIX}/messages/:id/reactions/:tag`,
    authed,
    async (request) => {
      const { model, msg } = await messageContext(request.params.id, me(request));
      const tag = parse(reactionTagSchema, request.params.tag);
      const existing = await db
        .selectFrom('message_reactions')
        .select('tag')
        .where('message_id', '=', msg.id)
        .where('tag', '=', tag)
        .executeTakeFirst();
      // Joining a reaction that is already there needs no Add reactions (as elsewhere), but a
      // timeout or not yet accepted rules stop that too: those take reacting away entirely.
      const restricted = model.pending(me(request)) || model.timedOut(me(request));
      if (!model.can(me(request), Permission.ADD_REACTIONS, msg.channel_id) && (!existing || restricted))
        throw forbidden();
      // A new kind of reaction only while the message has fewer than MAX_REACTION_KINDS: every
      // load of the message carries them all, so one member must not be able to pile up thousands.
      if (!existing) {
        const kinds = await db
          .selectFrom('message_reactions')
          .select((eb) => eb.fn.count<number>('tag').distinct().as('n'))
          .where('message_id', '=', msg.id)
          .executeTakeFirst();
        if (Number(kinds?.n ?? 0) >= MAX_REACTION_KINDS)
          throw bad(`A message can have up to ${MAX_REACTION_KINDS} different reactions`);
      }
      const req = parse(reactRequestSchema, request.body);
      await db
        .insertInto('message_reactions')
        .values({ message_id: msg.id, river_id: me(request), tag, emoji: req.emoji })
        .onConflict((oc) => oc.columns(['message_id', 'river_id', 'tag']).doNothing())
        .execute();
      await pushMessage(model, msg.id);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string; tag: string } }>(
    `${API_PREFIX}/messages/:id/reactions/:tag`,
    authed,
    async (request) => {
      const { model, msg } = await messageContext(request.params.id, me(request));
      const tag = parse(reactionTagSchema, request.params.tag);
      await db
        .deleteFrom('message_reactions')
        .where('message_id', '=', msg.id)
        .where('tag', '=', tag)
        .where('river_id', '=', me(request))
        .execute();
      await pushMessage(model, msg.id);
      return { ok: true };
    },
  );

  // ---- realtime --------------------------------------------------------------------------------
  /** Tells everyone who shares a community with this person how they appear now. */
  const presence = async (riverId: string): Promise<void> => {
    const status = hub.visibleStatus(riverId);
    const rows = await db
      .selectFrom('community_members')
      .select('community_id')
      .where('river_id', '=', riverId)
      .execute();
    const peers = new Set<string>();
    for (const r of rows) {
      const members = await db
        .selectFrom('community_members')
        .select('river_id')
        .where('community_id', '=', r.community_id)
        .execute();
      for (const m of members) peers.add(m.river_id);
    }
    hub.sendTo(peers, {
      t: 'presence',
      riverId,
      online: status !== null,
      ...(status && status !== 'online' ? { status } : {}),
    });
  };

  app.get(`${API_PREFIX}/ws`, { websocket: true }, (socket) => {
    let riverId: string | null = null;
    let closed = false;
    /** The session this connection signed in with, re-checked now and then (it expires, or is revoked). */
    let token: string | null = null;
    let checkingSession = false;
    const hubSocket: HubSocket = {
      send: (d) => {
        if (socket.readyState !== socket.OPEN) return;
        // A connection that cannot keep up gets no more voice frames rather than an ever-growing buffer.
        if (typeof d !== 'string' && socket.bufferedAmount > MAX_RELAY_BUFFER) return;
        // Events are never dropped (an app would miss a message): one that stopped reading closes
        // instead of holding ever more of the server's memory. Its app reconnects and catches up.
        if (socket.bufferedAmount > (deps.maxEventBuffer ?? MAX_EVENT_BUFFER)) {
          socket.close(4408);
          return;
        }
        socket.send(d);
      },
      close: (c) => socket.close(c),
    };
    const send = (e: ServerEvent): void => hubSocket.send(JSON.stringify(e));
    const authTimer = setTimeout(() => {
      if (!riverId) socket.close(4401);
    }, 10_000);
    // WebSocket-level pings keep the connection busy (proxies and tunnels drop idle ones)
    // and find dead connections, whose voice seats then go into their grace period.
    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      try {
        socket.ping();
      } catch {
        // closing already
      }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
    // A connection lives no longer than its session: expired, signed out or suspended ends it.
    const checkSession = (): void => {
      if (!token || checkingSession || closed) return;
      checkingSession = true;
      const live = token;
      void authenticate(db, live, deps.now())
        .then(async (session) => {
          if (!session && !closed) {
            send({ t: 'error', code: 'unauthorized' });
            socket.close(4401);
            return;
          }
          // Still connected and allowed: keep the session alive instead of ending it once a day.
          if (session) await renewSession(db, live, deps.now(), deps.config.sessionTtlMs);
        })
        .catch(() => undefined)
        .finally(() => {
          checkingSession = false;
        });
    };
    const sessionTimer = setInterval(checkSession, sessionRecheckMs);
    sessionTimer.unref?.();

    const handle = async (raw: Buffer): Promise<void> => {
      let event;
      try {
        event = clientEventSchema.parse(JSON.parse(raw.toString('utf8')));
      } catch {
        send({ t: 'error', code: 'bad_event' });
        return;
      }
      if (event.t === 'auth') {
        if (riverId) return;
        const session = await authenticate(db, event.token, deps.now());
        // The connection may have closed while the session was looked up: a closed socket must
        // never be added to the hub (it would never be removed and keep its account online).
        if (closed || socket.readyState !== socket.OPEN) return;
        if (!session) {
          send({ t: 'error', code: 'unauthorized' });
          socket.close(4401);
          return;
        }
        clearTimeout(authTimer);
        token = event.token;
        riverId = session.riverId;
        hubSocket.deviceId = session.deviceId;
        hub.setStatus(riverId, event.status ?? 'online');
        const cameOnline = hub.add(riverId, hubSocket);
        send({ t: 'ready', riverId });
        const rows = await db
          .selectFrom('community_members')
          .select('community_id')
          .where('river_id', '=', riverId)
          .execute();
        for (const c of rows) {
          for (const room of hub.rooms(c.community_id)) {
            send({
              t: 'voice',
              communityId: c.community_id,
              channelId: room.channelId,
              participants: room.participants,
              states: hub.statesOf(room.channelId),
            });
          }
        }
        if (cameOnline) await presence(riverId);
        return;
      }
      if (!riverId) return send({ t: 'error', code: 'unauthorized' });
      const self = riverId;
      switch (event.t) {
        case 'ping':
          return send({ t: 'pong' });
        case 'presence.set':
          hub.setStatus(self, event.status);
          await presence(self);
          return;
        case 'call.room':
          if (event.room === null) hub.leaveRoom(self);
          else if (!hub.joinRoom(self, event.room, MAX_CALL_ROOM, hubSocket))
            send({ t: 'error', code: 'room_full' });
          return;
        case 'voice.sound': {
          const channelId = hub.voiceChannelOf(self);
          if (!channelId) return send({ t: 'error', code: 'not_in_call' });
          const cid = await communityOfChannel(db, channelId);
          const model = cid ? await loadCommunity(db, cid) : null;
          // Playing a sound is speaking: it needs Speak there, and not being server-muted or timed out.
          if (
            !model ||
            !model.can(self, Permission.SPEAK, channelId) ||
            model.timedOut(self) ||
            hub.stateOf(self).serverMuted
          )
            return send({ t: 'error', code: 'forbidden' });
          const sound = await db
            .selectFrom('community_sounds')
            .select('id')
            .where('id', '=', event.soundId)
            .where('community_id', '=', model.id)
            .executeTakeFirst();
          if (!sound) return send({ t: 'error', code: 'not_found' });
          if (!hub.takeSoundTurn(self, deps.now().getTime(), SOUND_COOLDOWN_MS))
            return send({ t: 'error', code: 'slow_down' });
          hub.sendTo(hub.participants(channelId), {
            t: 'voice.sound',
            communityId: model.id,
            channelId,
            from: self,
            soundId: sound.id,
          });
          return;
        }
        case 'voice.join': {
          const cid = await communityOfChannel(db, event.channelId);
          const model = cid ? await loadCommunity(db, cid) : null;
          const ch = model?.channel(event.channelId);
          if (
            !model ||
            !ch ||
            ch.kind !== 'voice' ||
            !model.can(self, Permission.VIEW_CHANNELS | Permission.CONNECT, ch.id)
          ) {
            return send({ t: 'error', code: 'voice_forbidden' });
          }
          // A full channel turns people away, except those who may move members or were just moved here.
          const inside = hub.participants(ch.id);
          const pass = movePasses.get(self);
          const moved = !!pass && pass.channelId === ch.id && pass.until > Date.now();
          movePasses.delete(self);
          if (
            ch.userLimit > 0 &&
            inside.length >= ch.userLimit &&
            !inside.includes(self) &&
            !moved &&
            !model.can(self, Permission.MOVE_MEMBERS, ch.id)
          ) {
            return send({ t: 'error', code: 'voice_full' });
          }
          const rejoin = hub.voiceChannelOf(self) === ch.id;
          // This connection holds the seat: if it drops, the seat is held for the grace period even
          // while the person's other devices stay connected.
          const { left } = hub.joinVoice(self, model.id, ch.id, hubSocket);
          // Stages: the audience listens. Moderators (who may mute members) speak; others raise a hand.
          if (!rejoin) {
            const moderator = model.can(self, Permission.MUTE_MEMBERS, ch.id);
            if (ch.stage && !moderator) {
              if (!hub.stateOf(self).serverMuted) hub.stageMuted.add(self);
              hub.setState(self, { serverMuted: true, handRaised: false });
            } else if (hub.stageMuted.delete(self)) {
              hub.setState(self, { serverMuted: false, handRaised: false });
            }
          }
          if (left) await voiceUpdate(left.communityId, left.channelId);
          await voiceUpdate(model.id, ch.id);
          return;
        }
        case 'voice.leave': {
          const left = hub.leaveVoice(self);
          if (left) await voiceUpdate(left.communityId, left.channelId);
          return;
        }
        case 'voice.state': {
          const channelId = hub.voiceChannelOf(self);
          if (!channelId) return;
          hub.setState(self, { muted: event.muted, deafened: event.deafened, streaming: event.streaming });
          const cid = await communityOfChannel(db, channelId);
          if (event.handRaised !== undefined && cid) {
            // Hands are only for the audience of a stage.
            const model = await loadCommunity(db, cid);
            const onStage = !!model?.channel(channelId)?.stage;
            hub.setState(self, { handRaised: onStage && hub.stateOf(self).serverMuted && event.handRaised });
          }
          if (cid) await voiceUpdate(cid, channelId);
          return;
        }
        case 'voice.moderate': {
          const channelId = hub.voiceChannelOf(event.target);
          if (!channelId) return;
          const cid = await communityOfChannel(db, channelId);
          const model = cid ? await loadCommunity(db, cid) : null;
          if (!model || !model.outranks(self, event.target)) return send({ t: 'error', code: 'forbidden' });
          if (event.serverMuted !== undefined) {
            if (!model.can(self, Permission.MUTE_MEMBERS, channelId))
              return send({ t: 'error', code: 'forbidden' });
            hub.setState(event.target, { serverMuted: event.serverMuted });
          }
          if (event.serverDeafened !== undefined) {
            if (!model.can(self, Permission.MUTE_MEMBERS, channelId))
              return send({ t: 'error', code: 'forbidden' });
            hub.setState(event.target, { serverDeafened: event.serverDeafened });
          }
          if (event.speaker !== undefined) {
            if (!model.channel(channelId)?.stage || !model.can(self, Permission.MUTE_MEMBERS, channelId))
              return send({ t: 'error', code: 'forbidden' });
            hub.setState(event.target, { serverMuted: !event.speaker, handRaised: false });
            if (event.speaker) hub.stageMuted.delete(event.target);
            else hub.stageMuted.add(event.target);
          }
          if (event.moveTo !== undefined) {
            // Moving needs Move members in both channels, and the person must be allowed to connect there.
            const dest = model.channel(event.moveTo);
            if (
              !dest ||
              dest.kind !== 'voice' ||
              dest.id === channelId ||
              !model.can(self, Permission.MOVE_MEMBERS, channelId) ||
              !model.can(self, Permission.MOVE_MEMBERS, dest.id) ||
              !model.can(event.target, Permission.VIEW_CHANNELS | Permission.CONNECT, dest.id)
            )
              return send({ t: 'error', code: 'forbidden' });
            hub.leaveVoice(event.target);
            // A moved member may join even if the channel is full, once, for a short while.
            movePasses.set(event.target, { channelId: dest.id, until: Date.now() + 30_000 });
            // Apps before 1.0.39 ignore `moveTo` and just leave the call.
            hub.sendTo([event.target], { t: 'voice.disconnect', moveTo: dest.id });
            await audit(model.id, self, 'voice.move', event.target, { from: channelId, to: dest.id });
          } else if (event.disconnect) {
            if (!model.can(self, Permission.MOVE_MEMBERS, channelId))
              return send({ t: 'error', code: 'forbidden' });
            hub.leaveVoice(event.target);
            hub.sendTo([event.target], { t: 'voice.disconnect' });
          }
          await voiceUpdate(model.id, channelId);
          return;
        }
        case 'signal': {
          const channelId = hub.voiceChannelOf(self);
          if (!channelId || hub.voiceChannelOf(event.to) !== channelId)
            return send({ t: 'error', code: 'not_in_call' });
          hub.sendTo([event.to], { t: 'signal', from: self, channelId, data: event.data });
          return;
        }
        case 'typing': {
          const cid = await communityOfChannel(db, event.channelId);
          const model = cid ? await loadCommunity(db, cid) : null;
          if (!model || !model.can(self, Permission.SEND_MESSAGES, event.channelId)) return;
          hub.sendTo(
            model.viewers(event.channelId).filter((id) => id !== self),
            { t: 'typing', communityId: model.id, channelId: event.channelId, riverId: self },
          );
          return;
        }
      }
    };

    // Token bucket: bursts of call setup are fine, sustained floods close the socket.
    let tokens = SOCKET_BURST;
    let refilled = Date.now();
    // Voice relay frames have their own budget: ~50 a second while talking is normal.
    let relayTokens = RELAY_BURST;
    let relayRefilled = Date.now();
    const relay = (raw: Buffer): void => {
      const now = Date.now();
      relayTokens = Math.min(
        RELAY_BURST,
        relayTokens + ((now - relayRefilled) / 1000) * RELAY_FRAMES_PER_SECOND,
      );
      relayRefilled = now;
      if (relayTokens < 1 || !riverId) return; // over budget: drop (audio tolerates loss)
      relayTokens -= 1;
      const frame = decodeRelayOut(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
      if (!frame) return;
      const sender = riverId;
      const out = Buffer.from(encodeRelayIn(sender, frame.payload));
      for (const to of new Set(frame.recipients)) if (hub.sharesCall(sender, to)) hub.sendBinaryTo(to, out);
    };
    let queue: Promise<void> = Promise.resolve();
    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      alive = true;
      if (isBinary) {
        relay(raw);
        return;
      }
      const now = Date.now();
      tokens = Math.min(SOCKET_BURST, tokens + ((now - refilled) / 1000) * SOCKET_RATE);
      refilled = now;
      if (tokens < 1) {
        socket.close(4429, 'Too many events');
        return;
      }
      tokens -= 1;
      // One event at a time per connection, in the order sent: a voice.join still waiting for the
      // database must not finish after a voice.leave sent behind it.
      queue = queue.then(() => handle(raw).catch(() => send({ t: 'error', code: 'internal' })));
    });

    socket.on('close', () => {
      closed = true;
      clearTimeout(authTimer);
      clearInterval(heartbeat);
      clearInterval(sessionTimer);
      if (!riverId) return;
      const gone = riverId;
      const { offline, held } = hub.remove(gone, hubSocket);
      // Background updates after a disconnect must never crash the server (e.g. during shutdown).
      // A held seat shows as "reconnecting" until the app rejoins or the grace period ends.
      if (held) void voiceUpdate(held.communityId, held.channelId).catch(() => undefined);
      if (offline) {
        // Brief drops (a tunnel reconnecting) should not flash everyone offline.
        const t = setTimeout(() => {
          if (!hub.isOnline(gone)) void presence(gone).catch(() => undefined);
        }, PRESENCE_GRACE_MS);
        t.unref?.();
      }
    });
  });

  // A link to a message, opened in a browser: explain where it opens (it reveals nothing).
  app.get('/channels/*', async (_request, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'");
    return reply.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>River message</title>
<body style="font-family:system-ui,sans-serif;background:#05070d;color:#e7ecf8;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="max-width:520px;padding:24px;line-height:1.5"><h1 style="margin:0 0 12px">This is a link to a River message</h1>
<p>Paste it into River to open the message. Only members of its community can read it: messages are end-to-end encrypted and this server cannot show them.</p></main></body>`);
  });

  return {
    removeEverywhere: async (riverId) => {
      const rows = await db
        .selectFrom('community_members')
        .select('community_id')
        .where('river_id', '=', riverId)
        .execute();
      for (const r of rows) {
        const model = await loadCommunity(db, r.community_id);
        if (!model) continue;
        if (model.ownerId === riverId) await deleteCommunity(model);
        else await removeMember(model, riverId, 'kicked', riverId);
      }
    },
    deleteCommunity: async (communityId) => {
      const model = await loadCommunity(db, communityId);
      if (!model) return false;
      await deleteCommunity(model);
      return true;
    },
  };
}
