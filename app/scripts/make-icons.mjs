// Draws the app icons into assets/ (the app's white disc with a ring and centre dot, as on the sign-in screen).
// Run: node scripts/make-icons.mjs   (from the app folder; needs the pngjs dev dependency)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const GREEN = [0x1b, 0x7f, 0x4b];
const WHITE = [255, 255, 255];

// Shapes are fractions of the canvas, so the same design scales to every size.
const DISC = 0.30;       // radius of the disc
const RING = 0.19;       // radius of the ring's centre line
const RING_W = 0.045;    // ring thickness
const DOT = 0.075;       // radius of the centre dot

/**
 * mode: 'full'  = coloured background (store icon), 'fg' = transparent background (adaptive foreground),
 *       'mono'  = silhouette in alpha only (Android themed icon), 'splash' = green disc on transparent.
 * scale shrinks the design (adaptive icons keep everything inside the central 66%).
 */
function render(size, mode, scale = 1) {
  const png = new PNG({ width: size, height: size });
  const SS = 4; // 4x4 samples per pixel for smooth edges
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = x + (sx + 0.5) / SS - c;
          const dy = y + (sy + 0.5) / SS - c;
          const d = Math.hypot(dx, dy) / size / scale;
          const inDot = d <= DOT;
          const inRing = Math.abs(d - RING) <= RING_W / 2;
          const inDisc = d <= DISC;
          let px; // [r, g, b, a]
          if (mode === 'mono') px = inDisc && !inDot && !inRing ? [255, 255, 255, 1] : [0, 0, 0, 0];
          else if (mode === 'splash') px = inDisc ? (inDot || inRing ? [...WHITE, 1] : [...GREEN, 1]) : [0, 0, 0, 0];
          else if (inDisc) px = inDot || inRing ? [...GREEN, 1] : [...WHITE, 1];
          else px = mode === 'full' ? [...GREEN, 1] : [0, 0, 0, 0];
          r += px[0] * px[3]; g += px[1] * px[3]; b += px[2] * px[3]; a += px[3];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      png.data[i] = a ? Math.round(r / a) : 0;
      png.data[i + 1] = a ? Math.round(g / a) : 0;
      png.data[i + 2] = a ? Math.round(b / a) : 0;
      png.data[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png;
}

function solid(size, [r, g, b]) {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i++) png.data.set([r, g, b, 255], i * 4);
  return png;
}

// opaque = write without an alpha channel (the App Store rejects an icon that has one, even a fully opaque one).
const out = (name, png, opaque = false) =>
  writeFileSync(
    fileURLToPath(new URL(`../assets/${name}`, import.meta.url)),
    PNG.sync.write(png, opaque ? { colorType: 2, inputColorType: 6, inputHasAlpha: true } : undefined),
  );
out('icon.png', render(1024, 'full'), true);                        // iOS and store icon: opaque, no rounded corners
out('android-icon-foreground.png', render(1024, 'fg', 0.9));  // adaptive foreground, inside the safe zone
out('android-icon-background.png', solid(1024, GREEN));
out('android-icon-monochrome.png', render(1024, 'mono', 0.9));
out('splash-icon.png', render(1024, 'splash'));
out('favicon.png', render(48, 'full'));
console.log('icons written to assets/');
