/**
 * Whether River's phone shell (phone/PhoneShell.tsx) is on screen. On a phone a community opens
 * on its list of channels, so stores that pick a channel by themselves on a computer (the first
 * text channel of the first community) leave that choice to the person here.
 *
 * No imports: the stores read this without depending on the phone shell.
 */
let active = false;

export function phoneShellActive(): boolean {
  return active;
}

export function setPhoneShellActive(on: boolean): void {
  active = on;
}
