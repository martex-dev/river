import { createHash, randomBytes } from 'node:crypto';
import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  API_PREFIX,
  DEFAULT_EVERYONE,
  Permission,
  channelIdSchema,
  clientEventSchema,
  communityIdSchema,
  createChannelRequestSchema,
  createCommunityRequestSchema,
  createRoleRequestSchema,
  editMessageRequestSchema,
  joinRequestSchema,
  memberRolesRequestSchema,
  messageIdSchema,
  profileRequestSchema,
  reactRequestSchema,
  reactionTagSchema,
  riverIdSchema,
  roleIdSchema,
  sendMessageRequestSchema,
  updateChannelRequestSchema,
  updateCommunityRequestSchema,
  updateRoleRequestSchema,
  type ServerEvent,
} from '@river/protocol';
import { authenticate } from '../accounts/auth-store.ts';
import { Hub, type HubSocket } from '../communities/hub.ts';
import type { CommunityModel} from '../communities/model.ts';
import { communityOfChannel, loadCommunity, loadMessages } from '../communities/model.ts';
import type { ServerConfig } from '../config.ts';
import { HttpError } from '../http-error.ts';
import type { RiverDatabase } from '../db/database.ts';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_MAX_USES = 100;
const MAX_CHANNELS = 100;
const MAX_ROLES = 100;
const PAGE = 100;

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
export async function registerCommunityRoutes(
  app: FastifyInstance,
  deps: { config: ServerConfig; database: RiverDatabase; now: () => Date },
): Promise<void> {
  const { db } = deps.database;
  const hub = new Hub();
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  const requireSession = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = token ? await authenticate(db, token, deps.now()) : null;
    if (!session) {
      await reply.code(401).send({ error: { code: 'unauthorized', message: 'A valid session is required' } });
      return;
    }
    request.session = session;
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
  const pushMessage = async (model: CommunityModel, messageId: string): Promise<void> => {
    const row = await db.selectFrom('messages').selectAll().where('id', '=', messageId).executeTakeFirst();
    if (!row) return;
    const [message] = await loadMessages(db, [row]);
    hub.sendTo(model.viewers(row.channel_id), { t: 'message', communityId: model.id, message: message! });
  };
  const removeMember = async (
    model: CommunityModel,
    riverId: string,
    reason: 'kicked' | 'banned' | 'left',
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
    });
    if (hub.voiceChannelOf(riverId) && model.channel(hub.voiceChannelOf(riverId)!)) {
      const left = hub.leaveVoice(riverId);
      hub.sendTo([riverId], { t: 'voice.disconnect' });
      if (left) await voiceUpdate(left.communityId, left.channelId);
    }
    hub.sendTo([riverId], { t: 'removed', communityId: model.id, reason });
    changed(model);
  };

  // ---- communities ---------------------------------------------------------------------------
  app.get(`${API_PREFIX}/communities`, authed, async (request) => {
    const rows = await db
      .selectFrom('community_members')
      .select('community_id')
      .where('river_id', '=', me(request))
      .execute();
    const models = await Promise.all(rows.map((r) => loadCommunity(db, r.community_id)));
    return {
      communities: models
        .filter((m): m is CommunityModel => m !== null)
        .map((m) => m.wireFor(me(request), (id) => hub.isOnline(id))),
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
    return reply.code(201).send(model!.wireFor(me(request), (id) => hub.isOnline(id)));
  });

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    if (!model.can(me(request), Permission.MANAGE_COMMUNITY)) throw forbidden();
    const req = parse(updateCommunityRequestSchema, request.body);
    await db.updateTable('communities').set({ meta: req.meta }).where('id', '=', model.id).execute();
    changed(model);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    if (model.ownerId !== me(request)) throw forbidden('Only the owner can delete the community');
    for (const m of model.members)
      hub.sendTo([m.riverId], { t: 'removed', communityId: model.id, reason: 'deleted' });
    await db.deleteFrom('communities').where('id', '=', model.id).execute();
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
      member: { riverId: m.riverId, role: m.legacyRole, roles: m.roles, profile: req.profile, online: true },
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
      const position = model.channels.length;
      try {
        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto('channels')
            .values({ id: req.id, community_id: model.id, kind: req.kind, name: req.name, position })
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
      changed(model);
      return reply
        .code(201)
        .send({ id: req.id, kind: req.kind, name: req.name, position, overwrites: req.overwrites ?? [] });
    },
  );

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/channels/:id`, authed, async (request) => {
    const { model, channelId } = await channelCommunity(request.params.id, me(request));
    if (!model.can(me(request), Permission.MANAGE_CHANNELS, channelId)) throw forbidden();
    const req = parse(updateChannelRequestSchema, request.body);
    await db.transaction().execute(async (trx) => {
      if (req.name !== undefined || req.position !== undefined) {
        await trx
          .updateTable('channels')
          .set({
            ...(req.name !== undefined ? { name: req.name } : {}),
            ...(req.position !== undefined ? { position: req.position } : {}),
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
    changed(model);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/channels/:id`, authed, async (request) => {
    const { model, channelId } = await channelCommunity(request.params.id, me(request));
    if (!model.can(me(request), Permission.MANAGE_CHANNELS, channelId)) throw forbidden();
    if (model.channels.length <= 1) throw bad('A community needs at least one channel');
    for (const id of hub.participants(channelId)) {
      hub.leaveVoice(id);
      hub.sendTo([id], { t: 'voice.disconnect' });
    }
    await db.deleteFrom('channels').where('id', '=', channelId).execute();
    changed(model);
    return { ok: true };
  });

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
    if (model.role(roleId)!.position >= model.top(me(request)))
      throw forbidden('You can only delete roles below your own');
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('channel_overwrites').where('role_id', '=', roleId).execute();
      await trx.deleteFrom('roles').where('id', '=', roleId).execute();
    });
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
      await db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom('member_roles')
          .where('community_id', '=', model.id)
          .where('river_id', '=', target)
          .execute();
        for (const id of after)
          await trx
            .insertInto('member_roles')
            .values({ community_id: model.id, river_id: target, role_id: id })
            .execute();
      });
      changed(model);
      return { ok: true };
    },
  );

  // ---- moderation ------------------------------------------------------------------------------
  app.delete<{ Params: { id: string; member: string } }>(
    `${API_PREFIX}/communities/:id/members/:member`,
    authed,
    async (request) => {
      const model = await community(request.params.id, me(request));
      const target = parse(riverIdSchema, request.params.member);
      if (!model.member(target)) throw notFound();
      if (!model.can(me(request), Permission.KICK_MEMBERS) || !model.outranks(me(request), target))
        throw forbidden();
      await removeMember(model, target, 'kicked');
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
      await db
        .insertInto('bans')
        .values({ community_id: model.id, river_id: target, banned_on: day(deps.now()) })
        .onConflict((oc) => oc.columns(['community_id', 'river_id']).doNothing())
        .execute();
      if (model.member(target)) await removeMember(model, target, 'banned');
      return { ok: true };
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
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/communities/:id/bans`, authed, async (request) => {
    const model = await community(request.params.id, me(request));
    if (!model.can(me(request), Permission.BAN_MEMBERS)) throw forbidden();
    const rows = await db
      .selectFrom('bans')
      .select(['river_id', 'banned_on'])
      .where('community_id', '=', model.id)
      .execute();
    return { bans: rows.map((r) => ({ riverId: r.river_id, bannedOn: r.banned_on })) };
  });

  // ---- invites ---------------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/invites`,
    { ...authed, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const model = await community(request.params.id, me(request));
      if (!model.can(me(request), Permission.CREATE_INVITE)) throw forbidden();
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
        })
        .execute();
      return reply.code(201).send({ code, expiresAt });
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
        .select('river_id')
        .where('community_id', '=', invite.community_id)
        .where('river_id', '=', me(request))
        .executeTakeFirst();
      if (banned) throw new HttpError(403, 'banned', 'You are banned from this community');
      let model = (await loadCommunity(db, invite.community_id))!;
      if (!model.member(me(request))) {
        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto('community_members')
            .values({
              community_id: model.id,
              river_id: me(request),
              role: 'member',
              profile: req.profile,
              joined_on: day(now),
            })
            .execute();
          await trx
            .updateTable('invites')
            .set({ uses: invite.uses + 1 })
            .where('code_hash', '=', invite.code_hash)
            .execute();
        });
        model = (await loadCommunity(db, invite.community_id))!;
        toMembers(model, {
          t: 'member',
          communityId: model.id,
          member: { riverId: me(request), role: 'member', roles: [], profile: req.profile, online: true },
        });
      }
      return model.wireFor(me(request), (id) => hub.isOnline(id));
    },
  );

  // ---- messages --------------------------------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { before?: string; pinned?: string } }>(
    `${API_PREFIX}/channels/:id/messages`,
    authed,
    async (request) => {
      const { channelId } = await channelCommunity(request.params.id, me(request));
      let q = db.selectFrom('messages').selectAll().where('channel_id', '=', channelId);
      const before = request.query.before;
      if (before && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before)) q = q.where('sent_at', '<', before);
      if (request.query.pinned === '1') q = q.where('pinned', '=', 1);
      const rows = await q.orderBy('sent_at', 'desc').limit(PAGE).execute();
      return { messages: await loadMessages(db, rows.reverse()) };
    },
  );

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/channels/:id/messages`,
    { ...authed, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { model, channelId } = await channelCommunity(request.params.id, me(request));
      const ch = model.channel(channelId)!;
      if (ch.kind !== 'text') throw notFound();
      if (!model.can(me(request), Permission.SEND_MESSAGES, channelId))
        throw forbidden('You cannot send messages here');
      const req = parse(sendMessageRequestSchema, request.body);
      try {
        await db
          .insertInto('messages')
          .values({
            id: req.id,
            channel_id: channelId,
            sender: me(request),
            body: req.body,
            sent_at: deps.now().toISOString(),
            pinned: 0,
          })
          .execute();
      } catch {
        throw new HttpError(409, 'conflict', 'Message ID already exists');
      }
      await pushMessage(model, req.id);
      const row = await db
        .selectFrom('messages')
        .selectAll()
        .where('id', '=', req.id)
        .executeTakeFirstOrThrow();
      return reply.code(201).send((await loadMessages(db, [row]))[0]);
    },
  );

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/messages/:id`, authed, async (request) => {
    const { model, msg } = await messageContext(request.params.id, me(request));
    if (msg.sender !== me(request)) throw forbidden('You can only edit your own messages');
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
    await db.deleteFrom('messages').where('id', '=', msg.id).execute();
    hub.sendTo(model.viewers(msg.channel_id), {
      t: 'message.delete',
      communityId: model.id,
      channelId: msg.channel_id,
      messageId: msg.id,
    });
    return { ok: true };
  });

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
      if (!existing && !model.can(me(request), Permission.ADD_REACTIONS, msg.channel_id)) throw forbidden();
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
  const presence = async (riverId: string, online: boolean): Promise<void> => {
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
    hub.sendTo(peers, { t: 'presence', riverId, online });
  };

  app.get(`${API_PREFIX}/ws`, { websocket: true }, (socket) => {
    let riverId: string | null = null;
    const hubSocket: HubSocket = {
      send: (d) => {
        if (socket.readyState === socket.OPEN) socket.send(d);
      },
      close: (c) => socket.close(c),
    };
    const send = (e: ServerEvent): void => hubSocket.send(JSON.stringify(e));
    const authTimer = setTimeout(() => {
      if (!riverId) socket.close(4401);
    }, 10_000);

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
        if (!session) {
          send({ t: 'error', code: 'unauthorized' });
          socket.close(4401);
          return;
        }
        clearTimeout(authTimer);
        riverId = session.riverId;
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
        if (cameOnline) await presence(riverId, true);
        return;
      }
      if (!riverId) return send({ t: 'error', code: 'unauthorized' });
      const self = riverId;
      switch (event.t) {
        case 'ping':
          return send({ t: 'pong' });
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
            return send({ t: 'error', code: 'forbidden' });
          }
          const { left } = hub.joinVoice(self, model.id, ch.id);
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
          if (event.disconnect) {
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

    socket.on('message', (raw: Buffer) => {
      void handle(raw).catch(() => send({ t: 'error', code: 'internal' }));
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      if (!riverId) return;
      const { offline, left } = hub.remove(riverId, hubSocket);
      if (left) void voiceUpdate(left.communityId, left.channelId);
      if (offline) void presence(riverId, false);
    });
  });

  app.get('/join', async (_request, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'");
    return reply.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>River invite</title>
<body style="font-family:system-ui,sans-serif;background:#05070d;color:#e7ecf8;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="max-width:520px;padding:24px;line-height:1.5"><h1 style="margin:0 0 12px">You're invited to a River community</h1>
<ol><li>Install River: <a style="color:#4fe3d1" href="https://github.com/martex-dev/river/releases/latest">github.com/martex-dev/river/releases/latest</a></li>
<li>Open River and create your identity.</li><li>Go to <b>Communities → Join with an invite link</b> and paste this page's full address.</li></ol>
<p style="color:#9ca8c6">The secret part of this link never reaches this server.</p></main></body>`);
  });
}
