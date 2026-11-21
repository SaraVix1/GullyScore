import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from './sync.js';

// Two phones joined by a fake channel that can be cut and restored.
function pair({ modeA = 'ask', modeB = 'ask', storeA = null, storeB = null } = {}) {
  const link = { up: false, queue: [] };
  const mk = (id, mode, other, store) =>
    createSync({
      deviceId: id,
      mode: () => mode,
      send: (m) => link.up && link.queue.push([other, structuredClone(m)]),
      store,
    });
  const phones = {};
  phones.A = mk('aaa', modeA, 'B', storeA);
  phones.B = mk('bbb', modeB, 'A', storeB);
  const flush = () => {
    for (let n = 0; link.queue.length && n < 100; n++) {
      const [to, m] = link.queue.shift();
      if (link.up) phones[to].receive(m);
    }
  };
  const connect = () => {
    link.up = true;
    phones.A.connected(true);
    phones.B.connected(true);
    flush();
  };
  const cut = () => {
    link.up = false;
    link.queue = [];
    phones.A.connected(false);
    phones.B.connected(false);
  };
  const step = () => {
    const [to, msg] = link.queue.shift();
    phones[to].receive(msg);
  };
  return { ...phones, connect, cut, flush, step, link };
}

const m = (rev) => ({ id: 'm1', rev });

test('host scores, joiner watches and receives every change', () => {
  const p = pair();
  p.A.host(m(1));
  p.connect();
  assert.equal(p.A.role, 'scorer');
  assert.equal(p.B.role, 'viewer');
  assert.deepEqual(p.B.state.match, m(1));
  p.A.setMatch(m(2));
  p.flush();
  assert.deepEqual(p.B.state.match, m(2));
  assert.throws(() => p.B.setMatch(m(9)), /Only the scorer/);
});

test('ask mode: control moves only after the scorer accepts', () => {
  const p = pair();
  p.A.host(m(1));
  p.connect();
  p.B.requestTakeover();
  p.flush();
  assert.equal(p.B.state.pending, true);
  assert.equal(p.A.state.request, true);
  assert.equal(p.A.role, 'scorer', 'still scorer until accepted');
  p.A.respond(true);
  p.flush();
  assert.equal(p.A.role, 'viewer');
  assert.equal(p.B.role, 'scorer');
  assert.equal(p.B.state.pending, false);
  assert.equal(p.A.state.term, 2);
  assert.equal(p.B.state.term, 2);
  p.B.setMatch(m(3));
  p.flush();
  assert.deepEqual(p.A.state.match, m(3));
});

test('ask mode: decline keeps the scorer', () => {
  const p = pair();
  p.A.host(m(1));
  p.connect();
  p.B.requestTakeover();
  p.flush();
  p.A.respond(false);
  p.flush();
  assert.equal(p.A.role, 'scorer');
  assert.equal(p.B.role, 'viewer');
  assert.equal(p.B.state.pending, false);
  assert.match(p.B.state.note, /said no/);
});

test('instant mode: scorer hands over straight away', () => {
  const p = pair({ modeA: 'instant' });
  p.A.host(m(1));
  p.connect();
  p.B.requestTakeover();
  p.flush();
  assert.equal(p.A.role, 'viewer');
  assert.equal(p.B.role, 'scorer');
  assert.deepEqual(p.B.state.match, m(1), 'new scorer starts from the latest match');
});

test('never two scorers: the old scorer steps down before the new one takes over', () => {
  const p = pair({ modeA: 'instant' });
  p.A.host(m(1));
  p.connect();
  p.B.requestTakeover();
  p.step(); // A receives the request and grants: its grant is now in flight
  assert.equal(p.A.role, 'viewer');
  assert.equal(p.B.role, 'viewer');
  p.flush();
  assert.deepEqual([p.A.role, p.B.role], ['viewer', 'scorer']);
});

test('grant lost in a disconnect: nobody scores until reconnect, then the new scorer takes over', () => {
  const p = pair({ modeA: 'instant' });
  p.A.host(m(1));
  p.connect();
  p.B.requestTakeover();
  p.step(); // A grants
  p.cut(); // grant never arrives
  assert.deepEqual([p.A.role, p.B.role], ['viewer', 'viewer']);
  p.connect();
  assert.deepEqual([p.A.role, p.B.role], ['viewer', 'scorer']);
});

test('request cannot be sent offline; a pending request is dropped on disconnect', () => {
  const p = pair();
  p.A.host(m(1));
  p.connect();
  p.cut();
  assert.throws(() => p.B.requestTakeover(), /Not connected/);
  p.connect();
  p.B.requestTakeover();
  p.cut();
  assert.equal(p.B.state.pending, false);
  assert.equal(p.A.state.request, false);
});

test('changes made while disconnected reach the viewer on reconnect', () => {
  const p = pair();
  p.A.host(m(1));
  p.connect();
  p.cut();
  p.A.setMatch(m(5));
  assert.deepEqual(p.B.state.match, m(1));
  p.connect();
  assert.deepEqual(p.B.state.match, m(5));
  assert.equal(p.B.role, 'viewer');
});

test('forced takeover when the scorer is gone; old scorer becomes viewer on return', () => {
  const p = pair();
  p.A.host(m(1));
  p.connect();
  p.cut();
  assert.throws(() => (p.connect(), p.B.forceTakeover()), /Ask the scorer/);
  p.cut();
  p.B.forceTakeover();
  assert.equal(p.B.role, 'scorer');
  p.B.setMatch(m(7));
  p.connect();
  assert.equal(p.A.role, 'viewer');
  assert.deepEqual(p.A.state.match, m(7));
});

test('older scorer with lower term yields to a forced takeover', () => {
  const p = pair();
  p.A.host(m(1));
  p.connect();
  p.B.requestTakeover();
  p.flush();
  p.A.respond(true);
  p.flush(); // B scorer at term 2
  p.cut();
  p.A.forceTakeover(); // A thinks B is gone: term 3
  p.B.setMatch(m(8)); // B kept scoring at term 2
  p.connect();
  assert.deepEqual([p.A.role, p.B.role], ['scorer', 'viewer']);
  assert.equal(p.A.state.term, p.B.state.term);
});

test('same term, different scorers: lowest device id wins on both phones', () => {
  const p = pair();
  p.A.host(m(1));
  p.B.receive({ t: 'state', from: 'zzz', term: 1, scorer: 'zzz', match: m(4) });
  assert.equal(p.B.state.scorer, 'zzz');
  p.B.receive({ t: 'state', from: 'aaa', term: 1, scorer: 'aaa', match: m(1) });
  assert.equal(p.B.state.scorer, 'aaa');
  p.A.receive({ t: 'state', from: 'zzz', term: 1, scorer: 'zzz', match: m(4) });
  assert.equal(p.A.role, 'scorer');
});

test('joining phone with no match adopts the host match and role', () => {
  const p = pair();
  p.B.host(m(1)); // B started sharing this time
  p.connect();
  assert.equal(p.A.role, 'viewer');
  assert.deepEqual(p.A.state.match, m(1));
});

// ---------- series sync ----------

// A phone's history: finished matches by id, with the add() calls it received.
const memStore = (held = []) => {
  const matches = new Map(held.map((x) => [x.id, x]));
  const added = [];
  return {
    added,
    ids: () => [...matches.keys()],
    list: async (series) => [...matches.values()].filter((x) => x.series === series),
    add: (x) => (matches.set(x.id, x), added.push(x.id)),
  };
};
const done = (id, series = 'S1') => ({ id, series, rev: 9 });
const live = (id, series = 'S1') => ({ id, series, rev: 1 });
const settle = async (p) => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setImmediate(r));
    p.flush();
  }
};

test('series: a joining phone receives every finished match of the current series', async () => {
  const storeA = memStore([done('m1'), done('m2'), done('old', 'S0')]);
  const storeB = memStore();
  const p = pair({ storeA, storeB });
  p.A.host(live('m3'));
  p.connect();
  await settle(p);
  assert.deepEqual(storeB.ids().sort(), ['m1', 'm2'], 'older series S0 is not sent');
  assert.deepEqual(p.B.state.match, live('m3'));
});

test('series: only what is missing is sent', async () => {
  const storeA = memStore([done('m1'), done('m2')]);
  const storeB = memStore([done('m1')]);
  const p = pair({ storeA, storeB });
  p.A.host(live('m3'));
  p.connect();
  await settle(p);
  assert.deepEqual(storeB.added, ['m2']);
  assert.deepEqual(storeA.added, []);
});

test('series: the watching phone sends back matches the scorer lacks', async () => {
  const storeA = memStore([done('m1')]);
  const storeB = memStore([done('m1'), done('m2')]);
  const p = pair({ storeA, storeB });
  p.A.host(live('m3'));
  p.connect();
  await settle(p);
  assert.deepEqual(storeA.added, ['m2']);
});

test('series: a new series starts fresh and old matches are not pushed', async () => {
  const storeA = memStore([done('m1'), done('n1', 'S2')]);
  const storeB = memStore([done('m1')]);
  const p = pair({ storeA, storeB });
  p.A.host(live('m3'));
  p.connect();
  await settle(p);
  p.A.setMatch(live('n2', 'S2'));
  await settle(p);
  assert.equal(p.B.state.series, 'S2');
  assert.deepEqual(storeB.added, ['n1']);
});

test('series: ignores matches from a different series', async () => {
  const storeB = memStore();
  const p = pair({ storeA: memStore(), storeB });
  p.A.host(live('m3'));
  p.connect();
  await settle(p);
  p.B.receive({ t: 'match', from: 'aaa', series: 'S9', match: done('x', 'S9') });
  assert.deepEqual(storeB.added, []);
});
