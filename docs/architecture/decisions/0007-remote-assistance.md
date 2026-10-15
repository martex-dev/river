# ADR 0007 — Remote assistance: consent, a visible bar, instant stop

Status: accepted (2026-10-15), for 1.8.x.

## Context

Stage 2 promises consent-based remote support: someone you trust looks at
your screen, shows you where to click, and — later — may take control. The
project rule is strict: remote assistance is consent-only, always visible,
ends instantly, and is never hidden or unattended.

River already has end-to-end encrypted calls with screen sharing (WebRTC,
DTLS-SRTP; setup sealed and, since 1.5.0, identity-signed). Remote assistance
builds on that rather than adding a second channel.

## Decision

**1.8.0 — see and point.**

- **Consent is the share itself.** Nothing is shown unless the person whose
  screen it is clicks _Share screen_ in a call and picks a screen in River's
  own picker. No remote request can start it; there is no unattended mode.
- **Always-visible bar.** While a screen is shared, main (not the untrusted
  renderer) shows an always-on-top bar on the shared screen: who can see it
  and a **Stop sharing** button. Main shows it the moment a screen is handed
  to the call, before the window reports anything; it is a separate,
  sandboxed page with no preload and no access to River, and it talks back
  only by navigating to `river-indicator:stop`, which main intercepts.
- **Instant stop.** Stop (on the bar, in the call, or leaving the call) ends
  the screen track at once; hanging up ends everything.
- **Pointing.** In a call, the people watching Alt+click (or click in
  fullscreen; in 1:1 calls just click) on the shared screen. A `point`
  signal `{x, y}` (fractions of the screen) travels over the call's
  signalling, sealed and identity-signed like all call setup. The sharer
  accepts it only while sharing, only from people in the call, at most four
  a second, and main draws a ring there on a click-through layer. Pointing
  maps onto whole screens only (a shared window can move).

**Later (1.8.x): control.** Moving the pointer and typing on someone else's
computer needs operating-system input injection, which Electron does not
provide. It will come only with: a separate, explicit "Allow control" grant
each session (never remembered), a different bar colour while control is on,
a hardware-key stop (Esc held / a global shortcut) that main handles without
the renderer, and input limited to the shared screen. Until then River says
plainly that helpers can see and point, not control.

## Why

- No new cryptography or channel: the call is already end-to-end encrypted,
  and point signals ride its sealed, signed setup.
- The indicator does not depend on the renderer being honest.
- Seeing and pointing covers most "where do I click?" help with no control
  risk at all.

## Not in scope

- Unattended access, access without someone at the shared computer, and any
  way to hide the bar. These will never be built.
- Phones as the shared side (their WebViews cannot capture the screen);
  phones can watch and point.
