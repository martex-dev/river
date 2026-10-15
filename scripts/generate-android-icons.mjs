// Renders River's icon (apps/desktop/build/icon.svg) for Android: launcher icons
// (legacy and adaptive) and the launch screen.
//   node scripts/generate-android-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const RES = 'apps/mobile/android/app/src/main/res';
const BG = '#0b1222';
const icon = readFileSync('apps/desktop/build/icon.svg', 'utf8');
const inner = icon.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const defs = /<defs>[\s\S]*?<\/defs>/.exec(inner)?.[0] ?? '';
const waves = /<g fill="none"[\s\S]*?<\/g>/.exec(inner)?.[0] ?? '';

const render = (svg, width) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'rgba(0,0,0,0)' }).render().asPng();
const write = (path, png) => {
  writeFileSync(`${RES}/${path}`, png);
  console.log(`${path} (${png.length} bytes)`);
};

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(densities)) {
  // Legacy launcher icon: the whole icon on a transparent square.
  write(`mipmap-${d}/ic_launcher.png`, render(icon, 48 * k));
  // Round launcher icon: the waves on a dark circle.
  const round = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${defs}<circle cx="512" cy="512" r="512" fill="${BG}"/>${waves}</svg>`;
  write(`mipmap-${d}/ic_launcher_round.png`, render(round, 48 * k));
  // Adaptive foreground (108dp, the inner 72dp are always visible): the waves, centred.
  const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-256 -256 1536 1536">${defs}${waves}</svg>`;
  write(`mipmap-${d}/ic_launcher_foreground.png`, render(fg, 108 * k));
}

// Launch screen: the icon centred on River's dark background, portrait and landscape.
const splash = (w, h) => {
  const s = Math.min(w, h) * 0.32;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${BG}"/><svg x="${(w - s) / 2}" y="${(h - s) / 2}" width="${s}" height="${s}" viewBox="0 0 1024 1024">${inner}</svg></svg>`;
};
const sizes = {
  mdpi: [320, 480],
  hdpi: [480, 800],
  xhdpi: [720, 1280],
  xxhdpi: [960, 1600],
  xxxhdpi: [1280, 1920],
};
for (const [d, [w, h]] of Object.entries(sizes)) {
  write(`drawable-port-${d}/splash.png`, render(splash(w, h), w));
  write(`drawable-land-${d}/splash.png`, render(splash(h, w), h));
}
write('drawable/splash.png', render(splash(480, 320), 480));
