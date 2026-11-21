// Checks the contrast of the main colour pairs in both themes, straight from
// the variables in app.css, plus the automatic ink for any accent or team colour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrast, inkFor, COLORS, TEAMS, badgeFor } from './teams.js';
import { PRESETS, accentText, BG } from './theme.js';

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
const block = (sel) => css.slice(css.indexOf(sel + ' {')).split('}')[0];
const vars = (b) => Object.fromEntries([...b.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
const dark = vars(block(':root'));
const light = { ...dark, ...vars(block(":root[data-theme='light']")) };

// [foreground, background, minimum ratio]
const PAIRS = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'surface-2', 4.5], ['text', 'surface-3', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['muted', 'surface-2', 4.5], ['muted', 'surface-3', 4.5],
  ['dim', 'bg', 4.5], ['dim', 'surface', 4.5], ['dim', 'surface-2', 4.5],
  ['accent-ink', 'accent', 4.5], ['red-ink', 'red', 4.5], ['amber-ink', 'amber', 4.5],
  ['blue-ink', 'blue', 4.5], ['six-ink', 'six', 4.5], ['toast-ink', 'toast-bg', 4.5],
  ['accent', 'bg', 3], ['line', 'bg', 3],
];

for (const [name, v] of [['dark', dark], ['light', light]]) {
  test(`${name} theme: main colour pairs are readable`, () => {
    for (const [fg, bg, min] of PAIRS) {
      assert.ok(v[fg] && v[bg], `missing --${fg} or --${bg}`);
      const r = contrast(v[fg], v[bg]);
      assert.ok(r >= min, `${name}: --${fg} ${v[fg]} on --${bg} ${v[bg]} is ${r.toFixed(2)}:1, needs ${min}:1`);
    }
  });

  test(`${name} theme: theme-color matches the page background`, () => {
    assert.equal(v.bg.toLowerCase(), BG[name]);
  });

  test(`${name} theme: any accent gives readable button text and accent text`, () => {
    const samples = [...PRESETS, ...COLORS, '#000000', '#ffffff', '#808080', '#0000ff', '#ffff00', '#123456'];
    for (const c of samples) {
      assert.ok(contrast(inkFor(c), c) >= 4.5, `ink on ${c}`);
      for (const bg of [v.bg, v.surface, v['surface-3']]) {
        const t = accentText(c, name);
        assert.ok(contrast(t, bg) >= 4.5, `${name}: accent text ${t} from ${c} on ${bg}`);
      }
    }
  });
}

test('team colours: automatic text has 4.5:1 and the icon badge stands out', () => {
  for (const c of [...new Set([...COLORS, ...TEAMS.map((t) => t.color)])]) {
    assert.ok(contrast(inkFor(c), c) >= 4.5, `text on ${c}`);
    assert.ok(contrast(badgeFor(c).bg, c) >= 1.4 || contrast(badgeFor(c).ring, c) >= 3, `badge on ${c}`);
  }
});
