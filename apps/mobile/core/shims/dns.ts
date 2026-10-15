/**
 * Link previews need a DNS answer to refuse private addresses before fetching.
 * The phone does not fetch previews (the page could not be read across origins
 * anyway), so lookups fail and no preview is made.
 */
export async function lookup(host: string): Promise<never> {
  throw Object.assign(new Error(`getaddrinfo ENOTSUP ${host}`), { code: 'ENOTSUP' });
}

export default { lookup };
