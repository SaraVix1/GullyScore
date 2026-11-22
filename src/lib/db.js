// IndexedDB storage. One database, two stores:
//   kv       'current' -> the match being scored, 'prefs' -> setup defaults,
//            'next' -> teams kept by "Continue with same teams",
//            'share:<series>' -> phones allowed to join that series' room
//   history  finished matches, keyed by match id
// Each save runs in a single readwrite transaction, so a ball is either fully
// stored or not at all: a crash mid-write can never leave a half-saved match.
import { getState, upgradeMatch } from './engine.js';

const DB_NAME = 'gully-score';
const DB_VERSION = 1;
let dbPromise;

function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Run `fn(stores)` in one transaction; resolves with fn's request result once
// the transaction has committed.
async function run(names, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
    const req = fn(stores);
    tx.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

const isFinished = (m) => {
  try {
    return !!getState(m).result;
  } catch {
    return false;
  }
};

const historyRecord = (m) => ({ id: m.id, date: m.created, match: m });

// Save the live match. A match with a result is also kept in history; if an
// undo takes the result away again it leaves history until it finishes.
export function saveMatch(m) {
  return run(['kv', 'history'], 'readwrite', ({ kv, history }) => {
    kv.put(m, 'current');
    if (isFinished(m)) history.put(historyRecord(m));
    else history.delete(m.id);
  });
}

export async function loadCurrent() {
  return upgradeMatch(await run(['kv'], 'readonly', ({ kv }) => kv.get('current')));
}

export const clearCurrent = () => run(['kv'], 'readwrite', ({ kv }) => kv.delete('current'));

export async function loadPrefs() {
  return (await run(['kv'], 'readonly', ({ kv }) => kv.get('prefs'))) || {};
}

export const savePrefs = (p) => run(['kv'], 'readwrite', ({ kv }) => kv.put(p, 'prefs'));

// The next match's setup after "Continue with same teams": teams with their
// icons, colours and player names, so a refresh or restart keeps them.
// { players, overs, rules, teams: [{ name, icon, color, players: [names] }] }
export async function loadNextSetup() {
  const v = await run(['kv'], 'readonly', ({ kv }) => kv.get('next'));
  return v && Array.isArray(v.teams) && v.teams.length === 2 ? v : null;
}
export const saveNextSetup = (v) => run(['kv'], 'readwrite', ({ kv }) => kv.put(v, 'next'));
export const clearNextSetup = () => run(['kv'], 'readwrite', ({ kv }) => kv.delete('next'));

export async function listHistory() {
  const rows = await run(['history'], 'readonly', ({ history }) => history.getAll());
  return rows
    .map((r) => ({ ...r, match: upgradeMatch(r.match) }))
    .filter((r) => r.match)
    .sort((a, b) => b.date - a.date);
}

// A match's edit log lives inside the match record, so deleting the record
// removes the log completely. The saved "current" copy of a finished match is
// removed too, or "Resume match" would bring it (and its log) back.
const dropCurrent = (kv, when) => {
  const req = kv.get('current');
  req.onsuccess = () => req.result && when(req.result) && kv.delete('current');
};

export const deleteHistory = (id) =>
  run(['kv', 'history'], 'readwrite', ({ kv, history }) => {
    dropCurrent(kv, (m) => m.id === id);
    return history.delete(id);
  });

export const clearHistory = () =>
  run(['kv', 'history'], 'readwrite', ({ kv, history }) => {
    dropCurrent(kv, isFinished);
    return history.clear();
  });

// Finished matches of one series (for syncing it to another phone).
export async function listSeries(series) {
  return (await listHistory()).map((r) => r.match).filter((m) => m.series === series);
}

// Share list of a series: the phones allowed to join its room, [{ id, name }].
// Kept on the phone that opens the room; not synced and not in backups.
export async function loadShareList(series) {
  if (!series) return [];
  return (await run(['kv'], 'readonly', ({ kv }) => kv.get('share:' + series))) || [];
}
export const saveShareList = (series, list) => run(['kv'], 'readwrite', ({ kv }) => kv.put(list, 'share:' + series));

// ---------- backup ----------

export async function exportAll() {
  const [current, prefs, history] = await Promise.all([loadCurrent(), loadPrefs(), listHistory()]);
  return {
    app: 'gully-score',
    format: 1,
    exported: new Date().toISOString(),
    current,
    prefs,
    history: history.map((h) => h.match),
  };
}

// Merge a backup into this device. History is merged by match id; the saved
// in-progress match is restored only if this device has none. Returns counts.
export async function importAll(data) {
  if (!data || data.app !== 'gully-score' || !Array.isArray(data.history)) {
    throw new Error('Not a Gully Score backup file');
  }
  const matches = data.history.map(upgradeMatch).filter((m) => m && m.id && isFinished(m));
  const current = upgradeMatch(data.current);
  const hasCurrent = !!(await loadCurrent());
  let restoredCurrent = false;
  await run(['kv', 'history'], 'readwrite', ({ kv, history }) => {
    for (const m of matches) history.put(historyRecord(m));
    if (current && !hasCurrent) {
      kv.put(current, 'current');
      if (isFinished(current)) history.put(historyRecord(current));
      restoredCurrent = true;
    }
  });
  return { matches: matches.length, restoredCurrent };
}

// One-time move of data saved by the first (localStorage) version.
export async function migrateLocalStorage() {
  try {
    const raw = localStorage.getItem('gullyscore.match.v1');
    const prefs = localStorage.getItem('gullyscore.prefs.v1');
    if (raw && !(await loadCurrent())) {
      const m = upgradeMatch(JSON.parse(raw));
      if (m) await saveMatch(m);
    }
    if (prefs) await savePrefs(JSON.parse(prefs));
    localStorage.removeItem('gullyscore.match.v1');
    localStorage.removeItem('gullyscore.prefs.v1');
  } catch {
    /* nothing to migrate */
  }
}

export function requestPersistence() {
  return navigator.storage?.persist?.().catch(() => false) ?? Promise.resolve(false);
}

// A watching phone keeps finished matches in its own history too.
export function saveToHistory(m) {
  if (!isFinished(m)) return Promise.resolve();
  return run(['history'], 'readwrite', ({ history }) => history.put(historyRecord(m)));
}

// Random id for this phone, used to decide who is the live scorer.
export async function deviceId() {
  let id = await run(['kv'], 'readonly', ({ kv }) => kv.get('device'));
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    await run(['kv'], 'readwrite', ({ kv }) => kv.put(id, 'device'));
  }
  return id;
}
