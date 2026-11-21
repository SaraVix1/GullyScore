// Built-in team identities: name, emoji icon and a bright colour.
// Emoji + CSS colours only, no image files.
export const COLORS = [
  '#FFD60A', // yellow
  '#FF7A1A', // orange
  '#F5B700', // gold
  '#3DA5FF', // blue
  '#FF4D4D', // red
  '#34D399', // green
  '#A57BFF', // purple
  '#FF5CB8', // pink
  '#22D3EE', // cyan
  '#A3E635', // lime
  '#F43F5E', // crimson
  '#818CF8', // indigo
  '#2DD4BF', // teal
  '#E879F9', // magenta
  '#D6A86A', // sand
  '#CBD5E1', // silver
];

export const TEAMS = [
  { name: 'Thunder Strikers', icon: '⚡', color: '#FFD60A' },
  { name: 'Royal Warriors', icon: '⚔️', color: '#F43F5E' },
  { name: 'Fire Hawks', icon: '🔥', color: '#FF7A1A' },
  { name: 'Super Kings', icon: '👑', color: '#A57BFF' },
  { name: 'Blazing Bulls', icon: '🐂', color: '#FF4D4D' },
  { name: 'Storm Riders', icon: '🌩️', color: '#3DA5FF' },
  { name: 'Rockets', icon: '🚀', color: '#FF5CB8' },
  { name: 'Street Lions', icon: '🦁', color: '#F5B700' },
  { name: 'Desert Eagles', icon: '🦅', color: '#D6A86A' },
  { name: 'Night Riders', icon: '🌙', color: '#818CF8' },
  { name: 'Golden Tigers', icon: '🐯', color: '#F5B700' },
  { name: 'Red Dragons', icon: '🐉', color: '#FF4D4D' },
  { name: 'Iron Wolves', icon: '🐺', color: '#CBD5E1' },
  { name: 'Silver Sharks', icon: '🦈', color: '#2DD4BF' },
  { name: 'Black Panthers', icon: '🐾', color: '#A3E635' },
  { name: 'Sky Blasters', icon: '💥', color: '#22D3EE' },
  { name: 'Mighty Titans', icon: '💪', color: '#E879F9' },
  { name: 'Cyclone Kings', icon: '🌀', color: '#22D3EE' },
  { name: 'Phoenix Flames', icon: '☄️', color: '#FF7A1A' },
  { name: 'Victory Vipers', icon: '🐍', color: '#34D399' },
  { name: 'Gully Gladiators', icon: '🏏', color: '#A3E635' },
  { name: 'Lane Legends', icon: '🌟', color: '#FFD60A' },
  { name: 'Boundary Bandits', icon: '🎯', color: '#FF5CB8' },
  { name: 'Six Hitters', icon: '💣', color: '#A57BFF' },
];

export const ICONS = [
  '⚡', '🔥', '🦁', '🌩️', '👑', '⚔️', '🐂', '🚀', '🦅', '🌙', '🐯', '🐉',
  '🐺', '🦈', '🐾', '💥', '💪', '🌀', '☄️', '🐍', '🏏', '🌟', '🎯', '💣',
  '🦊', '🐻', '🦍', '🐘', '🦂', '🐝', '🦖', '🏆', '🛡️', '🎸', '🌶️', '🥷',
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// A new random team that clashes with none of `others` by name or colour.
export function randomTeam(...others) {
  const names = others.map((t) => t?.name);
  const colors = others.map((t) => t?.color);
  const pool = TEAMS.filter((t) => !names.includes(t.name) && !colors.includes(t.color));
  return { ...pick(pool.length ? pool : TEAMS) };
}

export function randomTeams() {
  const a = randomTeam();
  return [a, randomTeam(a)];
}

export function presetFor(name) {
  return TEAMS.find((t) => t.name.toLowerCase() === String(name).trim().toLowerCase());
}

// Relative luminance (WCAG) of a #rrggbb colour, 0 (black) to 1 (white).
export function luminance(hex) {
  const n = parseInt(String(hex).slice(1, 7), 16);
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

// WCAG contrast ratio between two #rrggbb colours (1 to 21).
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const DARK_INK = '#0a0d05';

// Dark or white text, whichever has the higher contrast on `hex`.
export function inkFor(hex) {
  return contrast(hex, DARK_INK) >= contrast(hex, '#ffffff') ? DARK_INK : '#ffffff';
}

// The round badge behind a team's emoji. Emoji have fixed colours, so a yellow
// bolt vanishes on a yellow card: the badge always gives it a white backing,
// ringed dark on light team colours and light on dark ones.
export function badgeFor(hex) {
  return luminance(hex) > 0.179
    ? { bg: '#ffffff', ring: '#0b1020' }
    : { bg: '#f3f5fb', ring: '#ffffff' };
}
