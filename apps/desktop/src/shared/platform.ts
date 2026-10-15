/** River on a phone (Android or iOS): no hosting, no screen picker, one pane at a time. */
export function isPhone(platform: string | undefined): boolean {
  return platform === 'android' || platform === 'ios';
}
