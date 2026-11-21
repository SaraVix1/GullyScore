import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, getState, addBall, setBowler, renamePlayer, upgradeMatch } from './engine.js';
import { withLog, note, undoLogged, verifyLog, describeEvent } from './editlog.js';

const mk = (o = {}) => createMatch({ teams: ['A', 'B'], players: 6, overs: 5, ...o });
const start = (m) => addBall(setBowler(m, 0), { runs: 4 });

test('a new match has an empty log and a series id; old matches get both', () => {
  const m = mk();
  assert.deepEqual(m.log, []);
  assert.ok(m.series);
  const old = upgradeMatch({ v: 1, id: 'x', teams: ['a', 'b'], rules: {}, innings: [[], []] });
  assert.deepEqual(old.log, []);
  assert.equal(old.series, 'x');
  assert.equal(mk({ series: 'S' }).series, 'S');
});

test('undo logs what was removed with the score before and after', () => {
  let m = start(mk());
  m = addBall(m, { runs: 1 });
  m = undoLogged(m);
  assert.equal(m.log.length, 1);
  const e = m.log[0];
  assert.match(e.what, /Undo: 1 run was removed/);
  assert.equal(e.from, '5/0');
  assert.equal(e.to, '4/0');
  assert.equal(e.ov, '0.2');
  assert.equal(getState(m).cur.runs, 4);
});

test('undoing an overthrow ball is described and fully reverses', () => {
  let m = setBowler(mk(), 0);
  m = addBall(m, { runs: 3, ot: 4 });
  assert.equal(describeEvent(m.innings[0].at(-1)), '7 runs (overthrow 4)');
  m = undoLogged(m);
  assert.equal(getState(m).cur.runs, 0);
  assert.equal(getState(m).cur.striker, 0);
});

test('entries are chained: editing, deleting or reordering shows up', () => {
  let m = start(mk());
  m = undoLogged(m);
  m = note(m, 'Scoring taken over on this phone');
  m = withLog(m, renamePlayer(m, 0, 0, 'Raju'), 'Renamed Player 1 to Raju');
  assert.equal(m.log.length, 3);
  assert.ok(verifyLog(m.log));
  const edited = m.log.map((e) => ({ ...e }));
  edited[0].to = '9/9';
  assert.equal(verifyLog(edited), false, 'changed score');
  assert.equal(verifyLog(m.log.filter((_, i) => i !== 1)), false, 'removed entry');
  assert.equal(verifyLog([...m.log].reverse()), false, 'reordered');
});

test('the log survives later scoring and undo', () => {
  let m = start(mk());
  m = undoLogged(m);
  m = addBall(m, { runs: 6 });
  m = undoLogged(m);
  assert.equal(m.log.length, 2);
  assert.equal(m.log[1].n, 2);
  assert.ok(verifyLog(m.log));
});
