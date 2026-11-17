// Makes the small images the website uses (site/img) from the store screenshots and the app icon, so the pages stay
// light. Run when the screenshots change: node scripts/make-site-images.mjs   (from the app folder; needs pngjs)
// The results are committed; the site build only copies nothing and reads nothing from here.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const GREEN = [0x1b, 0x7f, 0x4b];

/** Shrinks by a whole number by averaging each block (sharp, no new dependency). */
function shrink(png, factor) {
  const w = Math.floor(png.width / factor);
  const h = Math.floor(png.height / factor);
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sum = [0, 0, 0, 0];
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * png.width + (x * factor + dx)) * 4;
          for (let k = 0; k < 4; k++) sum[k] += png.data[i + k];
        }
      }
      const o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) out.data[o + k] = Math.round(sum[k] / (factor * factor));
    }
  }
  return out;
}

const read = (p) => PNG.sync.read(readFileSync(root(p)));
const write = (name, png) => writeFileSync(root(`site/img/${name}`), PNG.sync.write(png, { colorType: 6 }));

mkdirSync(root('site/img'), { recursive: true });

// Phone screenshots: 1080x2400 -> 360x800.
const shots = {
  'scoring.png': 'docs/screenshots/07-scoring-hole-5.png',
  'courses.png': 'docs/screenshots/04-course-search.png',
  'stats.png': 'docs/screenshots/30-stats.png',
  'history.png': 'docs/screenshots/11-rounds-history.png',
};
for (const [name, src] of Object.entries(shots)) write(name, shrink(read(src), 3));

// App icon: 1024 -> 256 (pages) and 512 (press kit).
const icon = read('app/assets/icon.png');
write('icon.png', shrink(icon, 4));
write('icon-512.png', shrink(icon, 2));

// Link preview (1200x630): the icon on the brand green. No text, so nothing can be cut off by a preview crop.
const og = new PNG({ width: 1200, height: 630 });
for (let i = 0; i < og.data.length; i += 4) {
  og.data[i] = GREEN[0]; og.data[i + 1] = GREEN[1]; og.data[i + 2] = GREEN[2]; og.data[i + 3] = 255;
}
const small = shrink(icon, 3); // 341x341
const ox = Math.floor((og.width - small.width) / 2);
const oy = Math.floor((og.height - small.height) / 2);
for (let y = 0; y < small.height; y++) {
  for (let x = 0; x < small.width; x++) {
    const s = (y * small.width + x) * 4;
    const d = ((oy + y) * og.width + (ox + x)) * 4;
    const a = small.data[s + 3] / 255;
    for (let k = 0; k < 3; k++) og.data[d + k] = Math.round(small.data[s + k] * a + og.data[d + k] * (1 - a));
  }
}
write('og.png', og);
console.log('site/img written');
