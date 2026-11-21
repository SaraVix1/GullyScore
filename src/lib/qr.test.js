import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQR, decodeQR, rsCorrect, _test } from './qr.js';

// Draw a QR into a fake camera frame: rotated, skewed, noisy, on a busy background.
export function render(qr, { W = 480, H = 480, size = 300, angle = 0, persp = 0, noise = 0, blur = false, seed = 1 } = {}) {
  const n = qr.size;
  const Q = n + 8;
  let rnd = seed;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const corner = (u, v, shrink) => {
    const x = (u - 0.5) * size * shrink;
    const y = (v - 0.5) * size;
    return [W / 2 + x * c - y * s, H / 2 + x * s + y * c];
  };
  const img = [corner(0, 0, 1 - persp), corner(1, 0, 1 - persp), corner(0, 1, 1 + persp), corner(1, 1, 1 + persp)];
  const inv = _test.homography(img, [
    [0, 0],
    [Q, 0],
    [0, Q],
    [Q, Q],
  ]);
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [mx, my] = inv(x + 0.5, y + 0.5);
      let v;
      if (mx < 0 || my < 0 || mx >= Q || my >= Q) v = 90 + 60 * Math.sin(x / 7) * Math.cos(y / 11);
      else {
        const ix = Math.floor(mx) - 4;
        const iy = Math.floor(my) - 4;
        v = ix >= 0 && iy >= 0 && ix < n && iy < n && qr.modules[iy * n + ix] ? 35 : 225;
      }
      g[y * W + x] = v + (rand() - 0.5) * noise;
    }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = g[y * W + x];
      if (blur && x > 0 && y > 0 && x < W - 1 && y < H - 1) {
        v = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v += g[(y + dy) * W + x + dx];
        v /= 9;
      }
      const i = (y * W + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  return { data: out, width: W, height: H };
}

const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const sample = (len, seed = 7) => {
  let s = '';
  for (let i = 0; i < len; i++) s += B45[(seed = (seed * 31 + 17) % 9973) % 45];
  return s;
};

test('encoder picks the smallest version that fits', () => {
  assert.equal(encodeQR('HELLO').size, 21);
  assert.equal(encodeQR(sample(150)).size, 4 * 6 + 17);
  assert.throws(() => encodeQR(sample(400)), /Too much/);
});

test('reed-solomon corrects up to n/2 byte errors', () => {
  const qr = encodeQR('X'); // just to load tables
  assert.ok(qr);
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  // known example from the QR spec (version 1-M "01234567")
  const ecc = [196, 35, 39, 119, 235, 215, 231, 226, 93, 23];
  const cw = [...data, ...ecc];
  assert.equal(rsCorrect(cw.slice(), 10), true);
  const broken = cw.slice();
  broken[0] ^= 0xff;
  broken[5] ^= 0x13;
  broken[12] ^= 0x01;
  broken[20] ^= 0x80;
  broken[25] ^= 0x55;
  assert.equal(rsCorrect(broken, 10), true);
  assert.deepEqual(broken, cw);
  const tooMany = cw.slice();
  for (let i = 0; i < 6; i++) tooMany[i * 4] ^= 0x5a;
  assert.equal(rsCorrect(tooMany, 10), false);
});

const cases = [
  ['straight', {}],
  ['rotated 30°', { angle: Math.PI / 6 }],
  ['upside down', { angle: Math.PI }],
  ['rotated 90°', { angle: Math.PI / 2 }],
  ['perspective', { persp: 0.12, angle: 0.2 }],
  ['noisy + blurred', { noise: 70, blur: true }],
  ['small in frame', { size: 190, angle: -0.3 }],
];

for (const len of [10, 60, 150, 190]) {
  for (const [name, opt] of cases) {
    // Version 1 has no alignment pattern, so it cannot correct perspective
    // (same as other decoders). Connection codes are always version 5+.
    if (len < 20 && opt.persp) continue;
    test(`decode ${len} chars: ${name}`, () => {
      const text = sample(len, len);
      const qr = encodeQR(text);
      assert.equal(decodeQR(render(qr, { ...opt, seed: len })), text);
    });
  }
}

test('decode byte mode with UTF-8', () => {
  const text = 'Gully Score 🏏 live: Thunder Strikers 45/2';
  assert.equal(decodeQR(render(encodeQR(text), { angle: 0.4 })), text);
});

test('no QR in frame returns null', () => {
  const blank = render({ size: 21, modules: new Uint8Array(441) }, { size: 0.0001 });
  assert.equal(decodeQR(blank), null);
});
