// Edit log: an append-only record of every Undo, rename, retirement, bowler or
// batter change, strike swap, penalty and scorer takeover. It lives inside the
// match object, so it is saved, exported, synced and deleted together with the
// match. Entries are chained: each stores a hash of the one before it, so an
// edited or removed entry shows up as "does not verify". (This is a tamper
// *evident* seal, not cryptographic security: it deters casual changes.)
import { getState, oversText, peekUndo, undo } from './engine.js';

// cyrb53: small, fast, non-cryptographic 53-bit string hash.
function hash(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const seal = (e) => hash([e.prev, e.n, e.at, e.ov, e.what, e.from, e.to].join('|'));

function snapshot(m) {
  const s = getState(m).cur;
  return { score: `${s.runs}/${s.wickets}`, ov: oversText(s.balls) };
}

// Add an entry for the change `before` -> `after` and return `after` with it.
export function withLog(before, after, what) {
  const log = before.log || [];
  const a = snapshot(before);
  const b = snapshot(after);
  const e = { n: log.length + 1, at: Date.now(), ov: a.ov, what, from: a.score, to: b.score, prev: log.at(-1)?.h || '' };
  e.h = seal(e);
  return { ...after, log: [...log, e] };
}

// Log an entry that changes nothing in the score (a takeover, for instance).
export const note = (m, what) => withLog(m, m, what);

export function verifyLog(log = []) {
  let prev = '';
  return log.every((e, i) => e.n === i + 1 && e.prev === prev && e.h === seal(e) && ((prev = e.h), true));
}

const EXTRA = { wd: 'wide', nb: 'no ball', b: 'bye', lb: 'leg bye' };

// "a 4", "7 runs (ran 3 + 4 overthrow)", "a wide", "a wicket (caught)" ...
export function describeEvent(ev) {
  if (ev.t === 'penalty') return `${ev.runs} penalty runs`;
  if (ev.t === 'retire') return ev.kind === 'out' ? 'a retired-out batter' : 'a retired-hurt batter';
  if (ev.t !== 'ball') return 'an action';
  const r = (ev.runs || 0) + (ev.ot || 0);
  const parts = [];
  if (ev.wicket) parts.push(`a wicket (${ev.wicket.how})`);
  if (ev.extra) parts.push(`a ${EXTRA[ev.extra]}`);
  if (r || (!ev.wicket && !ev.extra)) parts.push(!ev.extra && !ev.wicket && r === 0 ? 'a dot ball' : `${r} ${r === 1 ? 'run' : 'runs'}`);
  let t = parts.join(' + ');
  if (ev.ot) t += ` (overthrow ${ev.ot})`;
  return t;
}

// Undo, with its log entry ("Undo at 4.2: a 4 was removed").
export function undoLogged(m) {
  const p = peekUndo(m);
  if (!p) return m;
  return withLog(m, undo(m), p.superOver ? 'Undo: the unplayed Super Over was cancelled' : `Undo: ${describeEvent(p.ev)} was removed`);
}
