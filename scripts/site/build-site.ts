// Builds River's permanent link pages for GitHub Pages:
//   node scripts/site/build-site.ts <out-dir>
// Produces <out>/index.html (River's home page), join.html, add.html, call.html (invite, friend,
// sign-up and call links: https://martex-dev.github.io/river/join#…), and .nojekyll. The pages are
// the same as the server's /join and /add pages (apps/server/src/routes/landing.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { staticLandingPage } from '../../apps/server/src/routes/landing.ts';

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/site/build-site.ts <out-dir>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const html = staticLandingPage();
for (const name of ['index.html', 'join.html', 'add.html', 'call.html']) writeFileSync(join(out, name), html);
// Serve the files as they are (no Jekyll processing).
writeFileSync(join(out, '.nojekyll'), '');
console.log(`site written to ${out}`);
