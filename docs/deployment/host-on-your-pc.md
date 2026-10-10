# Host your community on your own PC, automatically

River Host keeps your River server and its public address running whenever
your PC is on. It starts when you sign in to Windows, runs hidden, and
restarts anything that stops. Your community's data stays in one permanent
folder, so turning the PC off loses nothing. When the PC is back on, everything
comes back by itself, and members' apps find the server again on their own.

## What it does

- Runs the River server from a copy of a River **release** (`RiverHost\app`),
  separate from any development checkout.
- Keeps the database and encrypted files in `RiverHost\data`.
- Opens a free Cloudflare quick tunnel so members can reach the server from
  anywhere, with no router setup.
- Restarts the server or the tunnel if either stops, with growing pauses.
- **Follows the address.** A quick tunnel gets a new address every time it
  starts. River Host tells the server its new address. The server signs a short
  note with its own key and posts it to a public relay (ntfy.sh). Members' apps
  learned that key while connected. When the server stops answering, they read
  the relay, keep only notes signed by that key, check that the new address
  answers as the same server, and move there. You see "Your server moved to a
  new address. River followed it automatically."

## Set it up (Windows)

1. Make the release copy and install what the server needs:

   ```powershell
   git -C path\to\river worktree add --detach "$env:USERPROFILE\RiverHost\app" v1.0.8
   cd "$env:USERPROFILE\RiverHost\app"; npm ci
   ```

2. Put your existing data in `RiverHost\data` (copy `apps\server\data` there),
   or start fresh.
3. Install River Host:

   ```powershell
   powershell -ExecutionPolicy Bypass -File path\to\river\scripts\host\install-host.ps1
   ```

It registers a **River Host** task in Task Scheduler (no administrator rights
needed) and starts it. Status is in `RiverHost\status.json` and logs are in
`RiverHost\logs`.

To stop it starting with Windows:
`Unregister-ScheduledTask -TaskName "River Host" -Confirm:$false`

To also open the River app at sign-in, turn on **Settings → System → Start
River when I sign in**.

## Privacy

- The server never has your messages, files or names; it stores only
  ciphertext, as always.
- **The relay** (ntfy.sh by default; set `beaconRelay` to `""` in `host.json`
  to turn it off) holds only signed notes of the form "server X is at address
  Y". It sees the IP addresses of your server and of members' apps when they
  post or read notes, and when. The note's address is the public tunnel
  address, which is public anyway.
- A forged note cannot move anyone: apps only accept notes signed by the
  server's key, and only if the new address answers with that same key.

## When your PC is off

A server on your PC is reachable only while your PC is on. Members keep
everything they already have and can read it, and messages they send wait in
River (while it stays open) until the server is back. For a community that is reachable all the
time, the server needs an always-on machine, such as a small cloud server.
Some providers have free tiers that need an account. See
[self-hosting.md](self-hosting.md).
