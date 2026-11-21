import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMatch,
  getState,
  addBall,
  setBowler,
  replaceBatter,
  swapStrike,
  undo,
  canUndo,
  renamePlayer,
  oversText,
  rate,
  howOut,
  addPenalty,
  retireBatter,
  startSuperOver,
  upgradeMatch,
} from './engine.js';

const teams = ['Fire Hawks', 'Storm Riders'];
const mk = (o = {}) => createMatch({ teams, players: 6, overs: 2, toss: { winner: 0, choice: 'bat' }, ...o });
const cur = (m) => getState(m).cur;

// Bowl a sequence of balls; numbers = runs, objects = full ball. Auto-picks
// alternating bowlers (players 0 and 1 of the fielding side) at each over.
function play(m, balls) {
  for (const b of balls) {
    const s = cur(m);
    if (s.needBowler) m = setBowler(m, s.prevBowler === 0 ? 1 : 0);
    m = addBall(m, typeof b === 'number' ? { runs: b } : b);
  }
  return m;
}
const W = (how = 'bowled', extra = {}) => ({ wicket: { how }, ...extra });
const dots = (n) => Array(n).fill(0);

test('toss decides who bats first', () => {
  assert.equal(mk().battingFirst, 0);
  assert.equal(mk({ toss: { winner: 0, choice: 'bowl' } }).battingFirst, 1);
  assert.equal(mk({ toss: { winner: 1, choice: 'bat' } }).battingFirst, 1);
  const s = cur(mk({ toss: { winner: 1, choice: 'bowl' } }));
  assert.equal(s.battingTeam, 0);
  assert.equal(s.bowlingTeam, 1);
});

test('auto player names and openers', () => {
  const m = mk({ players: 5 });
  assert.deepEqual(m.names[0], ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5']);
  const s = cur(m);
  assert.equal(s.striker, 0);
  assert.equal(s.nonStriker, 1);
  assert.equal(s.needBowler, true);
});

test('must pick a bowler before the first ball', () => {
  assert.throws(() => addBall(mk(), { runs: 1 }), /bowler/);
});

test('runs, strike rotation on odd runs, boundaries', () => {
  const m = play(mk(), [1, 4, 6, 2, 3]);
  const s = cur(m);
  assert.equal(s.runs, 16);
  assert.equal(s.balls, 5);
  assert.equal(s.batters[0].runs, 1);
  assert.equal(s.batters[1].runs, 15);
  assert.equal(s.batters[1].fours, 1);
  assert.equal(s.batters[1].sixes, 1);
  // after the 3 the strike moved back to player 0
  assert.equal(s.striker, 0);
  assert.deepEqual(s.thisOver.map((c) => c.label), ['1', '4', '6', '2', '3']);
});

test('strike rotates at end of over and a new bowler is required', () => {
  const m = play(mk(), dots(6));
  const s = cur(m);
  assert.equal(s.balls, 6);
  assert.equal(s.striker, 1);
  assert.equal(s.needBowler, true);
  assert.equal(s.prevBowler, 0);
  assert.equal(s.bowlers[0].maidens, 1);
  // over chips still visible until the next ball
  assert.equal(s.thisOver.length, 6);
  assert.throws(() => setBowler(m, 0), /two overs in a row/);
  const m2 = addBall(setBowler(m, 1), { runs: 1 });
  assert.equal(cur(m2).thisOver.length, 1);
});

test('single on last ball of over keeps striker on strike for next over', () => {
  const s = cur(play(mk(), [0, 0, 0, 0, 0, 1]));
  assert.equal(s.striker, 0);
});

test('wide: not a legal ball, run depends on rule', () => {
  let s = cur(play(mk(), [{ extra: 'wd' }]));
  assert.equal(s.runs, 1);
  assert.equal(s.balls, 0);
  assert.equal(s.extras.wd, 1);
  assert.equal(s.batters[0].balls, 0);
  assert.equal(s.bowlers[0].runs, 1);

  s = cur(play(mk({ rules: { wideRun: false } }), [{ extra: 'wd' }]));
  assert.equal(s.runs, 0);
  assert.equal(s.balls, 0);
  assert.equal(s.thisOver[0].label, 'wd');

  s = cur(play(mk(), [{ extra: 'wd', runs: 1 }]));
  assert.equal(s.runs, 2);
  assert.equal(s.extras.wd, 2);
  assert.equal(s.striker, 1, 'batters ran one');
});

test('over needs 6 legal balls', () => {
  const s = cur(play(mk(), [0, { extra: 'wd' }, 0, { extra: 'nb' }, 0, 0, 0, 0]));
  assert.equal(s.balls, 6);
  assert.equal(s.needBowler, true);
});

test('no ball: runs to batter, penalty by rule, ball faced but not legal', () => {
  let s = cur(play(mk(), [{ extra: 'nb', runs: 4 }]));
  assert.equal(s.runs, 5);
  assert.equal(s.extras.nb, 1);
  assert.equal(s.batters[0].runs, 4);
  assert.equal(s.batters[0].fours, 1);
  assert.equal(s.batters[0].balls, 1);
  assert.equal(s.balls, 0);

  s = cur(play(mk({ rules: { noBallRun: false } }), [{ extra: 'nb' }]));
  assert.equal(s.runs, 0);
});

test('free hit after no ball: only run out allowed, carries over a wide', () => {
  let m = play(mk(), [{ extra: 'nb' }]);
  assert.equal(cur(m).freeHit, true);
  assert.throws(() => addBall(m, W('bowled')), /Free hit/);
  m = addBall(m, { extra: 'wd' });
  assert.equal(cur(m).freeHit, true, 'still a free hit after a wide');
  m = addBall(m, { runs: 1 });
  assert.equal(cur(m).freeHit, false);

  const ro = addBall(play(mk(), [{ extra: 'nb' }]), { runs: 0, wicket: { how: 'runout', batter: 'striker' } });
  assert.equal(cur(ro).wickets, 1);

  assert.equal(cur(play(mk({ rules: { freeHit: false } }), [{ extra: 'nb' }])).freeHit, false);
});

test('byes and leg byes: team runs, not batter, respect rules', () => {
  const s = cur(play(mk(), [{ extra: 'b', runs: 2 }, { extra: 'lb', runs: 1 }]));
  assert.equal(s.runs, 3);
  assert.equal(s.extras.b, 2);
  assert.equal(s.extras.lb, 1);
  assert.equal(s.batters[0].runs, 0);
  assert.equal(s.batters[0].balls, 2);
  assert.equal(s.balls, 2);
  assert.equal(s.bowlers[0].runs, 0);
  assert.equal(s.striker, 1);

  const m = play(mk({ rules: { byes: false, legByes: false } }), [0]);
  assert.throws(() => addBall(m, { extra: 'b', runs: 1 }), /Byes are off/);
  assert.throws(() => addBall(m, { extra: 'lb', runs: 1 }), /Leg byes are off/);
});

test('wicket: next numbered batter comes in on strike, bowler credited', () => {
  const s = cur(play(mk(), [1, W('caught')]));
  assert.equal(s.wickets, 1);
  assert.equal(s.batters[1].out.how, 'caught');
  assert.equal(s.batters[1].out.bowler, 0);
  assert.equal(s.bowlers[0].wickets, 1);
  assert.equal(s.striker, 2);
  assert.equal(s.nonStriker, 0);
  assert.deepEqual(s.order, [0, 1, 2]);
  assert.deepEqual(s.fow[0], { wicket: 1, runs: 1, balls: 2, player: 1 });
});

test('run out: runs completed count, chosen batter out, no bowler credit', () => {
  const m = play(mk(), [{ runs: 1, wicket: { how: 'runout', batter: 'nonStriker' } }]);
  const s = cur(m);
  assert.equal(s.runs, 1);
  assert.equal(s.batters[0].runs, 1);
  assert.equal(s.batters[1].out.how, 'runout');
  assert.equal(s.bowlers[0].wickets, 0);
  // runs=1 so they crossed: P1 at non-striker end, P2 (out) was at striker end -> new batter on strike
  assert.equal(s.striker, 2);
  assert.equal(s.nonStriker, 0);
});

test('non run-out wickets must be the striker and score no runs', () => {
  const m = play(mk(), [0]);
  assert.throws(() => addBall(m, { wicket: { how: 'bowled', batter: 'nonStriker' } }), /non-striker/);
  const s = cur(addBall(m, { runs: 3, wicket: { how: 'bowled' } }));
  assert.equal(s.runs, 0);
});

test('all out at players-1 wickets by default', () => {
  const m = play(mk({ players: 3 }), [W(), W()]);
  const s = getState(m).innings[0];
  assert.equal(s.wickets, 2);
  assert.equal(s.done, true);
  assert.equal(s.endReason, 'allout');
  assert.equal(getState(m).current, 1);
});

test('last batter can play alone: keeps strike every ball', () => {
  let m = play(mk({ players: 3, rules: { lastManStands: true } }), [W(), W()]);
  let s = cur(m);
  assert.equal(s.done, false);
  assert.equal(s.striker, 1);
  assert.equal(s.nonStriker, null);
  m = play(m, [1, 1, 3, 0]); // ends over 1 too: still on strike
  s = cur(m);
  assert.equal(s.striker, 1);
  assert.equal(s.batters[1].runs, 5);
  m = setBowler(m, 1);
  assert.equal(cur(m).striker, 1, 'over change does not rotate a lone batter');
  assert.throws(() => swapStrike(m));
  assert.throws(() => addBall(m, { wicket: { how: 'runout', batter: 'nonStriker' } }), /non-striker/);
  m = play(m, [W()]);
  s = getState(m).innings[0];
  assert.equal(s.done, true);
  assert.equal(s.endReason, 'allout');
  assert.equal(s.wickets, 3);
});

test('last man alone when the non-striker is out', () => {
  const m = play(mk({ players: 3, rules: { lastManStands: true } }), [
    W(),
    { runs: 0, wicket: { how: 'runout', batter: 'nonStriker' } },
  ]);
  const s = cur(m);
  assert.equal(s.striker, 2);
  assert.equal(s.nonStriker, null);
});

test('innings ends when overs are done; second innings shows target', () => {
  const m = play(mk(), [...dots(11), 4]);
  const st = getState(m);
  assert.equal(st.innings[0].done, true);
  assert.equal(st.innings[0].endReason, 'overs');
  assert.equal(st.current, 1);
  assert.equal(st.target, 5);
  assert.equal(st.cur.need, 5);
  assert.equal(st.cur.ballsLeft, 12);
  assert.equal(st.cur.battingTeam, 1);
  assert.equal(st.cur.needBowler, true);
  assert.throws(() => addBall(m, { runs: 1 }), /bowler/);
});

test('chase complete: win by wickets', () => {
  const m = play(mk(), [...dots(11), 4, 1, W(), 4]);
  const st = getState(m);
  assert.equal(st.innings[1].endReason, 'target');
  assert.equal(st.result.winner, 1);
  assert.equal(st.result.by, 'wickets');
  assert.equal(st.result.margin, 4);
  assert.equal(st.result.text, 'Storm Riders won by 4 wickets');
  assert.match(st.result.detail, /9 balls/);
  assert.throws(() => addBall(m, { runs: 1 }), /over/);
});

test('defend: win by runs, and tie', () => {
  const won = getState(play(mk(), [...dots(11), 4, ...dots(11), 2]));
  assert.equal(won.result.winner, 0);
  assert.equal(won.result.text, 'Fire Hawks won by 2 runs');
  const tie = getState(play(mk(), [...dots(11), 4, ...dots(11), 4]));
  assert.equal(tie.result.by, 'tie');
  assert.equal(tie.result.winner, null);
});

test('undo reverts balls one at a time, including strike, overs, wickets, extras', () => {
  const m0 = play(mk(), [1, 2]);
  const before = cur(m0);
  const m1 = play(m0, [{ extra: 'wd', runs: 1 }, W(), { extra: 'nb' }, 3, 0, 0]);
  assert.equal(cur(m1).needBowler, true);
  let m = m1;
  for (let i = 0; i < 6; i++) m = undo(m);
  assert.deepEqual(cur(m), before);
  m = undo(undo(m));
  assert.equal(cur(m).runs, 0);
  assert.equal(cur(m).needBowler, false, 'bowler pick before first ball is kept');
  assert.equal(canUndo(m), false);
  assert.equal(undo(m), m);
});

test('undo also drops a bowler pick made after the last ball', () => {
  let m = play(mk(), dots(6));
  m = setBowler(m, 1);
  m = undo(m);
  const s = cur(m);
  assert.equal(s.balls, 5);
  assert.equal(s.bowler, 0);
});

test('undo crosses back into the first innings', () => {
  let m = play(mk(), [...dots(11), 4]);
  m = setBowler(m, 0);
  m = undo(m);
  const st = getState(m);
  assert.equal(st.current, 0);
  assert.equal(st.cur.balls, 11);
  assert.equal(st.cur.runs, 0);
  // and from a finished match
  const done = play(mk(), [...dots(11), 4, ...dots(11), 2]);
  assert.ok(getState(done).result);
  assert.equal(getState(undo(done)).result, null);
});

test('bowler can be changed mid-over; figures tracked separately', () => {
  let m = setBowler(mk(), 3);
  m = setBowler(m, 4);
  assert.equal(cur(m).bowler, 4);
  m = addBall(m, { runs: 4 });
  m = addBall(m, { runs: 0 });
  assert.throws(() => setBowler(m, 4), /Already/);
  m = setBowler(m, 2);
  m = play(m, [1, 0, 0, 0]);
  const s = cur(m);
  assert.equal(s.bowlers[4].balls, 2);
  assert.equal(s.bowlers[4].runs, 4);
  assert.equal(s.bowlers[2].balls, 4);
  assert.equal(s.bowlers[2].runs, 1);
  assert.equal(s.bowlers[3].balls, 0);
  assert.deepEqual(s.bowlerOrder, [4, 2]);
  assert.equal(s.prevBowler, 2, 'whoever finished the over cannot bowl the next');
  assert.throws(() => setBowler(m, 2), /two overs/);
});

test('no maiden when two bowlers share a scoreless over', () => {
  let m = setBowler(mk(), 0);
  m = play(m, [0, 0, 0]);
  m = setBowler(m, 1);
  m = play(m, [0, 0, 0]);
  const s = cur(m);
  assert.equal(s.bowlers[0].maidens + s.bowlers[1].maidens, 0);
});

test('replace a batter who has not faced yet', () => {
  let m = replaceBatter(setBowler(mk(), 0), 1, 4);
  let s = cur(m);
  assert.equal(s.nonStriker, 4);
  assert.deepEqual(s.order, [0, 4]);
  m = play(m, [W()]); // striker 0 out -> next unbatted is player 1
  s = cur(m);
  assert.equal(s.striker, 1);
  assert.throws(() => replaceBatter(m, 0, 5), /faced/);
  assert.throws(() => replaceBatter(m, 1, 4), /already batted/);
});

test('swap strike manually', () => {
  const s = cur(swapStrike(setBowler(mk(), 0)));
  assert.equal(s.striker, 1);
});

test('bowler figures', () => {
  const s = cur(play(mk(), [4, { extra: 'wd' }, W(), { extra: 'lb', runs: 1 }, 0, 0, 0]));
  const b = s.bowlers[0];
  assert.equal(b.balls, 6);
  assert.equal(b.runs, 5);
  assert.equal(b.wickets, 1);
  assert.equal(b.maidens, 0);
  assert.deepEqual(s.bowlerOrder, [0]);
});

test('maiden counts byes but not wides', () => {
  assert.equal(cur(play(mk(), [{ extra: 'b', runs: 4 }, 0, 0, 0, 0, 0])).bowlers[0].maidens, 1);
  assert.equal(cur(play(mk(), [{ extra: 'wd' }, 0, 0, 0, 0, 0, 0])).bowlers[0].maidens, 0);
});

test('rename player and match stays JSON serialisable', () => {
  let m = renamePlayer(mk(), 0, 2, '  Raju  ');
  assert.equal(m.names[0][2], 'Raju');
  m = renamePlayer(m, 0, 2, '');
  assert.equal(m.names[0][2], 'Player 3');
  m = play(m, [1, 2, W()]);
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
});

test('formatting helpers', () => {
  assert.equal(oversText(27), '4.3');
  assert.equal(oversText(60), '10.0');
  assert.equal(rate(45, 27), '10.00');
  assert.equal(rate(0, 0), '0.00');
  assert.equal(howOut(null), 'not out');
  assert.equal(howOut({ how: 'bowled' }, 'Ravi'), 'b Ravi');
  assert.equal(howOut({ how: 'runout' }, 'Ravi'), 'run out');
});

test('penalty to batting side adds runs and extras, no ball counted', () => {
  let m = setBowler(mk(), 0);
  m = addPenalty(m, 0, 5);
  const s = cur(m);
  assert.equal(s.runs, 5);
  assert.equal(s.extras.p, 5);
  assert.equal(s.extrasTotal, 5);
  assert.equal(s.balls, 0);
  assert.equal(s.bowlers[0].runs, 0);
  assert.throws(() => addPenalty(m, 0, 0));
});

test('penalty to fielding side goes to their innings', () => {
  // in the first innings: credited to the chasing side's innings
  let m = addPenalty(setBowler(mk(), 0), 1, 5);
  assert.equal(cur(m).runs, 0);
  assert.equal(cur(m).penaltyToFielding, 5);
  m = play(m, [...dots(11), 6]);
  let st = getState(m);
  assert.equal(st.target, 7);
  assert.equal(st.cur.runs, 5, 'chasing side starts on 5');
  assert.equal(st.cur.need, 2);
  // in the second innings: added to the first innings total, target goes up
  m = addPenalty(setBowler(m, 0), 0, 5);
  st = getState(m);
  assert.equal(st.innings[0].runs, 11);
  assert.equal(st.target, 12);
  assert.equal(st.cur.need, 7);
});

test('carried-in penalty runs that reach the target end the chase', () => {
  let m = addPenalty(setBowler(mk(), 0), 1, 5);
  m = play(m, [...dots(11), 4]);
  const st = getState(m);
  assert.equal(st.innings[1].endReason, 'target');
  assert.equal(st.result.winner, 1);
});

test('penalty can win the chase', () => {
  let m = play(mk(), [...dots(11), 4]);
  m = setBowler(m, 0);
  m = addPenalty(m, 1, 5);
  const st = getState(m);
  assert.equal(st.result.winner, 1);
  assert.equal(st.result.by, 'wickets');
});

test('retired hurt: not a wicket, next batter in, can come back later', () => {
  let m = play(mk({ players: 3 }), [2]);
  m = retireBatter(m, 'striker', 'hurt');
  let s = cur(m);
  assert.equal(s.wickets, 0);
  assert.equal(s.batters[0].out.how, 'retiredhurt');
  assert.equal(s.striker, 2);
  assert.deepEqual(s.order, [0, 1, 2]);
  // wicket: nobody new left, so the retired batter returns
  m = play(m, [W()]);
  s = cur(m);
  assert.equal(s.wickets, 1);
  assert.equal(s.striker, 0);
  assert.equal(s.batters[0].out, null);
  assert.equal(s.batters[0].runs, 2, 'keeps earlier runs');
  m = play(m, [3]);
  assert.equal(cur(m).batters[0].runs, 5);
});

test('retired hurt batter can be chosen to come back by swapping the new batter', () => {
  let m = play(mk({ players: 4 }), [1]);
  m = retireBatter(m, 'nonStriker', 'hurt'); // player 0 (on non-strike after the single)
  let s = cur(m);
  assert.equal(s.nonStriker, 2);
  m = play(m, [W()]); // striker 1 out -> player 3 in
  s = cur(m);
  assert.equal(s.striker, 3);
  m = replaceBatter(m, 3, 0); // send player 0 back instead
  s = cur(m);
  assert.equal(s.striker, 0);
  assert.equal(s.batters[0].out, null);
  assert.ok(!s.order.includes(3));
  m = replaceBatter(m, 0, 3); // and undo that choice
  s = cur(m);
  assert.equal(s.striker, 3);
  assert.equal(s.batters[0].out.how, 'retiredhurt');
});

test('retired out counts as a wicket', () => {
  let m = setBowler(mk({ players: 3 }), 0);
  m = retireBatter(m, 'striker', 'out');
  let s = cur(m);
  assert.equal(s.wickets, 1);
  assert.equal(s.fow.length, 1);
  assert.equal(s.bowlers[0].wickets, 0);
  m = retireBatter(m, 'striker', 'out');
  assert.equal(getState(m).innings[0].endReason, 'allout');
});

test('retiring the last available batter ends the innings', () => {
  let m = play(mk({ players: 3 }), [W()]);
  m = retireBatter(m, 'striker', 'hurt');
  assert.equal(getState(m).innings[0].done, true);
});

test('undo removes a penalty or retirement on its own', () => {
  let m = play(mk(), [1, 2]);
  const before = cur(m);
  m = undo(retireBatter(addPenalty(m, 0, 5), 'striker', 'hurt'));
  assert.equal(cur(m).runs, 8);
  m = undo(m);
  assert.deepEqual(cur(m), before);
});

const tied = () => play(mk(), [...dots(11), 4, ...dots(11), 4]);

test('super over: one over, two wickets, team batting second bats first', () => {
  let m = tied();
  let st = getState(m);
  assert.equal(st.result.by, 'tie');
  assert.equal(st.canSuperOver, true);
  assert.throws(() => startSuperOver(play(mk(), [...dots(11), 4, ...dots(11), 2])));
  m = startSuperOver(m);
  st = getState(m);
  assert.equal(st.result, null);
  assert.equal(st.mainResult.by, 'tie');
  assert.equal(st.current, 2);
  assert.equal(st.cur.superOver, true);
  assert.equal(st.cur.battingTeam, 1);
  assert.equal(st.cur.maxBalls, 6);
  assert.equal(st.cur.maxWickets, 2);
  m = play(m, [6, W(), W()]);
  st = getState(m);
  assert.equal(st.innings[2].endReason, 'allout');
  assert.equal(st.current, 3);
  assert.equal(st.cur.battingTeam, 0);
  assert.equal(st.target, 7);
  m = play(m, [4, 1, 2]);
  st = getState(m);
  assert.equal(st.result.winner, 0);
  assert.equal(st.result.superOver, true);
  assert.equal(st.result.text, 'Fire Hawks won the Super Over');
  assert.equal(st.mainResult.text, 'Match tied');
});

test('tied super over allows another one; batting order flips', () => {
  let m = startSuperOver(tied());
  m = play(m, [...dots(5), 1]);
  m = play(m, [...dots(5), 1]);
  let st = getState(m);
  assert.equal(st.result.text, 'Super Over tied');
  assert.equal(st.canSuperOver, true);
  m = startSuperOver(m);
  st = getState(m);
  assert.equal(st.current, 4);
  assert.equal(st.cur.battingTeam, 0, 'side that batted second in super over 1 bats first');
});

test('undo cancels an unplayed super over, then undoes balls', () => {
  const t = tied();
  let m = startSuperOver(t);
  assert.equal(canUndo(m), true);
  m = undo(m);
  assert.equal(m.innings.length, 2);
  assert.equal(getState(m).result.by, 'tie');
  // undo back into the main match from a played super over
  m = undo(undo(play(startSuperOver(t), [1])));
  assert.equal(m.innings.length, 2, 'empty super over pair is dropped');
  assert.equal(getState(m).result, null);
});

test('rev counts changes; old string teams are upgraded', () => {
  const m = play(mk(), [1, 2]);
  assert.equal(m.rev, 3);
  assert.equal(undo(m).rev, 4);
  const old = { ...m, teams: ['A', 'B'] };
  delete old.rev;
  const up = upgradeMatch(old);
  assert.equal(up.teams[0].name, 'A');
  assert.equal(up.rev, 0);
  assert.equal(upgradeMatch({ v: 2 }), null);
});

test('overthrow: ran 3 + overthrow 4 = 7 to the striker; strike moves on the 3 run', () => {
  let m = play(mk(), [{ runs: 3, ot: 4 }]);
  let s = cur(m);
  assert.equal(s.runs, 7);
  assert.equal(s.batters[0].runs, 7);
  assert.equal(s.batters[0].balls, 1);
  assert.equal(s.batters[0].fours, 0, 'an overthrow boundary is not a four');
  assert.equal(s.striker, 1, 'ran 3, so the batters swapped');
  assert.equal(s.balls, 1);
  assert.equal(s.bowlers[0].runs, 7);
  assert.deepEqual(s.thisOver.at(-1), { label: '7', kind: 'run' });
  // ran 2 + overthrow 1: overthrow runs are not run, so no swap
  s = cur(play(mk(), [{ runs: 2, ot: 1 }]));
  assert.equal(s.runs, 3);
  assert.equal(s.striker, 0);
});

test('overthrow on extras goes to that extra, never the batter', () => {
  const R = { wideRun: true, noBallRun: true };
  let s = cur(play(mk({ rules: R }), [{ extra: 'wd', runs: 1, ot: 4 }]));
  assert.equal(s.extras.wd, 6);
  assert.equal(s.runs, 6);
  assert.equal(s.balls, 0);
  assert.equal(s.striker, 1, 'ran 1 on the wide');
  assert.equal(s.thisOver.at(-1).label, '6wd');

  s = cur(play(mk({ rules: R }), [{ extra: 'nb', runs: 2, ot: 4 }]));
  assert.equal(s.batters[0].runs, 2, 'batter keeps only the runs off the bat');
  assert.equal(s.extras.nb, 5);
  assert.equal(s.runs, 7);
  assert.equal(s.bowlers[0].runs, 7);
  assert.equal(s.thisOver.at(-1).label, 'nb+6');

  s = cur(play(mk(), [{ extra: 'b', runs: 1, ot: 4 }, { extra: 'lb', runs: 0, ot: 4 }]));
  assert.equal(s.extras.b, 5);
  assert.equal(s.extras.lb, 4);
  assert.equal(s.runs, 9);
  assert.equal(s.bowlers[0].runs, 0, 'byes are not charged to the bowler');
  assert.equal(s.batters[0].runs + s.batters[1].runs, 0);
  assert.equal(s.balls, 2);
});

test('custom runs: total to the striker, strike follows the runs actually ran', () => {
  let s = cur(play(mk(), [{ runs: 7, ran: 3 }]));
  assert.equal(s.runs, 7);
  assert.equal(s.batters[0].runs, 7);
  assert.equal(s.striker, 1);
  assert.equal(s.thisOver.at(-1).label, '7');
  s = cur(play(mk(), [{ runs: 5, ran: 4 }]));
  assert.equal(s.striker, 0, 'ran 4 of 5: no swap');
  s = cur(play(mk(), [{ runs: 5 }]));
  assert.equal(s.striker, 1, 'ran all 5 by default');
  assert.equal(s.batters[0].fours + s.batters[0].sixes, 0);
  assert.throws(() => play(mk(), [{ runs: 3, ran: 4 }]), /custom/);
  assert.throws(() => play(mk(), [{ runs: 41 }]), /0 to 40/);
  assert.throws(() => play(mk(), [{ runs: 1, ot: 21 }]), /0 to 20/);
});

test('overthrows can be switched off per match', () => {
  const m = play(mk({ rules: { overthrows: false } }), [{ runs: 7, ran: 3 }]);
  assert.equal(cur(m).runs, 7, 'custom runs still work');
  assert.throws(() => addBall(m, { runs: 1, ot: 4 }), /Overthrows are off/);
  assert.equal(mk().rules.overthrows, true);
  const old = { ...mk(), rules: { byes: false } };
  assert.equal(upgradeMatch(old).rules.overthrows, true, 'older matches get the default');
});

test('undo fully reverses an overthrow ball, including strike', () => {
  const before = play(mk(), [1, 2]);
  const after = play(before, [{ runs: 3, ot: 4 }]);
  const s0 = cur(before);
  const s1 = cur(undo(after));
  assert.equal(s1.runs, s0.runs);
  assert.equal(s1.striker, s0.striker);
  assert.equal(s1.balls, s0.balls);
  assert.deepEqual(s1.batters, s0.batters);
  assert.deepEqual(s1.bowlers, s0.bowlers);
});

test('end of over swaps strike again after an overthrow single', () => {
  const s = cur(play(mk(), [...dots(5), { runs: 1, ot: 4 }]));
  assert.equal(s.balls, 6);
  assert.equal(s.striker, 0, 'swapped for the run, then again for the over');
});
