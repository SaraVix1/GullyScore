// Room codes, limits and this phone's own sync settings. Pure helpers are
// unit-tested; storage helpers use localStorage and never throw.
import { STUN_URLS, TURN_URLS, ROOM_TTL_MS } from './syncConfig.js';

// 32 symbols without 0, 1, I and O (easy to read aloud and type).
const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LEN = 12; // 60 random bits

export function makeRoomCode(rand = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const raw = Array.from(rand(LEN), (b) => ALPHA[b & 31]).join('');
  return raw.match(/.{4}/g).join('-');
}

// Accepts a typed code (any case, spaces or dashes) or a scanned room link.
// Returns the code as XXXX-XXXX-XXXX, or null.
export function parseRoomCode(text) {
  const s = String(text || '');
  const fromLink = s.match(/[#?&]room=([A-Za-z0-9-]+)/);
  const clean = (fromLink ? fromLink[1] : s).toUpperCase().replace(/[\s-]/g, '');
  if (clean.length !== LEN || [...clean].some((c) => !ALPHA.includes(c))) return null;
  return clean.match(/.{4}/g).join('-');
}

export const roomLink = (base, code) => base.replace(/#.*$/, '') + '#room=' + code;
export const peerIdFor = (prefix, code) => prefix + code.replace(/-/g, '').toLowerCase();
export const isExpired = (last, now = Date.now()) => !last || now - last > ROOM_TTL_MS;

// Token bucket: returns a function that says whether one more message may pass.
export function createLimiter({ burst, perSec }, now = () => Date.now()) {
  let tokens = burst;
  let t = now();
  return () => {
    const n = now();
    tokens = Math.min(burst, tokens + ((n - t) * perSec) / 1000);
    t = n;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };
}

export function iceServers(turn) {
  const list = [{ urls: STUN_URLS }];
  if (turn?.username && turn?.credential) list.push({ urls: TURN_URLS, username: turn.username, credential: turn.credential });
  return list;
}

export const mask = (s) => (!s ? '' : s.length <= 6 ? '••••••' : s.slice(0, 2) + '••••••' + s.slice(-2));

// ---------- saved on this phone only (never synced, never in backups) ----------

const read = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null');
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
};

// TURN key from the user's own Open Relay account: { username, credential }.
export const loadTurn = () => read('gully-turn');
export const saveTurn = (username, credential) => write('gully-turn', { username, credential });
export const clearTurn = () => write('gully-turn', null);

// The last room, so a reload can reopen or rejoin it: { code, host, series, last }.
export const loadRoom = () => {
  const r = read('gully-room');
  return r && !isExpired(r.last) ? r : null;
};
export const saveRoom = (r) => write('gully-room', r);
export const clearRoom = () => write('gully-room', null);

export const loadName = () => read('gully-name') || '';
export const saveName = (n) => write('gully-name', n);
