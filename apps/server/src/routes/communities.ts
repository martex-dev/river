import { createHash, randomBytes } from 'node:crypto';
import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import {
  API_PREFIX,
  channelIdSchema,
  clientEventSchema,
  communityIdSchema,
  createChannelRequestSchema,
  createCommunityRequestSchema,
  joinRequestSchema,
  profileRequestSchema,
  sendMessageRequestSchema,
  type CommunityWire,
  type ErrorResponse,
  type MessageWire,
  type ServerEvent,
} from '@river/protocol';
import { authenticate } from '../accounts/auth-store.ts';
import { Hub, type HubSocket } from '../communities/hub.ts';
import type { ServerConfig } from '../config.ts';
import type { RiverDatabase } from '../db/database.ts';
import type { Database } from '../db/schema.ts';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_MAX_USES = 100;
const MAX_CHANNELS = 50;
const PAGE = 100;

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const day = (d: Date): string => d.toISOString().slice(0, 10);

function fail(reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  const body: ErrorResponse = { error: { code, message } };
  return reply.code(status).send(body);
}

async function memberRole(
  db: Kysely<Database>,
  communityId: string,
  riverId: string,
): Promise<string | null> {
  const row = await db
    .selectFrom('community_members')
    .select('role')
    .where('community_id', '=', communityId)
    .where('river_id', '=', riverId)
    .executeTakeFirst();
  return row?.role ?? null;
}

async function memberIds(db: Kysely<Database>, communityId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('community_members')
    .select('river_id')
    .where('community_id', '=', communityId)
    .execute();
  return rows.map((r) => r.river_id);
}

async function loadCommunity(db: Kysely<Database>, id: string): Promise<CommunityWire> {
  const c = await db
    .selectFrom('communities')
    .select(['id', 'meta'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  const channels = await db
    .selectFrom('channels')
    .select(['id', 'kind', 'name', 'position'])
    .where('community_id', '=', id)
    .orderBy('position')
    .execute();
  const members = await db
    .selectFrom('community_members')
    .select(['river_id', 'role', 'profile'])
    .where('community_id', '=', id)
    .execute();
  return {
    id: c.id,
    meta: c.meta,
    channels: channels.map((ch) => ({
      id: ch.id,
      kind: ch.kind as 'text' | 'voice',
      name: ch.name,
      position: ch.position,
    })),
    members: members.map((m) => ({
      riverId: m.river_id,
      role: m.role as 'owner' | 'admin' | 'member',
      profile: m.profile,
    })),
  };
}

/** Communities, channels, messages, invites and the realtime socket (protocol v1). */
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
      await fail(reply, 401, 'unauthorized', 'A valid session is required');
      return;
    }
    request.session = session;
  };
  const authed = { preHandler: requireSession };
  const me = (r: FastifyRequest): string => r.session!.riverId;

  const broadcast = async (communityId: string, event: ServerEvent): Promise<void> => {
    hub.sendTo(await memberIds(db, communityId), event);
  };
  const broadcastVoice = async (communityId: string, channelId: string): Promise<void> => {
    await broadcast(communityId, {
      t: 'voice',
      communityId,
      channelId,
      participants: hub.participants(channelId),
    });
  };

  app.get(`${API_PREFIX}/communities`, authed, async (request) => {
    const rows = await db
      .selectFrom('community_members')
      .select('community_id')
      .where('river_id', '=', me(request))
      .execute();
    return { communities: await Promise.all(rows.map((r) => loadCommunity(db, r.community_id))) };
  });

  app.post(`${API_PREFIX}/communities`, authed, async (request, reply) => {
    const parsed = createCommunityRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
    const req = parsed.data;
    if (new Set(req.channels.map((c) => c.id)).size !== req.channels.length) {
      return fail(reply, 400, 'bad_request', 'Duplicate channel IDs');
    }
    const today = day(deps.now());
    try {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('communities')
          .values({ id: req.id, owner: me(request), meta: req.meta, created_on: today })
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
      return fail(reply, 409, 'conflict', 'Community or channel ID already exists');
    }
    return reply.code(201).send(await loadCommunity(db, req.id));
  });

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/channels`,
    authed,
    async (request, reply) => {
      const id = communityIdSchema.safeParse(request.params.id);
      const parsed = createChannelRequestSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
      const role = await memberRole(db, id.data, me(request));
      if (role !== 'owner' && role !== 'admin')
        return fail(reply, 403, 'forbidden', 'Only owners and admins can add channels');
      const count = await db
        .selectFrom('channels')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('community_id', '=', id.data)
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= MAX_CHANNELS) return fail(reply, 400, 'limit', 'Too many channels');
      const channel = {
        id: parsed.data.id,
        kind: parsed.data.kind,
        name: parsed.data.name,
        position: Number(count.n),
      };
      try {
        await db
          .insertInto('channels')
          .values({ ...channel, community_id: id.data })
          .execute();
      } catch {
        return fail(reply, 409, 'conflict', 'Channel ID already exists');
      }
      await broadcast(id.data, { t: 'channel', communityId: id.data, channel });
      return reply.code(201).send(channel);
    },
  );

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/invites`,
    { ...authed, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const id = communityIdSchema.safeParse(request.params.id);
      if (!id.success) return fail(reply, 400, 'bad_request', 'Bad request');
      const role = await memberRole(db, id.data, me(request));
      if (role !== 'owner' && role !== 'admin')
        return fail(reply, 403, 'forbidden', 'Only owners and admins can invite');
      const code = randomBytes(16).toString('base64url');
      const expiresAt = new Date(deps.now().getTime() + INVITE_TTL_MS).toISOString();
      await db
        .insertInto('invites')
        .values({
          code_hash: sha256(code),
          community_id: id.data,
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
    async (request, reply) => {
      const parsed = joinRequestSchema.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
      const now = deps.now();
      const invite = await db
        .selectFrom('invites')
        .selectAll()
        .where('code_hash', '=', sha256(parsed.data.code))
        .where('expires_at', '>', now.toISOString())
        .executeTakeFirst();
      if (!invite || invite.uses >= invite.max_uses)
        return fail(reply, 404, 'invalid_invite', 'This invite is invalid or expired');
      const communityId = invite.community_id;
      if (!(await memberRole(db, communityId, me(request)))) {
        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto('community_members')
            .values({
              community_id: communityId,
              river_id: me(request),
              role: 'member',
              profile: parsed.data.profile,
              joined_on: day(now),
            })
            .execute();
          await trx
            .updateTable('invites')
            .set({ uses: invite.uses + 1 })
            .where('code_hash', '=', invite.code_hash)
            .execute();
        });
        await broadcast(communityId, {
          t: 'member',
          communityId,
          member: { riverId: me(request), role: 'member', profile: parsed.data.profile },
        });
      }
      return loadCommunity(db, communityId);
    },
  );

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/communities/:id/profile`,
    authed,
    async (request, reply) => {
      const id = communityIdSchema.safeParse(request.params.id);
      const parsed = profileRequestSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
      const role = await memberRole(db, id.data, me(request));
      if (!role) return fail(reply, 404, 'not_found', 'Not found');
      await db
        .updateTable('community_members')
        .set({ profile: parsed.data.profile })
        .where('community_id', '=', id.data)
        .where('river_id', '=', me(request))
        .execute();
      await broadcast(id.data, {
        t: 'member',
        communityId: id.data,
        member: {
          riverId: me(request),
          role: role as 'owner' | 'admin' | 'member',
          profile: parsed.data.profile,
        },
      });
      return { ok: true };
    },
  );

  const channelAccess = async (channelId: string, riverId: string) => {
    const ch = await db
      .selectFrom('channels')
      .select(['community_id', 'kind'])
      .where('id', '=', channelId)
      .executeTakeFirst();
    if (!ch) return null;
    return (await memberRole(db, ch.community_id, riverId)) ? ch : null;
  };

  app.get<{ Params: { id: string }; Querystring: { before?: string } }>(
    `${API_PREFIX}/channels/:id/messages`,
    authed,
    async (request, reply) => {
      const id = channelIdSchema.safeParse(request.params.id);
      if (!id.success) return fail(reply, 400, 'bad_request', 'Bad request');
      if (!(await channelAccess(id.data, me(request)))) return fail(reply, 404, 'not_found', 'Not found');
      let q = db
        .selectFrom('messages')
        .select(['id', 'channel_id', 'sender', 'body', 'sent_at'])
        .where('channel_id', '=', id.data);
      const before = request.query.before;
      if (before && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before)) q = q.where('sent_at', '<', before);
      const rows = await q.orderBy('sent_at', 'desc').limit(PAGE).execute();
      const messages: MessageWire[] = rows.reverse().map((r) => ({
        id: r.id,
        channelId: r.channel_id,
        sender: r.sender,
        body: r.body,
        sentAt: r.sent_at,
      }));
      return { messages };
    },
  );

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/channels/:id/messages`,
    { ...authed, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const id = channelIdSchema.safeParse(request.params.id);
      const parsed = sendMessageRequestSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
      const ch = await channelAccess(id.data, me(request));
      if (!ch || ch.kind !== 'text') return fail(reply, 404, 'not_found', 'Not found');
      const message: MessageWire = {
        id: parsed.data.id,
        channelId: id.data,
        sender: me(request),
        body: parsed.data.body,
        sentAt: deps.now().toISOString(),
      };
      try {
        await db
          .insertInto('messages')
          .values({
            id: message.id,
            channel_id: message.channelId,
            sender: message.sender,
            body: message.body,
            sent_at: message.sentAt,
          })
          .execute();
      } catch {
        return fail(reply, 409, 'conflict', 'Message ID already exists');
      }
      await broadcast(ch.community_id, { t: 'message', communityId: ch.community_id, message });
      return reply.code(201).send(message);
    },
  );

  // ---- Realtime ------------------------------------------------------------------------------
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

    socket.on('message', (raw: Buffer) => {
      void (async () => {
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
          hub.add(riverId, hubSocket);
          send({ t: 'ready', riverId });
          const communities = await db
            .selectFrom('community_members')
            .select('community_id')
            .where('river_id', '=', riverId)
            .execute();
          for (const c of communities) {
            for (const room of hub.rooms(c.community_id)) {
              send({
                t: 'voice',
                communityId: c.community_id,
                channelId: room.channelId,
                participants: room.participants,
              });
            }
          }
          return;
        }
        if (!riverId) {
          send({ t: 'error', code: 'unauthorized' });
          return;
        }
        if (event.t === 'ping') return send({ t: 'pong' });
        if (event.t === 'voice.join') {
          const ch = await channelAccess(event.channelId, riverId);
          if (!ch || ch.kind !== 'voice') return send({ t: 'error', code: 'not_found' });
          const { left } = hub.joinVoice(riverId, ch.community_id, event.channelId);
          if (left) await broadcastVoice(left.communityId, left.channelId);
          await broadcastVoice(ch.community_id, event.channelId);
          return;
        }
        if (event.t === 'voice.leave') {
          const left = hub.leaveVoice(riverId);
          if (left) await broadcastVoice(left.communityId, left.channelId);
          return;
        }
        if (event.t === 'signal') {
          // Only between two people in the same voice channel. The payload is ciphertext.
          const channelId = hub.voiceChannelOf(riverId);
          if (!channelId || hub.voiceChannelOf(event.to) !== channelId)
            return send({ t: 'error', code: 'not_in_call' });
          hub.sendTo([event.to], { t: 'signal', from: riverId, channelId, data: event.data });
        }
      })();
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      if (!riverId) return;
      const left = hub.remove(riverId, hubSocket);
      if (left) void broadcastVoice(left.communityId, left.channelId);
    });
  });

  // A friendly page for people who open an invite link in a browser. The code
  // and key live in the URL fragment, which browsers never send to the server.
  app.get('/join', async (_request, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'");
    return reply.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>River invite</title>
<body style="font-family:system-ui,sans-serif;background:#05070d;color:#e7ecf8;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="max-width:520px;padding:24px;line-height:1.5"><h1 style="margin:0 0 12px">You're invited to a River community</h1>
<ol><li>Install River: <a style="color:#4fe3d1" href="https://github.com/martex-dev/river/releases/latest">github.com/martex-dev/river/releases/latest</a></li>
<li>Open River and create your identity.</li><li>Go to <b>Communities → Join with invite link</b> and paste this page's full address.</li></ol>
<p style="color:#9ca8c6">The secret part of this link never reaches this server.</p></main></body>`);
  });
}
