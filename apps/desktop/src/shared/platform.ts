/** River on a phone (Android or iOS): no hosting, no screen picker; the phone shell (2.12). */
export function isPhone(platform: string | undefined): boolean {
  return platform === 'android' || platform === 'ios';
}
