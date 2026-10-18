# Performance

River should feel instant with big accounts (hundreds of chats, communities with 100 000 messages
and 1000 members) on a mid-range Android phone and on computers. This page lists how it is
measured and what the numbers were when the speed work landed (unreleased, after 2.20.2).

## Measuring

| What                     | How                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Local database (DMs)     | `node scripts/perf/desktop-db.ts [chats=300] [groups=30] [messages=100000]`: times and query counts   |
| Server hot queries       | `node scripts/perf/server-db.ts [messages=100000] [members=1000] [communities=300]`: times and plans  |
| Start-up, on any machine | The log's `Start-up:` line, and Settings → System → Connection check (Start-up and Start-up (window)) |
| Bundle sizes             | `npm run build -w @river/desktop` (renderer), `npm run build:ui -w @river/mobile` (phone UI)          |
| Regressions              | `apps/desktop/test/dm-speed.test.ts`, `list-speed.test.tsx`, `apps/server/test/hot-queries.test.ts`   |

The tests pin behaviour and query plans (indexes used, a fixed number of queries for the chat
list however many chats there are), not times, so they do not flake on slow machines.

Start-up marks are milliseconds since the process started: `ready` (Electron ready), `network`
(proxy settings applied), `data` (local database open), `window` (window made), `painted` (first
paint). The window adds `chats` (milliseconds since its page started, when its chat list had its
chats). Nothing but these times is recorded.

## Results

Measured on a Windows desktop (Node 24, SQLite via SQLCipher). Times vary with the machine; the
query counts do not.

### Local database (300 chats, 30 groups of 32, 100 000 messages)

| Step                                     | Before (2.20.2)          | After                |
| ---------------------------------------- | ------------------------ | -------------------- |
| Chat list (built again on every message) | 1.3–3.1 s, 5516 queries  | 47–51 ms, 10 queries |
| A busy chat's latest 500 messages        | 280–760 ms, 1501 queries | 2.4 ms, 3 queries    |
| A group chat's latest messages           | 134–383 ms, 756 queries  | 2.0 ms, 8 queries    |
| History sweep (every 5 minutes)          | 68–114 ms                | 0.2 ms               |

On a phone every query is a synchronous native call, so the query counts are what matters
there. How: one query each for every chat's last message and unread count (expression indexes on
`COALESCE(received_at, sent_at)`, local migration 25), contacts, groups and group profiles read
once per list or page, cached prepared statements, the identity fingerprint derived once, and a
new message no longer builds the whole chat list to find its chat's name.

### Server (one community with 1000 members and 100 000 messages among 300 others)

| Request                                  | Before  | After   |
| ---------------------------------------- | ------- | ------- |
| Opening a community (every request does) | 17.9 ms | 1.8 ms  |
| Who may see a new message (every member) | 7.0 ms  | 1.5 ms  |
| Newest-message times (community list)    | 8.4 ms  | 0.1 ms  |
| A deep page of channel history           | 15.4 ms | 0.3 ms  |
| Newest page, thread page, mailbox page   | ≈0.3 ms | ≈0.3 ms |

Migration 0032 adds `channels_by_community`, `roles_by_community` and `messages_channel_page`
(`channel_id, thread_id, sent_at, id`); they work the same on PostgreSQL. Member roles are grouped
once instead of searched for per member, and members are found by ID.

Large JSON answers to GET requests (8 KB or more) are gzipped for clients that ask: the community
list with 1000 members goes from about 800 KB to 505 KB, a page of 50 messages from 36 KB to
20 KB. Only GET answers are compressed (they carry no session tokens), and sealed content is
encrypted with fresh nonces on the device, so a compressed size cannot be matched against anyone's
plaintext.

### Start-up (desktop, fresh profile, warm runs)

| Mark        | Before      | After       |
| ----------- | ----------- | ----------- |
| Window made | 520–1170 ms | 370–510 ms  |
| First paint | 760–1700 ms | 860–1060 ms |

Without a proxy River no longer resets every Chromium session to the system's proxy settings
before opening (that is their default; it took 60–800 ms). With a big account the chat list the
window asks for first is the 1.3–3.1 s → 50 ms above.

### Bundles (minified, before compression)

| Bundle                      | Before  | After   |
| --------------------------- | ------- | ------- |
| Desktop window, start-up JS | 1362 KB | 1161 KB |
| Phone UI, start-up JS       | 1349 KB | 1151 KB |

Loaded when first needed: the camera QR decoder (jsQR, 131 KB, only without the system's
BarcodeDetector), the appearance centre and theme editor (35 KB), the server admin page (11 KB),
and, as before, the emoji data. The settings schema no longer pulls in the semver package. The
phone core stays one file.

### Lists and memory

- Main sends every community and every chat whole on each change; the window keeps the objects of
  everything that did not change (`structural.ts`), so a presence change in a community of 1000
  draws one member row, and a message in one chat draws one chat row.
- Presence changes within 150 ms reach the window as one update (after a reconnect the server
  reports everyone at once).
- Member and chat rows are memoised, chat rows subscribe only to their own selection and typing,
  and rows out of view skip layout and paint (`content-visibility: auto`; they stay in the
  accessibility tree, so names and screen readers are unchanged).
- Inline pictures decode off the main thread. Decrypted files were already kept in a bounded
  cache whose object URLs are revoked; listeners, timers and audio nodes were checked and are
  released.

## Not done yet

- Channel messages are memoised but not windowed; a channel scrolled back through thousands of
  messages keeps them all in the page.
- Search reads every message (no full-text index); it is only run when asked.
- `electron-updater` (about 100 ms to load) is still loaded before the window in installed builds.
