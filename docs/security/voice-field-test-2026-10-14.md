# Voice field test — 2026-10-14

16 people in one voice channel for 65 minutes over the real internet:

- **Host**: the maintainer's PC in Bulgaria, serving a throwaway River server
  through Tailscale Funnel (the same path home hosting uses since 1.0.43).
- **Guests**: 15 River clients on five GitHub Actions Linux machines in
  Dulles, Virginia, USA (three per machine).

Every 15 seconds each client recorded whether it was in the call, whether it
saw everyone, and **whose voice it actually heard**, measured from the received
audio (an analyser on each remote stream), not from connection states.

## Before the fix (River 1.0.43)

A 15-minute run found a real bug: about two minutes in, a short server
reconnect left five listeners unable to hear one speaker for the rest of the
call (13% of samples heard), although everyone still showed as connected and
the speaker heard them fine. Cause: a late "please relay" signal switched the
listener to the server-relayed stream after the direct connection was already
up; the speaker no longer relayed, so that stream was silent. Fixed in 1.0.44
(late requests are answered with "we are direct"; pairs marked "via server"
while connected directly go back to direct within 2 seconds).

An earlier 65-minute run with Windows runners as well was inconclusive: the
Windows machines were overloaded by three River windows each (they took a sixth
of the expected measurements) and barely transmitted.

## After the fix (65 minutes)

| Machine    | Samples | Out of call | Missing someone | Heard on average |
| ---------- | ------- | ----------- | --------------- | ---------------- |
| Host (BG)  | 260     | 0           | 0               | 14.92 / 15       |
| l1 (US, 3) | 777     | 0           | 0               | 14.95 / 15       |
| l2 (US, 3) | 777     | 0           | 0               | 14.98 / 15       |
| l3 (US, 3) | 774     | 0           | 0               | 15.00 / 15       |
| l4 (US, 3) | 777     | 0           | 0               | 14.98 / 15       |
| l5 (US, 3) | 777     | 0           | 0               | 14.95 / 15       |

Every pair heard each other at least 97% of the time; the misses were single
15-second samples that recovered by themselves. Nobody left the call.

Limits of this test: one host country and one guest location (all guests in
the same US data centre, so guest-to-guest links were short); audio only, no
cameras or screen sharing; fake microphones. Video with 16 people in a mesh
would need far more upload bandwidth per person and is not claimed.

How to run it again: [docs/deployment/voice-field-test.md](../deployment/voice-field-test.md).
