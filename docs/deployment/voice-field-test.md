# Voice field test

A real voice call over the internet with many people, for an hour or more:
one River on the hosting PC plus River clients on GitHub's machines (another
continent), all in one voice channel. Every 15 seconds each client records
whether it is still in the call, whether it sees everyone, and whose voice it
actually hears (measured from the received audio).

Never point it at a real community server: it creates accounts. Use a
throwaway server.

## On the hosting PC

1. Start a throwaway server on its own port and data folder:
   ```bash
   RIVER_PORT=8791 RIVER_DATABASE_URL=sqlite:/tmp/field/test.sqlite RIVER_ATTACHMENT_DIR=/tmp/field/att \
     RIVER_RATE_LIMIT_PER_MINUTE=100000 node apps/server/src/main.ts
   ```
2. Make it public on a second Funnel port (River's real server keeps 443):
   ```bash
   tailscale funnel --bg --https=8443 http://127.0.0.1:8791
   ```
3. Start the host client (it creates the community and writes the invite):
   ```bash
   cd apps/desktop
   RIVER_FIELD_ROLE=host RIVER_FIELD_SERVER=https://<pc>.<tailnet>.ts.net:8443 \
     RIVER_FIELD_INVITE_FILE=invite.txt RIVER_FIELD_EXPECTED=16 RIVER_FIELD_MINUTES=60 \
     RIVER_FIELD_REPORT=host.json npx playwright test e2e/voice-field.spec.ts
   ```

## On GitHub

Actions → **Voice field test** → Run workflow, with the invite from
`invite.txt`. The default is five machines (three Linux, two Windows) with three
clients each: 15 guests + the host = 16 people. Each machine uploads its
report (`field-<tag>.json`).

## Afterwards

`tailscale funnel --https=8443 off`, stop the throwaway server, delete its data.

Pass: nobody leaves the call, and fewer than 5% of samples miss someone or
don't hear everyone.
