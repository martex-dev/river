// Renders apps/desktop/build/icon.svg to the PNG electron-builder uses for all platforms.
//   node scripts/generate-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync('apps/desktop/build/icon.svg');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
writeFileSync('apps/desktop/build/icon.png', png);
console.log(`apps/desktop/build/icon.png (${png.length} bytes)`);
