# Host a River community tonight (Windows, free)

This runs the River server on your own PC and makes it reachable over HTTPS
through a free Cloudflare tunnel. No domain, no account, no payment.

You need: this repository on your PC with Node.js 24 (already the case if you
build River), and River installed.

## 1. Install the tunnel tool (once)

Open **PowerShell** and run:

```powershell
winget install --id Cloudflare.cloudflared
```

Close and reopen PowerShell afterwards.

## 2. Start the River server

In PowerShell, in the River folder:

```powershell
cd "C:\Users\PC Games\Desktop\River"
$env:RIVER_TRUST_PROXY = "true"
$env:RIVER_RATE_LIMIT_PER_MINUTE = "5000"
npm run server
```

Leave this window open. The server keeps its data in `apps\server\data\`.

## 3. Open the tunnel

Open a **second** PowerShell window:

```powershell
cloudflared tunnel --url http://localhost:8787
```

After a few seconds it prints an address like
`https://something-random-words.trycloudflare.com`. That is your server
address. Leave this window open too.

> The quick-tunnel address changes every time you restart `cloudflared`, and
> accounts belong to a server address. Keep both windows running for the whole
> meeting. For a permanent address, use a Cloudflare named tunnel with your own
> domain, or a small VPS (see [self-hosting.md](self-hosting.md)).

## 4. Create the community (you, once)

1. Open River → create your identity.
2. **Settings → Server** → paste the `https://….trycloudflare.com` address →
   **Test connection** → **Save** → **Create account**.
3. **Communities** → **Create a community** → name it.
4. **Invite people** → **Copy link**.

## 5. Everyone else

1. Install River from <https://github.com/martex-dev/river/releases/latest>.
2. Open it and create an identity (any display name).
3. **Communities → Join with an invite link** → paste the link → **Join community**.
   River creates their account automatically.

Then open **Lounge** (or any voice channel) → **Join voice**. Use **Camera on**
and **Share screen** as needed.

## What to expect

- Calls connect each pair of people directly (peer-to-peer). This works well
  for around 10 people with voice and a few cameras/one screen share; it needs
  everyone's upload bandwidth. Group calls through a relay server (SFU) are planned.
- A small share of networks (strict corporate/university firewalls, some mobile
  hotspots) block direct connections; those people will see "could not connect".
  A relay (TURN) server fixes this and is planned.
- Connection setup uses public STUN servers (Cloudflare, Google) to discover
  each computer's public address. Call content never passes through them.
- Anyone who has the invite link can join and read the community. Share it
  privately; invite links expire after 7 days or 100 uses.
