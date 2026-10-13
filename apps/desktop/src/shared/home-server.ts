/**
 * River's home server: the community server run by the River maintainer
 * (hosted on their PC from inside River). New installs create their account
 * here automatically, so people never type a server address.
 *
 * Its address changes when the host PC restarts, so it is found the same way
 * members follow any moved server: the newest note on the relay topic that
 * this key signed, then a check that the address answers with this identity.
 * Forks of River point this at their own server.
 */
export const HOME_SERVER = {
  name: 'River',
  instanceId: '69b216c4-9589-4225-8018-706644579f55',
  publicKey: '7VLnNVrL9tVuKYRYqxg5ULHqszx3caTJTGvtiisRt74=',
  relay: 'https://ntfy.sh',
  topic: 'river-foytAMI1vujBjUAlau5e0YpN',
} as const;

/**
 * Where links to River's home server point: a page that never moves (GitHub
 * Pages, built from site/), unlike the home server's own address, which changes
 * when its host PC restarts. An invite like `${HOME_LINK_BASE}/join#c=…&k=…`
 * opens a page to get River and "Open in River"; the app knows such a link means
 * River's server and finds it through the signed address notes.
 */
export const HOME_LINK_BASE = 'https://martex-dev.github.io/river';

/** The server part of a link is River's permanent link address (not a server itself). */
export function isHomeLink(serverUrl: string): boolean {
  return serverUrl.replace(/\/+$/, '') === HOME_LINK_BASE;
}
