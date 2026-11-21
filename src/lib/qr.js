// Tiny QR Code encoder + camera-frame decoder (versions 1-10), no dependencies.
// The decoder exists because iPhone Safari has no built-in BarcodeDetector.

// ---------- Reed-Solomon over GF(256), polynomial 0x11d ----------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 256) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const div = (a, b) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);

function rsEncode(data, n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    g.forEach((c, j) => {
      next[j] ^= c;
      next[j + 1] ^= mul(c, EXP[i]);
    });
    g = next;
  }
  const rem = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < n; i++) rem[i] ^= mul(g[i + 1], f);
  }
  return rem;
}

// Corrects `cw` (data + n ECC bytes) in place. Returns false if uncorrectable.
export function rsCorrect(cw, n) {
  const len = cw.length;
  const evalAt = (x) => cw.reduce((acc, c) => mul(acc, x) ^ c, 0);
  const S = [];
  let bad = false;
  for (let j = 0; j < n; j++) {
    S[j] = evalAt(EXP[j]);
    if (S[j]) bad = true;
  }
  if (!bad) return true;
  // Berlekamp-Massey: error locator C (lowest degree first)
  let C = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let k = 0; k < n; k++) {
    let d = S[k];
    for (let i = 1; i <= L; i++) d ^= mul(C[i] || 0, S[k - i]);
    if (!d) {
      m++;
      continue;
    }
    const T = C.slice();
    const coef = div(d, b);
    for (let i = 0; i < B.length; i++) C[i + m] = (C[i + m] || 0) ^ mul(coef, B[i]);
    if (2 * L <= k) {
      L = k + 1 - L;
      B = T;
      b = d;
      m = 1;
    } else m++;
  }
  if (2 * L > n) return false;
  const evalPoly = (p, x) => p.reduceRight((acc, c) => mul(acc, x) ^ (c || 0), 0);
  // Omega = S * C mod x^n
  const O = [];
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let j = 0; j <= i; j++) v ^= mul(S[j], C[i - j] || 0);
    O[i] = v;
  }
  let found = 0;
  for (let i = 0; i < len; i++) {
    const xi = EXP[(255 - i) % 255]; // X^-1 for position power i
    if (evalPoly(C, xi)) continue;
    let dv = 0;
    for (let k = 1; k < C.length; k += 2) dv ^= mul(C[k] || 0, EXP[(LOG[xi] * (k - 1)) % 255]);
    if (!dv) return false;
    const e = mul(EXP[i], div(evalPoly(O, xi), dv));
    cw[len - 1 - i] ^= e;
    found++;
  }
  if (found !== L) return false;
  for (let j = 0; j < n; j++) if (evalAt(EXP[j])) return false;
  return true;
}

// ---------- layout tables ----------
const ECC = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
};
const BLOCKS = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
};
const ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
const MAX_V = 10;

function rawModules(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const k = Math.floor(v / 7) + 2;
    r -= (25 * k - 10) * k - 55;
    if (v >= 7) r -= 36;
  }
  return r;
}

function alignPos(v) {
  if (v === 1) return [];
  const k = Math.floor(v / 7) + 2;
  const size = v * 4 + 17;
  const step = Math.ceil((v * 4 + 4) / (k * 2 - 2)) * 2;
  const r = [6];
  for (let p = size - 7; r.length < k; p -= step) r.splice(1, 0, p);
  return r;
}

const bit = (x, i) => (x >>> i) & 1;

function formatCode(ecl, mask) {
  const data = (ECL_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

// [ [x, y] ] positions of format copy 1 and copy 2, indexed by bit.
function formatPositions(n) {
  const a = [];
  const b = [];
  for (let i = 0; i < 15; i++) {
    a.push(i < 6 ? [8, i] : i === 6 ? [8, 7] : i === 7 ? [8, 8] : i === 8 ? [7, 8] : [14 - i, 8]);
    b.push(i < 8 ? [n - 1 - i, 8] : [8, n - 15 + i]);
  }
  return [a, b];
}

// Function patterns for a version: returns module values and a function mask.
function template(v) {
  const n = v * 4 + 17;
  const mod = new Uint8Array(n * n);
  const fn = new Uint8Array(n * n);
  const set = (x, y, d) => {
    mod[y * n + x] = d ? 1 : 0;
    fn[y * n + x] = 1;
  };
  for (let i = 0; i < n; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [n - 4, 3],
    [3, n - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
  }
  const ap = alignPos(v);
  for (const ay of ap)
    for (const ax of ap) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === n - 7) || (ax === n - 7 && ay === 6)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  for (const copy of formatPositions(n)) for (const [x, y] of copy) set(x, y, 0);
  set(8, n - 8, 1);
  if (v >= 7) {
    let rem = v;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (v << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3);
      const c = Math.floor(i / 3);
      set(a, c, bit(bits, i));
      set(c, a, bit(bits, i));
    }
  }
  return { n, mod, fn };
}

function dataPositions(n, fn) {
  const pos = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
        if (!fn[y * n + x]) pos.push(y * n + x);
      }
  }
  return pos;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// Block layout: returns [blockCount, eccPerBlock, shortLen, numShort].
function blockInfo(v, ecl) {
  const nb = BLOCKS[ecl][v - 1];
  const raw = Math.floor(rawModules(v) / 8);
  return [nb, ECC[ecl][v - 1], Math.floor(raw / nb), nb - (raw % nb)];
}

const dataCapacity = (v, ecl) => Math.floor(rawModules(v) / 8) - ECC[ecl][v - 1] * BLOCKS[ecl][v - 1];

// Interleave order: yields [block, index] pairs (short blocks carry a dummy slot).
function* order(v, ecl) {
  const [nb, ec, shortLen, numShort] = blockInfo(v, ecl);
  for (let i = 0; i <= shortLen; i++)
    for (let j = 0; j < nb; j++) if (!(i === shortLen - ec && j < numShort)) yield [j, i];
}

// ---------- encoder ----------
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function penalty(m, n) {
  let p = 0;
  const lines = [];
  for (let y = 0; y < n; y++) {
    let row = '';
    let col = '';
    for (let x = 0; x < n; x++) {
      row += m[y * n + x];
      col += m[x * n + y];
    }
    lines.push(row, col);
  }
  for (const l of lines) {
    for (const run of l.match(/0{5,}|1{5,}/g) || []) p += run.length - 2;
    p += 40 * ((l.match(/(?=10111010000|00001011101)/g) || []).length);
  }
  let dark = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const c = m[y * n + x];
      dark += c;
      if (x < n - 1 && y < n - 1 && c === m[y * n + x + 1] && c === m[(y + 1) * n + x] && c === m[(y + 1) * n + x + 1]) p += 3;
    }
  return p + 10 * Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5);
}

// Returns { size, modules: Uint8Array(size*size) } with 1 = dark.
export function encodeQR(text, ecl = 'M') {
  const alnum = [...text].every((c) => ALNUM.includes(c));
  const bytes = alnum ? null : new TextEncoder().encode(text);
  const len = alnum ? text.length : bytes.length;
  for (let v = 1; v <= MAX_V; v++) {
    const ccBits = alnum ? (v < 10 ? 9 : 11) : v < 10 ? 8 : 16;
    const dataBits = alnum ? 11 * Math.floor(len / 2) + 6 * (len % 2) : len * 8;
    const cap = dataCapacity(v, ecl) * 8;
    if (4 + ccBits + dataBits > cap) continue;

    const bits = [];
    const push = (val, nbits) => {
      for (let i = nbits - 1; i >= 0; i--) bits.push(bit(val, i));
    };
    push(alnum ? 2 : 4, 4);
    push(len, ccBits);
    if (alnum) {
      for (let i = 0; i + 1 < len; i += 2) push(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
      if (len % 2) push(ALNUM.indexOf(text[len - 1]), 6);
    } else for (const b of bytes) push(b, 8);
    push(0, Math.min(4, cap - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xec; data.length < cap / 8; pad ^= 0xec ^ 0x11) data.push(pad);

    const [nb, ec, shortLen, numShort] = blockInfo(v, ecl);
    const blocks = [];
    for (let j = 0, k = 0; j < nb; j++) {
      const dl = shortLen - ec + (j < numShort ? 0 : 1);
      const d = data.slice(k, (k += dl));
      blocks.push([...d, ...(j < numShort ? [0] : []), ...rsEncode(d, ec)]);
    }
    const stream = [...order(v, ecl)].map(([j, i]) => blocks[j][i]);

    const { n, mod, fn } = template(v);
    const pos = dataPositions(n, fn);
    pos.forEach((p, i) => {
      mod[p] = i < stream.length * 8 ? bit(stream[i >> 3], 7 - (i & 7)) : 0;
    });
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const m = mod.slice();
      for (const p of pos) if (MASKS[mask](p % n, Math.floor(p / n))) m[p] ^= 1;
      const f = formatCode(ecl, mask);
      for (const copy of formatPositions(n)) copy.forEach(([x, y], i) => (m[y * n + x] = bit(f, i)));
      const score = penalty(m, n);
      if (!best || score < best.score) best = { score, m };
    }
    return { size: n, modules: best.m };
  }
  throw new Error('Too much data for a QR code');
}

// SVG path for the dark modules, with a 4-module quiet zone.
export function qrPath({ size, modules }) {
  let d = '';
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) if (modules[y * size + x]) d += `M${x + 4} ${y + 4}h1v1h-1z`;
  return d;
}

// ---------- decoder ----------

function binarize(gray, w, h) {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.floor(Math.min(w, h) / 10));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0];
      out[y * w + x] = gray[y * w + x] * (x1 - x0) * (y1 - y0) < s * 0.88 ? 1 : 0;
    }
  }
  return out;
}

function ratioOK(c) {
  const total = c[0] + c[1] + c[2] + c[3] + c[4];
  if (total < 7) return false;
  const m = total / 7;
  const v = m * 0.6;
  return (
    Math.abs(m - c[0]) < v && Math.abs(m - c[1]) < v && Math.abs(3 * m - c[2]) < 3 * v && Math.abs(m - c[3]) < v && Math.abs(m - c[4]) < v
  );
}

// Run lengths through (x, y) along one axis; returns refined centre and size.
function cross(bin, w, h, x, y, horiz) {
  const at = (i) => (horiz ? (i >= 0 && i < w ? bin[y * w + i] : -1) : i >= 0 && i < h ? bin[i * w + x] : -1);
  const p = horiz ? x : y;
  const c = [0, 0, 0, 0, 0];
  let i = p;
  while (at(i) === 1) c[2]++, i--;
  while (at(i) === 0) c[1]++, i--;
  while (at(i) === 1) c[0]++, i--;
  i = p + 1;
  while (at(i) === 1) c[2]++, i++;
  while (at(i) === 0) c[3]++, i++;
  while (at(i) === 1) c[4]++, i++;
  if (!ratioOK(c)) return null;
  return { center: i - c[4] - c[3] - c[2] / 2, size: (c[0] + c[1] + c[2] + c[3] + c[4]) / 7 };
}

function findFinders(bin, w, h) {
  const found = [];
  const add = (x, y, size) => {
    for (const f of found) {
      if (Math.abs(f.x - x) < f.size * 2 && Math.abs(f.y - y) < f.size * 2) {
        const k = f.count;
        f.x = (f.x * k + x) / (k + 1);
        f.y = (f.y * k + y) / (k + 1);
        f.size = (f.size * k + size) / (k + 1);
        f.count++;
        return;
      }
    }
    found.push({ x, y, size, count: 1 });
  };
  for (let y = 0; y < h; y++) {
    const c = [0, 0, 0, 0, 0];
    let s = 0;
    for (let x = 0; x <= w; x++) {
      const dark = x < w && bin[y * w + x] === 1;
      if (dark) {
        if (s & 1) s++;
        c[s]++;
      } else if (s & 1) c[s]++;
      else if (s === 0 && !c[0]) continue;
      else if (s < 4) c[++s]++;
      else {
        if (ratioOK(c)) {
          const cx = x - c[4] - c[3] - c[2] / 2;
          const v = cross(bin, w, h, Math.round(cx), y, false);
          if (v) {
            const hz = cross(bin, w, h, Math.round(cx), Math.round(v.center), true);
            if (hz) add(hz.center, v.center, (hz.size + v.size) / 2);
          }
        }
        c[0] = c[2];
        c[1] = c[3];
        c[2] = c[4];
        c[3] = 1;
        c[4] = 0;
        s = 3;
      }
    }
  }
  return found;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pickThree(found) {
  // Real finder patterns are hit on many scan rows; stray matches on few.
  const top = Math.max(0, ...found.map((f) => f.count));
  const cands = found.filter((f) => f.count >= Math.max(2, top * 0.25));
  const pool = (cands.length >= 3 ? cands : found).sort((a, b) => b.count - a.count).slice(0, 10);
  let best = null;
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++)
      for (let k = j + 1; k < pool.length; k++) {
        const p = [pool[i], pool[j], pool[k]];
        const d = [dist(p[1], p[2]), dist(p[0], p[2]), dist(p[0], p[1])];
        const hi = d.indexOf(Math.max(...d));
        const legs = d.filter((_, q) => q !== hi);
        const sizes = p.map((f) => f.size);
        const score =
          Math.abs(legs[0] - legs[1]) / Math.max(...legs) +
          Math.abs(d[hi] - Math.hypot(legs[0], legs[1])) / d[hi] +
          (0.5 * (Math.max(...sizes) - Math.min(...sizes))) / Math.max(...sizes) +
          0.3 * (1 - Math.min(...p.map((f) => f.count)) / top);
        if (!best || score < best.score) best = { score, p, hi };
      }
  if (!best || best.score > 0.5) return null;
  const tl = best.p[best.hi];
  let [a, b] = best.p.filter((_, q) => q !== best.hi);
  if ((a.x - tl.x) * (b.y - tl.y) - (a.y - tl.y) * (b.x - tl.x) < 0) [a, b] = [b, a];
  return { tl, tr: a, bl: b };
}

// Perspective transform mapping 4 src points to 4 dst points.
function homography(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    if (Math.abs(A[c][c]) < 1e-9) return null;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const H = A.map((row, i) => row[8] / row[i]);
  return (x, y) => {
    const z = H[6] * x + H[7] * y + 1;
    return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z];
  };
}

function findAlignment(bin, w, h, px, py, ms) {
  const at = (x, y) => {
    x = Math.round(x);
    y = Math.round(y);
    return x >= 0 && y >= 0 && x < w && y < h ? bin[y * w + x] : -1;
  };
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  // Score dark pixels near the prediction (perspective can push the real
  // pattern several modules away), cluster the good ones, and return cluster
  // centres best first. The caller tries each until one decodes.
  const groups = [];
  const r = Math.ceil(ms * 8);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const x = px + dx;
      const y = py + dy;
      if (at(x, y) !== 1) continue;
      let score = 0;
      for (const [ux, uy] of dirs) {
        if (at(x + ux * ms, y + uy * ms) === 0) score++;
        if (at(x + ux * ms * 2, y + uy * ms * 2) === 1) score++;
      }
      if (score < 12) continue;
      let g = groups.find((q) => Math.abs(q.x / q.k - x) < ms && Math.abs(q.y / q.k - y) < ms);
      if (!g) groups.push((g = { x: 0, y: 0, k: 0, score: 0, d: dx * dx + dy * dy }));
      g.x += x;
      g.y += y;
      g.k++;
      g.score = Math.max(g.score, score);
    }
  return groups
    .sort((a, b) => b.score - a.score || a.d - b.d)
    .slice(0, 4)
    .map((g) => ({ x: g.x / g.k + 0.5, y: g.y / g.k + 0.5 }));
}

function sampleGrid(bin, w, h, map, n) {
  const m = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const [u, v] = map(x + 0.5, y + 0.5);
      const iu = Math.floor(u);
      const iv = Math.floor(v);
      if (iu < 0 || iv < 0 || iu >= w || iv >= h) return null;
      m[y * n + x] = bin[iv * w + iu];
    }
  return m;
}

function readFormat(m, n) {
  let best = null;
  for (const copy of formatPositions(n)) {
    let bits = 0;
    copy.forEach(([x, y], i) => (bits |= m[y * n + x] << i));
    for (const ecl of 'LMQH')
      for (let mask = 0; mask < 8; mask++) {
        let x = bits ^ formatCode(ecl, mask);
        let d = 0;
        for (; x; x &= x - 1) d++;
        if (!best || d < best.d) best = { d, ecl, mask };
      }
  }
  return best && best.d <= 3 ? best : null;
}

function parseData(bytes, v) {
  let pos = 0;
  const read = (n) => {
    let r = 0;
    for (let i = 0; i < n; i++, pos++) r = (r << 1) | bit(bytes[pos >> 3] || 0, 7 - (pos & 7));
    return r;
  };
  const total = bytes.length * 8;
  let out = '';
  while (pos + 4 <= total) {
    const mode = read(4);
    if (mode === 0) break;
    if (mode === 1) {
      let count = read(v < 10 ? 10 : 12);
      for (; count >= 3; count -= 3) out += String(read(10)).padStart(3, '0');
      if (count === 2) out += String(read(7)).padStart(2, '0');
      else if (count === 1) out += String(read(4));
    } else if (mode === 2) {
      let count = read(v < 10 ? 9 : 11);
      for (; count >= 2; count -= 2) {
        const x = read(11);
        out += ALNUM[Math.floor(x / 45)] + ALNUM[x % 45];
      }
      if (count) out += ALNUM[read(6)];
    } else if (mode === 4) {
      const count = read(v < 10 ? 8 : 16);
      const b = new Uint8Array(count);
      for (let i = 0; i < count; i++) b[i] = read(8);
      out += new TextDecoder().decode(b);
    } else if (mode === 7) read(8);
    else return null;
    if (pos > total) return null;
  }
  return out;
}

function decodeGrid(m, v) {
  const f = readFormat(m, v * 4 + 17);
  if (!f) return null;
  const { n, fn } = template(v);
  const pos = dataPositions(n, fn);
  const raw = new Uint8Array(Math.floor(rawModules(v) / 8));
  for (let i = 0; i < raw.length * 8; i++) {
    const p = pos[i];
    const b = m[p] ^ (MASKS[f.mask](p % n, Math.floor(p / n)) ? 1 : 0);
    raw[i >> 3] |= b << (7 - (i & 7));
  }
  const [nb, ec, shortLen, numShort] = blockInfo(v, f.ecl);
  const blocks = Array.from({ length: nb }, () => new Array(shortLen + 1).fill(0));
  let k = 0;
  for (const [j, i] of order(v, f.ecl)) blocks[j][i] = raw[k++];
  const data = [];
  for (let j = 0; j < nb; j++) {
    const b = j < numShort ? blocks[j].filter((_, i) => i !== shortLen - ec) : blocks[j];
    if (!rsCorrect(b, ec)) return null;
    data.push(...b.slice(0, b.length - ec));
  }
  return parseData(data, v);
}

// Decode a QR code from RGBA pixels ({ data, width, height }). Returns text or null.
export function decodeQR({ data, width: w, height: h }) {
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  const bin = binarize(gray, w, h);
  const three = pickThree(findFinders(bin, w, h));
  if (!three) return null;
  const { tl, tr, bl } = three;
  const ms = (tl.size + tr.size + bl.size) / 3;
  const est = (dist(tl, tr) + dist(tl, bl)) / 2 / ms + 7;
  const v0 = Math.round((est - 17) / 4);
  for (const v of [v0, v0 - 1, v0 + 1]) {
    if (v < 1 || v > MAX_V) continue;
    const n = v * 4 + 17;
    const src = [
      [3.5, 3.5],
      [n - 3.5, 3.5],
      [3.5, n - 3.5],
    ];
    const dst = [
      [tl.x, tl.y],
      [tr.x, tr.y],
      [bl.x, bl.y],
    ];
    const affine = (gx, gy) => {
      const a = (gx - 3.5) / (n - 7);
      const b = (gy - 3.5) / (n - 7);
      return [tl.x + a * (tr.x - tl.x) + b * (bl.x - tl.x), tl.y + a * (tr.y - tl.y) + b * (bl.y - tl.y)];
    };
    const maps = [];
    if (v >= 2) {
      const [px, py] = affine(n - 6.5, n - 6.5);
      const mod = (dist(tl, tr) / (n - 7) + dist(tl, bl) / (n - 7)) / 2;
      for (const al of findAlignment(bin, w, h, Math.round(px), Math.round(py), mod))
        maps.push(homography([...src, [n - 6.5, n - 6.5]], [...dst, [al.x, al.y]]));
    }
    maps.push(homography([...src, [n - 3.5, n - 3.5]], [...dst, affine(n - 3.5, n - 3.5)]));
    for (const map of maps) {
      if (!map) continue;
      const m = sampleGrid(bin, w, h, map, n);
      const text = m && decodeGrid(m, v);
      if (text != null) return text;
    }
  }
  return null;
}

export const _test = { homography };
