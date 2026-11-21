// Per-phone appearance: theme (system | light | dark) and accent colour.
// Stored in localStorage on this phone only (never synced). index.html runs a
// tiny copy of applyNow() before first paint so there is no flash.
import { contrast, inkFor } from './teams.js';

export const BG = { dark: '#040817', light: '#e9edf5' };
// The lightest panel in dark, the darkest panel in light: accent text must
// read on the page background and on these.
const PANEL = { dark: '#1b2c5c', light: '#dde3f0' };

export const PRESETS = ['#2dd4bf', '#ffd60a', '#ff7a1a', '#ff4d6d', '#c084fc', '#3da5ff', '#22d3ee', '#34d399'];

const THEME_KEY = 'gully-theme';
const ACCENT_KEY = 'gully-accent';

const read = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
  } catch {
    /* private mode: the choice lasts until the app closes */
  }
};

export const getMode = () => (['light', 'dark'].includes(read(THEME_KEY)) ? read(THEME_KEY) : 'system');
export const getAccent = () => {
  try {
    return JSON.parse(read(ACCENT_KEY))?.c || null;
  } catch {
    return null;
  }
};

const mix = (hex, to, t) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (sh) => Math.round(((n >> sh) & 255) * (1 - t) + to * t);
  return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
};

// The accent nudged lighter (dark theme) or darker (light theme) until it reads
// as text on the page and on panels, at 4.5:1 or better.
export function accentText(hex, theme) {
  const bgs = [BG[theme], PANEL[theme]];
  const ok = (c) => bgs.every((b) => contrast(c, b) >= 4.5);
  for (let t = 0; t <= 1.001; t += 0.05) {
    const c = mix(hex, theme === 'dark' ? 255 : 0, t);
    if (ok(c)) return c;
  }
  return theme === 'dark' ? '#ffffff' : '#000000';
}

export const resolved = (mode = getMode()) =>
  mode === 'light' || (mode === 'system' && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';

// Everything index.html needs to paint the right colours before the app loads.
function accentBundle(hex) {
  return JSON.stringify({ c: hex, i: inkFor(hex), t: { dark: accentText(hex, 'dark'), light: accentText(hex, 'light') } });
}

export function applyNow() {
  const root = document.documentElement;
  const mode = getMode();
  const theme = resolved(mode);
  root.dataset.theme = theme;
  root.dataset.mode = mode;
  document.getElementById('tc')?.setAttribute('content', BG[theme]);
  const hex = getAccent();
  for (const k of ['--accent', '--accent-ink', '--accent-text']) root.style.removeProperty(k);
  if (hex) {
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-ink', inkFor(hex));
    root.style.setProperty('--accent-text', accentText(hex, theme));
  }
}

export function setMode(mode) {
  write(THEME_KEY, mode === 'system' ? null : mode);
  applyNow();
}

// `hex` null goes back to the built-in accent.
export function setAccent(hex) {
  write(ACCENT_KEY, hex ? accentBundle(hex) : null);
  applyNow();
}

export function initTheme() {
  applyNow();
  // Follow the phone's theme live while the choice is "System".
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => getMode() === 'system' && applyNow());
}
