# Host your communities on your own PC

From River 1.0.11, River can host your communities itself, for free, with no
account anywhere and nothing to install. Turn it on once, and every time your
PC starts, River starts, your community server starts inside it, and members
can reach you again — automatically.

## Turn it on

- **Starting a new community:** pick **On this PC — free** (the default when
  you have no account yet) and press **Create community**. River does the rest.
- **Any time:** **Settings → Hosting → Keep my communities online from this
  PC**.

That's all. While hosting is on, River also starts when you sign in to your PC
and keeps running in the tray when you close its window.

## What River does for you

- **Runs the community server** in its own background process inside River. If
  it ever stops, River restarts it.
- **Opens a public address** with a free Cloudflare quick tunnel, so members can
  reach you from anywhere without any router setup. River uses `cloudflared`
  if it is installed in a system folder, or downloads Cloudflare's official
  release once and checks it against a fingerprint built into River before
  running it.
- **Lets members follow the address.** A quick tunnel gets a new address every
  time it starts. River's server signs a short note "I am now at this address"
  with its own key and posts it to a public relay (ntfy.sh). Members' apps
  learned that key when they first connected. When the server stops answering,
  they read the relay, accept only notes signed by that key, check that the new
  address answers as the same server, and move there by themselves. Your own
  app follows instantly.
- **Keeps everything.** The database and encrypted files live in River's
  hosting folder (Settings → Hosting → **Open hosting folder**). Restarting or
  turning off the PC loses nothing.
- **Backs up every day.** A consistent copy of the database is written to the
  `backups` folder once a day (and whenever you press **Back up now**); the
  newest seven are kept.
- **Keeps the PC awake** while hosting, if you want (on by default; the screen
  can still turn off).
- **Asks before going offline.** Quitting River from the tray while it hosts
  asks first.

## If you used River Host (1.0.8–1.0.10)

River Host was a separate program set up with `scripts/host/install-host.ps1`.
When you turn on hosting in River, River finds it, removes its sign-in task,
stops it, and copies its community data into River — same server identity,
same members, same messages. Members' apps follow to the new address on their
own. The old `RiverHost` folder is left untouched as a backup; delete it when
you are happy.

The scripts in `scripts/host` still work for people who run a server without
the River app.

## When your PC is off

A community hosted on your PC is reachable while your PC is on and River is
running. When it is off, members keep everything they already have, can read
it, and can keep writing: their messages wait on their own devices (encrypted)
and are delivered when your PC is back.

For a community that is reachable all the time, the server needs a machine
that is always on, such as a small cloud server — see
[self-hosting.md](self-hosting.md). Your data can move there later: copy the
hosting folder's `data`.

## Privacy

- The server never has your messages, files or names; it stores only
  ciphertext, as always.
- **Cloudflare** carries the encrypted connections between members and your PC
  (TLS ends at Cloudflare's edge, but River's content is end-to-end encrypted
  inside it). Cloudflare sees members' IP addresses and when they connect, like
  any server operator would.
- **The relay** (ntfy.sh) holds only signed notes of the form "server X is at
  address Y". It sees the IP addresses of your PC and of members' apps when
  they post or read notes, and when. The address in the note is the public
  tunnel address, which is public anyway.
- A forged note cannot move anyone: apps only accept notes signed by the
  server's key, and only if the new address answers with that same key.
- Logs in the hosting folder contain no members' IP addresses, names or content.
