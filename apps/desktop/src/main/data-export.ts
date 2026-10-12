import type { LocalDatabase } from './storage/database.ts';
import type { Settings } from '../shared/settings.ts';

/**
 * "Export my data" (1.0.23): a readable copy of what this device keeps about
 * you, as JSON. It never includes keys, sessions or tokens — only what you
 * could read in River yourself: your profile, settings, contacts, direct
 * messages, groups, calls, your posts and saved messages.
 *
 * Messages in communities live on your server (encrypted); the export lists
 * the communities you are in and your saved messages from them.
 */
export interface DataExport {
  format: 'river-export-1';
  exportedAt: string;
  app: { version: string };
  you: { riverId: string; name: string | null; createdAt: string; server: string | null };
  settings: Settings;
  contacts: Array<{ riverId: string; name: string | null; state: string; since: string; bio: string | null }>;
  directMessages: Array<{
    with: string;
    withName: string | null;
    messages: Array<{ from: string; text: string; sentAt: string; editedAt: string | null; files: string[] }>;
  }>;
  groups: Array<{ id: string; name: string; members: string[]; state: string; createdAt: string }>;
  calls: Array<{
    with: string;
    direction: string;
    video: boolean;
    startedAt: string;
    answered: boolean;
    seconds: number;
  }>;
  posts: Array<{
    kind: string;
    text: string;
    createdAt: string;
    comments: Array<{ from: string; text: string; at: string }>;
  }>;
  communities: Array<{ id: string; joinedAt: string; nickname: string | null }>;
  savedMessages: Array<{
    community: string;
    channel: string;
    from: string;
    text: string;
    sentAt: string;
    savedAt: string;
  }>;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Reads the text and file names out of a stored message body (JSON or plain text). */
export function readBody(raw: unknown): { text: string; files: string[] } {
  const s = str(raw);
  try {
    const body = JSON.parse(s) as { text?: unknown; attachments?: unknown };
    if (body && typeof body === 'object') {
      const files = Array.isArray(body.attachments)
        ? body.attachments.flatMap((a) =>
            a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string'
              ? [(a as { name: string }).name]
              : [],
          )
        : [];
      return { text: str(body.text), files };
    }
  } catch {
    // older rows: plain text
  }
  return { text: s, files: [] };
}

function rows(db: LocalDatabase, sql: string, ...params: string[]): Row[] {
  try {
    return db.prepare(sql).all(...params) as Row[];
  } catch {
    // A table this device never created (e.g. a feature not used yet).
    return [];
  }
}

export function buildExport(
  db: LocalDatabase,
  settings: Settings,
  version: string,
  now = new Date(),
): DataExport {
  const identity = rows(db, 'SELECT river_id, display_name, created_at FROM identity WHERE id = 1')[0] ?? {};
  const account = rows(db, 'SELECT server_url FROM account WHERE id = 1')[0];
  const contacts = rows(
    db,
    'SELECT river_id, name, state, created_at, bio FROM contacts ORDER BY created_at',
  );
  const nameOf = new Map(contacts.map((c) => [str(c.river_id), strOrNull(c.name)]));
  const me = str(identity.river_id);
  const dms = rows(
    db,
    'SELECT peer, sender, body, sent_at, edited_at FROM dm_messages WHERE deleted = 0 ORDER BY peer, sent_at',
  );
  const byPeer = new Map<string, DataExport['directMessages'][number]>();
  for (const m of dms) {
    const peer = str(m.peer);
    let convo = byPeer.get(peer);
    if (!convo) {
      convo = { with: peer, withName: nameOf.get(peer) ?? null, messages: [] };
      byPeer.set(peer, convo);
    }
    const { text, files } = readBody(m.body);
    convo.messages.push({
      from: str(m.sender) === me ? 'you' : str(m.sender),
      text,
      sentAt: str(m.sent_at),
      editedAt: strOrNull(m.edited_at),
      files,
    });
  }
  const comments = rows(
    db,
    'SELECT post_id, author_name, text, created_at FROM post_comments ORDER BY created_at',
  );
  const nicknames = new Map(
    rows(db, 'SELECT community_id, nickname FROM community_nicknames').map((r) => [
      str(r.community_id),
      strOrNull(r.nickname),
    ]),
  );
  return {
    format: 'river-export-1',
    exportedAt: now.toISOString(),
    app: { version },
    you: {
      riverId: me,
      name: strOrNull(identity.display_name),
      createdAt: str(identity.created_at),
      server: account ? strOrNull(account.server_url) : null,
    },
    settings,
    contacts: contacts.map((c) => ({
      riverId: str(c.river_id),
      name: strOrNull(c.name),
      state: str(c.state),
      since: str(c.created_at),
      bio: strOrNull(c.bio),
    })),
    directMessages: [...byPeer.values()],
    groups: rows(db, 'SELECT id, name, members, state, created_at FROM dm_groups ORDER BY created_at').map(
      (g) => ({
        id: str(g.id),
        name: str(g.name),
        members: ((): string[] => {
          try {
            const list = JSON.parse(str(g.members)) as unknown;
            return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
          } catch {
            return [];
          }
        })(),
        state: str(g.state),
        createdAt: str(g.created_at),
      }),
    ),
    calls: rows(
      db,
      'SELECT peer, direction, video, started_at, answered, duration_sec FROM call_log ORDER BY started_at',
    ).map((c) => ({
      with: str(c.peer),
      direction: str(c.direction),
      video: c.video === 1,
      startedAt: str(c.started_at),
      answered: c.answered === 1,
      seconds: Number(c.duration_sec ?? 0),
    })),
    posts: rows(db, 'SELECT id, kind, body, created_at FROM posts WHERE author = ?', me)
      .sort((a, b) => str(a.created_at).localeCompare(str(b.created_at)))
      .map((p) => ({
        kind: str(p.kind),
        text: readBody(p.body).text,
        createdAt: str(p.created_at),
        comments: comments
          .filter((c) => c.post_id === p.id)
          .map((c) => ({ from: str(c.author_name), text: str(c.text), at: str(c.created_at) })),
      })),
    communities: rows(db, 'SELECT id, joined_at FROM communities ORDER BY joined_at').map((c) => ({
      id: str(c.id),
      joinedAt: str(c.joined_at),
      nickname: nicknames.get(str(c.id)) ?? null,
    })),
    savedMessages: rows(
      db,
      'SELECT community_id, channel_id, sender_name, text, sent_at, saved_at FROM saved_messages ORDER BY saved_at',
    ).map((m) => ({
      community: str(m.community_id),
      channel: str(m.channel_id),
      from: str(m.sender_name),
      text: str(m.text),
      sentAt: str(m.sent_at),
      savedAt: str(m.saved_at),
    })),
  };
}
