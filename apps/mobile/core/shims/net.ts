const V4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** node:net isIP: 4, 6 or 0. */
export function isIP(input: string): 0 | 4 | 6 {
  if (V4.test(input)) return 4;
  if (input.includes(':')) {
    try {
      new URL(`http://[${input}]/`);
      return 6;
    } catch {
      return 0;
    }
  }
  return 0;
}

export const isIPv4 = (input: string): boolean => isIP(input) === 4;
export const isIPv6 = (input: string): boolean => isIP(input) === 6;

export default { isIP, isIPv4, isIPv6 };
