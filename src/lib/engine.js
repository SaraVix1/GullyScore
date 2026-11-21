// Gully Score scoring engine. No DOM, no storage: pure functions over JSON.
//
// A match is config + player names + an append-only event log per innings.
// Every score, strike position, over count and result is derived by replaying
// the log, so:
//   - undo is "drop events back to (and including) the last scoring action"
//   - saving is "write the match object"
//   - syncing two devices later only needs the event lists (and `rev`)
//
// Innings layout: m.innings[0], m.innings[1] are the main match. Each Super
// Over adds a pair: [2, 3], [4, 5], ...
//
// Events:
//   { t: 'ball', runs, extra: null|'wd'|'nb'|'b'|'lb', wicket: null|{ how, batter: 'striker'|'nonStriker' },
//     ot?, ran? }
//       runs  runs scored the normal way (run, or a 4/6 off the bat)
//       ot    overthrow runs on top of `runs` (not run, so they never move strike)
//       ran   custom-runs ball: how many of `runs` the batters actually ran
//     The ball is worth runs + ot; strike changes on an odd `ran ?? runs`.
//   { t: 'penalty', team, runs }        penalty runs awarded to a team (no ball counted)
//   { t: 'retire', batter, kind }       kind 'hurt' (may return) or 'out' (counts as a wicket)
//   { t: 'bowler', p }                  bowler for the over, or a mid-over change
//   { t: 'bat', from, to }              send in a different batter (before they face)
//   { t: 'swap' }                       manually swap strike

export const RULE_DEFAULTS = {
  wideRun: true,
  noBallRun: true,
  freeHit: true,
  byes: true,
  legByes: true,
  lastManStands: false,
  overthrows: true,
};

export const DISMISSALS = [
  { id: 'bowled', label: 'Bowled' },
  { id: 'caught', label: 'Caught' },
  { id: 'runout', label: 'Run Out' },
  { id: 'lbw', label: 'LBW' },
  { id: 'stumped', label: 'Stumped' },
  { id: 'hitwicket', label: 'Hit Wicket' },
];

const BALLS_PER_OVER = 6;
const SUPER_OVER_WICKETS = 2;
// Events that Undo removes one at a time. Others (bowler picks, batter swaps)
// are removed together with the action before them.
const ACTIONS = new Set(['ball', 'penalty', 'retire']);

export function defaultName(i) {
  return `Player ${i + 1}`;
}

export function normTeam(t, i = 0) {
  const name = typeof t === 'object' && t ? t.name : t;
  return {
    name: String(name || `Team ${i + 1}`),
    icon: (t && t.icon) || '🏏',
    color: (t && t.color) || '#d4ff2a',
  };
}

function makeNames(n, existing = []) {
  return Array.from({ length: n }, (_, i) => existing[i] || defaultName(i));
}

export function createMatch({
  teams,
  players = 6,
  overs = 5,
  toss = { winner: 0, choice: 'bat' },
  rules = {},
  names = [],
  series = null,
}) {
  const n = Math.max(2, Math.min(11, Math.floor(players)));
  const battingFirst = toss.choice === 'bat' ? toss.winner : 1 - toss.winner;
  return {
    v: 1,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    series: series || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    created: Date.now(),
    rev: 0,
    teams: [normTeam(teams[0], 0), normTeam(teams[1], 1)],
    players: n,
    overs: Math.max(1, Math.floor(overs)),
    rules: { ...RULE_DEFAULTS, ...rules },
    toss: { winner: toss.winner, choice: toss.choice },
    battingFirst,
    names: [makeNames(n, names[0]), makeNames(n, names[1])],
    innings: [[], []],
    log: [], // append-only edit log, see editlog.js
  };
}

// Older saved matches stored team names as plain strings.
export function upgradeMatch(m) {
  if (!m || m.v !== 1 || !Array.isArray(m.innings)) return null;
  return { rev: 0, log: [], series: m.id, ...m, rules: { ...RULE_DEFAULTS, ...m.rules }, teams: m.teams.map(normTeam) };
}

// ---------- innings layout ----------

export function battingTeamOf(m, i) {
  const pair = Math.floor(i / 2);
  // In each Super Over the side that batted second in the previous pair bats first.
  const first = pair % 2 ? 1 - m.battingFirst : m.battingFirst;
  return i % 2 ? 1 - first : first;
}

function newInnings(m, index, target, startRuns) {
  const bat = battingTeamOf(m, index);
  const n = m.players;
  const superOver = index >= 2;
  const baseWickets = m.rules.lastManStands ? n : n - 1;
  return {
    index,
    superOver,
    superOverNo: Math.floor(index / 2),
    battingTeam: bat,
    bowlingTeam: 1 - bat,
    target,
    maxWickets: superOver ? Math.min(SUPER_OVER_WICKETS, baseWickets) : baseWickets,
    maxBalls: (superOver ? 1 : m.overs) * BALLS_PER_OVER,
    overs: superOver ? 1 : m.overs,
    runs: startRuns,
    wickets: 0,
    balls: 0,
    extras: { wd: 0, nb: 0, b: 0, lb: 0, p: startRuns },
    penaltyToFielding: 0,
    batters: Array.from({ length: n }, () => ({
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      out: null,
      fresh: true,
      returned: false,
    })),
    order: [0, 1],
    striker: 0,
    nonStriker: 1,
    bowlers: Array.from({ length: n }, () => ({ balls: 0, runs: 0, wickets: 0, maidens: 0, wd: 0, nb: 0 })),
    bowlerOrder: [],
    bowler: null,
    prevBowler: null,
    overRuns: 0,
    overBowlers: new Set(),
    thisOver: [],
    overDone: false,
    fow: [],
    freeHit: false,
    done: false,
    endReason: null,
  };
}

// ---------- replay ----------

function chipFor(ev, rules) {
  const r = (ev.runs || 0) + (ev.ot || 0);
  if (ev.wicket) {
    const pre = ev.extra === 'wd' ? 'wd ' : ev.extra === 'nb' ? 'nb ' : '';
    return { label: `${pre}${r ? r + ' ' : ''}W`, kind: 'w' };
  }
  switch (ev.extra) {
    case 'wd': {
      const total = (rules.wideRun ? 1 : 0) + r;
      return { label: total > 1 ? `${total}wd` : 'wd', kind: 'x' };
    }
    case 'nb':
      return { label: r ? `nb+${r}` : 'nb', kind: 'x' };
    case 'b':
      return { label: `${r}b`, kind: 'x' };
    case 'lb':
      return { label: `${r}lb`, kind: 'x' };
    default:
      return { label: String(r), kind: r === 0 ? 'dot' : isBoundary(ev) ? (r === 4 ? 'four' : 'six') : 'run' };
  }
}

// A plain 4 or 6 off the bat (not run, no overthrow).
const isBoundary = (ev) => !ev.extra && !ev.ot && ev.ran == null && (ev.runs === 4 || ev.runs === 6);

function swapEnds(s) {
  if (s.nonStriker == null) return;
  [s.striker, s.nonStriker] = [s.nonStriker, s.striker];
}

const atCrease = (s, p) => s.striker === p || s.nonStriker === p;
const isRetiredHurt = (b) => b.out && b.out.how === 'retiredhurt';

// Players who could walk in now: never batted, or retired hurt and off the field.
export function availableBatters(s, exclude = null) {
  const fresh = [];
  const back = [];
  s.batters.forEach((b, i) => {
    if (i === exclude || atCrease(s, i)) return;
    if (!s.order.includes(i)) fresh.push(i);
    else if (isRetiredHurt(b)) back.push(i);
  });
  return [...fresh, ...back];
}

function bringIn(s, p, at = s.order.length) {
  const b = s.batters[p];
  if (!s.order.includes(p)) s.order.splice(at, 0, p);
  if (isRetiredHurt(b)) {
    b.out = null;
    b.returned = true;
  }
  b.fresh = true;
}

// `outP` has left the crease (wicket or retirement): fill the gap.
function fillVacancy(s, outP, rules) {
  const slot = s.striker === outP ? 'striker' : 'nonStriker';
  const next = s.wickets < s.maxWickets ? availableBatters(s, outP)[0] : undefined;
  if (next !== undefined) {
    bringIn(s, next);
    s[slot] = next;
    return;
  }
  const survivor = slot === 'striker' ? s.nonStriker : s.striker;
  if (s.wickets < s.maxWickets && survivor != null && rules.lastManStands) {
    // Last batter bats alone and takes strike every ball.
    s.striker = survivor;
    s.nonStriker = null;
  } else {
    s.striker = null;
    s.nonStriker = null;
  }
}

function checkEnd(s) {
  if (s.done) return;
  let reason = null;
  if (s.target != null && s.runs >= s.target) reason = 'target';
  else if (s.wickets >= s.maxWickets || s.striker == null) reason = 'allout';
  else if (s.balls >= s.maxBalls) reason = 'overs';
  if (reason) {
    s.done = true;
    s.endReason = reason;
    s.freeHit = false;
  }
}

function applyBall(s, ev, rules) {
  const r = ev.runs || 0;
  const ot = ev.ot || 0;
  const extra = ev.extra || null;
  const legal = extra !== 'wd' && extra !== 'nb';
  const bat = s.batters[s.striker];
  const bowl = s.bowlers[s.bowler];

  if (s.overDone) {
    s.thisOver = [];
    s.overDone = false;
  }
  if (!s.bowlerOrder.includes(s.bowler)) s.bowlerOrder.push(s.bowler);
  s.overBowlers.add(s.bowler);

  const outPlayer = ev.wicket ? (ev.wicket.batter === 'nonStriker' ? s.nonStriker : s.striker) : null;

  let team = 0;
  let charged = 0;
  // Overthrows on an extra go to that extra, never to the batter.
  if (extra === 'wd') {
    team = (rules.wideRun ? 1 : 0) + r + ot;
    s.extras.wd += team;
    charged = team;
    bowl.wd++;
  } else if (extra === 'nb') {
    const pen = rules.noBallRun ? 1 : 0;
    s.extras.nb += pen + ot;
    bat.runs += r;
    if (r === 4) bat.fours++;
    if (r === 6) bat.sixes++;
    team = pen + r + ot;
    charged = team;
    bowl.nb++;
  } else if (extra === 'b' || extra === 'lb') {
    s.extras[extra] += r + ot;
    team = r + ot;
  } else {
    team = r + ot;
    bat.runs += team;
    if (isBoundary(ev)) bat[r === 4 ? 'fours' : 'sixes']++;
    charged = team;
  }
  if (extra !== 'wd') {
    bat.balls++;
    bat.fresh = false;
  }
  s.runs += team;
  bowl.runs += charged;
  s.overRuns += charged;
  if (legal) {
    s.balls++;
    bowl.balls++;
  }

  // Batters crossed for an odd number of runs (overthrow and boundary runs aren't run).
  if ((ev.ran ?? r) % 2 === 1) swapEnds(s);

  s.freeHit = rules.freeHit && (extra === 'nb' || (s.freeHit && extra === 'wd'));

  if (ev.wicket) {
    const how = ev.wicket.how;
    s.wickets++;
    s.batters[outPlayer].out = { how, bowler: how === 'runout' ? null : s.bowler };
    if (how !== 'runout') bowl.wickets++;
    s.fow.push({ wicket: s.wickets, runs: s.runs, balls: s.balls, player: outPlayer });
    fillVacancy(s, outPlayer, rules);
  }

  s.thisOver.push(chipFor(ev, rules));

  if (legal && s.balls % BALLS_PER_OVER === 0) {
    if (s.overRuns === 0 && s.overBowlers.size === 1) bowl.maidens++;
    s.overRuns = 0;
    s.overBowlers = new Set();
    s.prevBowler = s.bowler;
    s.bowler = null;
    s.overDone = true;
    swapEnds(s);
  }
  checkEnd(s);
}

function applyEvent(s, ev, rules) {
  switch (ev.t) {
    case 'ball':
      return applyBall(s, ev, rules);
    case 'bowler':
      s.bowler = ev.p;
      return;
    case 'bat': {
      const slot = s.striker === ev.from ? 'striker' : 'nonStriker';
      const from = s.batters[ev.from];
      let at = s.order.length;
      if (from.returned) {
        // Send the returning retired-hurt batter back off again.
        from.out = { how: 'retiredhurt' };
        from.returned = false;
      } else {
        at = s.order.indexOf(ev.from);
        s.order.splice(at, 1);
      }
      bringIn(s, ev.to, at);
      s[slot] = ev.to;
      return;
    }
    case 'swap':
      return swapEnds(s);
    case 'penalty':
      // Penalties to the fielding side are added to their own innings (see getState).
      if (ev.team === s.battingTeam) {
        s.runs += ev.runs;
        s.extras.p += ev.runs;
        checkEnd(s);
      } else {
        s.penaltyToFielding += ev.runs;
      }
      return;
    case 'retire': {
      const p = ev.batter === 'nonStriker' ? s.nonStriker : s.striker;
      if (ev.kind === 'out') {
        s.wickets++;
        s.batters[p].out = { how: 'retiredout', bowler: null };
        s.fow.push({ wicket: s.wickets, runs: s.runs, balls: s.balls, player: p });
      } else {
        s.batters[p].out = { how: 'retiredhurt', bowler: null };
      }
      s.batters[p].returned = false;
      fillVacancy(s, p, rules);
      checkEnd(s);
      return;
    }
  }
}

function replay(m, index, target, startRuns) {
  const s = newInnings(m, index, target, startRuns);
  checkEnd(s); // carried-in penalty runs can already reach the target
  for (const ev of m.innings[index] || []) applyEvent(s, ev, m.rules);
  s.needBowler = !s.done && s.bowler == null;
  s.ballsLeft = s.maxBalls - s.balls;
  s.need = target != null ? Math.max(0, target - s.runs) : null;
  s.extrasTotal = s.extras.wd + s.extras.nb + s.extras.b + s.extras.lb + s.extras.p;
  s.started = (m.innings[index] || []).some((e) => ACTIONS.has(e.t));
  return s;
}

// Penalty runs given in innings `i` to the side that is fielding there.
function penaltiesToFielding(m, i) {
  const fielding = 1 - battingTeamOf(m, i);
  return (m.innings[i] || []).reduce((sum, e) => (e.t === 'penalty' && e.team === fielding ? sum + e.runs : sum), 0);
}

export function getState(m) {
  const innings = [];
  let current = null;
  let result = null;
  let mainResult = null;
  for (let a = 0; a < m.innings.length; a += 2) {
    const b = a + 1;
    // Fielding-side penalties go to that side's innings: the second innings
    // starts with any awarded during the first, and the first innings gets any
    // awarded during the second.
    const A = replay(m, a, null, penaltiesToFielding(m, b));
    innings.push(A);
    if (!A.done) {
      current = a;
      break;
    }
    const B = replay(m, b, A.runs + 1, penaltiesToFielding(m, a));
    innings.push(B);
    if (!B.done) {
      current = b;
      break;
    }
    result = pairResult(m, A, B);
    if (a === 0) mainResult = result;
    if (result.by !== 'tie') break;
  }
  if (current != null) result = null;
  const cur = current != null ? innings[current] : innings[innings.length - 1];
  return {
    innings,
    current,
    cur,
    target: cur.target,
    result,
    mainResult,
    canSuperOver: !!result && result.by === 'tie',
  };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function pairResult(m, A, B) {
  const so = A.superOver;
  const name = (t) => m.teams[t].name;
  if (B.runs >= B.target) {
    const margin = B.maxWickets - B.wickets;
    return {
      winner: B.battingTeam,
      by: 'wickets',
      margin,
      superOver: so,
      text: so ? `${name(B.battingTeam)} won the Super Over` : `${name(B.battingTeam)} won by ${plural(margin, 'wicket')}`,
      detail: so ? '' : B.ballsLeft > 0 ? `with ${plural(B.ballsLeft, 'ball')} to spare` : 'off the last ball',
    };
  }
  if (B.runs === A.runs) {
    return {
      winner: null,
      by: 'tie',
      margin: 0,
      superOver: so,
      text: so ? 'Super Over tied' : 'Match tied',
      detail: `Both teams scored ${A.runs}`,
    };
  }
  const margin = A.runs - B.runs;
  return {
    winner: A.battingTeam,
    by: 'runs',
    margin,
    superOver: so,
    text: so ? `${name(A.battingTeam)} won the Super Over` : `${name(A.battingTeam)} won by ${plural(margin, 'run')}`,
    detail: '',
  };
}

// ---------- actions (return a new match; throw on illegal input) ----------

function live(m) {
  const st = getState(m);
  if (st.current == null) throw new Error('Match is over');
  return st;
}

function withEvent(m, ev) {
  const innings = m.innings.map((e) => e.slice());
  innings[live(m).current].push(ev);
  return { ...m, innings, rev: (m.rev || 0) + 1 };
}

const MAX_RUNS = 40;
const MAX_OVERTHROW = 20;
const isCount = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;

// `ot`: overthrow runs on top of `runs`. `ran`: for a custom-runs ball, how many
// of `runs` were actually run (decides strike); defaults to all of them.
export function addBall(m, { runs = 0, extra = null, wicket = null, ot = 0, ran = null } = {}) {
  const { cur: s } = live(m);
  const R = m.rules;
  if (s.needBowler) throw new Error('Pick a bowler first');
  if (!isCount(runs, MAX_RUNS)) throw new Error(`Runs must be 0 to ${MAX_RUNS}`);
  if (!isCount(ot, MAX_OVERTHROW)) throw new Error(`Overthrows must be 0 to ${MAX_OVERTHROW}`);
  if (ot && R.overthrows === false) throw new Error('Overthrows are off in this match');
  if (ran != null && (extra || ot || !isCount(ran, runs))) throw new Error('Bad custom runs');
  if (extra && !['wd', 'nb', 'b', 'lb'].includes(extra)) throw new Error('Bad extra');
  if (extra === 'b' && !R.byes) throw new Error('Byes are off');
  if (extra === 'lb' && !R.legByes) throw new Error('Leg byes are off');
  if ((extra === 'b' || extra === 'lb') && runs + ot < 1) throw new Error('Byes need at least 1 run');
  if (wicket) {
    if (!DISMISSALS.some((d) => d.id === wicket.how)) throw new Error('Bad dismissal');
    const batter = wicket.batter === 'nonStriker' ? 'nonStriker' : 'striker';
    if (wicket.how !== 'runout') {
      if (batter !== 'striker') throw new Error('Only a run out can dismiss the non-striker');
      if (s.freeHit) throw new Error('Free hit: only a run out');
      if (extra === 'nb' || extra === 'b' || extra === 'lb') throw new Error('Not out off that delivery');
      if (extra === 'wd' && wicket.how !== 'stumped' && wicket.how !== 'hitwicket') throw new Error('Not out off a wide');
      runs = 0;
      ot = 0;
      ran = null;
    }
    if (batter === 'nonStriker' && s.nonStriker == null) throw new Error('No non-striker');
    wicket = { how: wicket.how, batter };
  }
  const ev = { t: 'ball', runs, extra, wicket };
  if (ot) ev.ot = ot;
  if (ran != null) ev.ran = ran;
  return withEvent(m, ev);
}

// Pick the bowler for a new over, or replace the bowler mid-over.
export function setBowler(m, p) {
  const { cur: s } = live(m);
  if (!Number.isInteger(p) || p < 0 || p >= m.players) throw new Error('Bad bowler');
  if (p === s.bowler) throw new Error('Already bowling');
  if (p === s.prevBowler) throw new Error('Same bowler cannot bowl two overs in a row');
  return withEvent(m, { t: 'bowler', p });
}

export function canChangeBatter(s, p) {
  return atCrease(s, p) && s.batters[p].fresh;
}

export function replaceBatter(m, from, to) {
  const { cur: s } = live(m);
  if (!canChangeBatter(s, from)) throw new Error('That batter has already faced a ball');
  if (!availableBatters(s).includes(to)) throw new Error('Player already batted');
  return withEvent(m, { t: 'bat', from, to });
}

export function swapStrike(m) {
  const { cur: s } = live(m);
  if (s.nonStriker == null) throw new Error('Cannot swap strike');
  return withEvent(m, { t: 'swap' });
}

export function addPenalty(m, team, runs) {
  live(m);
  if (team !== 0 && team !== 1) throw new Error('Bad team');
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('Penalty must be 1 to 10 runs');
  return withEvent(m, { t: 'penalty', team, runs });
}

export function retireBatter(m, batter, kind) {
  const { cur: s } = live(m);
  const p = batter === 'nonStriker' ? s.nonStriker : s.striker;
  if (p == null) throw new Error('No batter there');
  if (kind !== 'hurt' && kind !== 'out') throw new Error('Bad retirement');
  return withEvent(m, { t: 'retire', batter: batter === 'nonStriker' ? 'nonStriker' : 'striker', kind });
}

export function startSuperOver(m) {
  if (!getState(m).canSuperOver) throw new Error('Super Over is only for a tie');
  return { ...m, innings: [...m.innings, [], []], rev: (m.rev || 0) + 1 };
}

const emptyPair = (inn) => inn.length > 2 && !inn[inn.length - 1].length && !inn[inn.length - 2].length;

export function canUndo(m) {
  return m.innings.length > 2 || m.innings.some((evs) => evs.some((e) => ACTIONS.has(e.t)));
}

// Undo the most recent scoring action (ball, penalty or retirement), along with
// any bowler picks or batter changes made after it. An unplayed Super Over is
// cancelled first.
export function undo(m) {
  if (!canUndo(m)) return m;
  let innings = m.innings.map((e) => e.slice());
  const done = () => {
    while (emptyPair(innings)) innings = innings.slice(0, -2);
    return { ...m, innings, rev: (m.rev || 0) + 1 };
  };
  if (emptyPair(innings)) return done();
  for (let i = innings.length - 1; i >= 0; i--) {
    while (innings[i].length) {
      if (ACTIONS.has(innings[i].pop().t)) return done();
    }
  }
  return done();
}

// What Undo would remove right now: { ev } for a scoring action, { superOver: true }
// for an unplayed Super Over, or null.
export function peekUndo(m) {
  if (!canUndo(m)) return null;
  if (emptyPair(m.innings)) return { superOver: true };
  for (let i = m.innings.length - 1; i >= 0; i--) {
    for (let j = m.innings[i].length - 1; j >= 0; j--) if (ACTIONS.has(m.innings[i][j].t)) return { ev: m.innings[i][j] };
  }
  return null;
}

export function renamePlayer(m, team, p, name) {
  const clean = String(name || '').trim().slice(0, 24) || defaultName(p);
  const names = m.names.map((t) => t.slice());
  names[team][p] = clean;
  return { ...m, names, rev: (m.rev || 0) + 1 };
}

// ---------- formatting helpers ----------

export function oversText(balls) {
  return `${Math.floor(balls / BALLS_PER_OVER)}.${balls % BALLS_PER_OVER}`;
}

export function rate(runs, balls) {
  return balls ? ((runs * BALLS_PER_OVER) / balls).toFixed(2) : '0.00';
}

export function howOut(out, bowlerName) {
  if (!out) return 'not out';
  switch (out.how) {
    case 'bowled':
      return `b ${bowlerName}`;
    case 'caught':
      return `ct b ${bowlerName}`;
    case 'lbw':
      return `lbw b ${bowlerName}`;
    case 'stumped':
      return `st b ${bowlerName}`;
    case 'hitwicket':
      return `hit wkt b ${bowlerName}`;
    case 'runout':
      return 'run out';
    case 'retiredhurt':
      return 'retired hurt';
    case 'retiredout':
      return 'retired out';
  }
  return out.how;
}

export function inningsTitle(m, inn) {
  if (!inn.superOver) return `${inn.index === 0 ? '1st' : '2nd'} innings`;
  return `Super Over${inn.superOverNo > 1 ? ' ' + inn.superOverNo : ''}`;
}
