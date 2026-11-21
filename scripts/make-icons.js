// Renders the app icons as PNGs with no dependencies (node:zlib only).
// Run: npm run icons   -> writes into public/
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const LIME = [212, 255, 42];
const INK = [5, 7, 6];
const RED_HI = [255, 92, 74];
const RED_LO = [168, 22, 24];
const WHITE = [255, 255, 255];

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (x) => Math.max(0, Math.min(1, x));

// One sample of the icon at normalised (u, v) in [0,1]. Returns [r,g,b,a].
function sample(u, v, { ball, rounded }) {
  if (rounded) {
    const r = 0.22;
    const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
    const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
    if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];
  }
  const d = Math.hypot(u - 0.5, v - 0.5);
  // soft dark ring under the ball
  if (d > ball && d < ball * 1.09) return [...INK, 255];
  if (d >= ball) return [...LIME, 255];

  // shaded red sphere, light from top-left
  const t = clamp(Math.hypot(u - (0.5 - ball * 0.38), v - (0.5 - ball * 0.38)) / (ball * 1.7));
  let col = mix(RED_HI, RED_LO, t);

  // seam: two concentric arcs crossing the ball diagonally, with stitches
  const D = ball * 2.1;
  const cx = 0.5 + D * Math.SQRT1_2;
  const cy = 0.5 - D * Math.SQRT1_2;
  const dist = Math.hypot(u - cx, v - cy);
  const arc = Math.atan2(v - cy, u - cx) * dist;
  for (const off of [-0.11, 0.11]) {
    const ds = dist - (D + off * ball);
    const line = Math.abs(ds) < ball * 0.028;
    const stitch = Math.abs(ds) < ball * 0.085 && ((arc / (ball * 0.12)) % 1 + 1) % 1 < 0.38;
    if (line || stitch) col = mix(col, WHITE, 0.95);
  }
  return [...col, 255];
}

function render(size, opts) {
  const S = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = sample((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size, opts);
          const al = c[3] / 255;
          r += c[0] * al;
          g += c[1] * al;
          b += c[2] * al;
          a += al;
        }
      }
      const i = (y * size + x) * 4;
      buf[i] = a ? Math.round(r / a) : 0;
      buf[i + 1] = a ? Math.round(g / a) : 0;
      buf[i + 2] = a ? Math.round(b / a) : 0;
      buf[i + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  return png(size, buf);
}

const icons = [
  ['icon-192.png', 192, { ball: 0.33, rounded: true }],
  ['icon-512.png', 512, { ball: 0.33, rounded: true }],
  ['icon-maskable-512.png', 512, { ball: 0.26, rounded: false }],
  ['apple-touch-icon.png', 180, { ball: 0.31, rounded: false }],
];
for (const [name, size, opts] of icons) {
  writeFileSync(join(OUT, name), render(size, opts));
  console.log('wrote', name);
}
