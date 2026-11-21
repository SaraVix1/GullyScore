// Live sync between two phones: who may score, and keeping the match in step.
// Transport-agnostic (WebRTC lives in peer.js) so the rules are unit-tested.
//
// Exactly one phone is the scorer. Authority is a (term, scorer) pair: every
// handover bumps `term`. Each message carries the sender's pair and full match;
// the higher term wins, so after any drop or forced takeover both phones agree
// on one scorer and one match as soon as they reconnect.
//
// Messages: { t: 'state', from, term, scorer, match, series, have } | { t: 'req', from } | { t: 'deny', from }
//           | { t: 'match', from, series, match }   one finished match of the current series
//
// Series: the scorer's current series (consecutive matches of the same two
// teams) is adopted by the watcher, which then says which finished matches of it
// it already holds (`have`). Each phone sends the other only what is missing,
// one match per message. Older series are never sent.
// `store` (optional): { list(seriesId) -> Promise<finished matches>, add(match) }.

export function createSync({ deviceId, mode = () => 'ask', send, onChange = () => {}, store = null }) {
  const s = {
    term: 0,
    scorer: null,
    match: null,
    connected: false,
    peer: null,
    pending: false, // I asked to take over and wait for an answer
    request: false, // the other phone asked me (I am scorer, 'ask' mode)
    note: '', // last notable event, for a toast
    series: null, // id of the series being shared
    have: null, // finished matches of it held here (null until known)
  };

  const changed = (note = '') => {
    s.note = note;
    onChange(api);
  };
  const sendState = () =>
    s.connected && send({ t: 'state', from: deviceId, term: s.term, scorer: s.scorer, match: s.match, series: s.series, have: s.have });

  async function advertise() {
    if (!store || !s.series || !s.connected) return;
    const series = s.series;
    const have = (await store.list(series)).map((m) => m.id);
    if (s.series !== series) return;
    s.have = have;
    sendState();
  }

  // The other phone listed what it has of our series: send the rest.
  async function pushMissing(msg) {
    if (!store || !s.series || msg.series !== s.series || !Array.isArray(msg.have)) return;
    const theirs = new Set(msg.have);
    for (const m of await store.list(s.series)) {
      if (!theirs.has(m.id) && s.connected) send({ t: 'match', from: deviceId, series: s.series, match: m });
    }
  }

  function adopt(msg) {
    if (isScorer() || msg.scorer !== msg.from || !msg.series || msg.series === s.series) return;
    s.series = msg.series;
    s.have = null;
    advertise();
  }

  const follow = (match) => {
    if (match?.series && match.series !== s.series) {
      s.series = match.series;
      s.have = null;
    }
  };

  // Does (term, scorer) `a` beat `b`? Equal terms with different scorers only
  // happen after two offline forced takeovers: lowest device id wins.
  const beats = (a, b) =>
    a.term > b.term || (a.term === b.term && a.scorer !== b.scorer && a.scorer != null && (b.scorer == null || a.scorer < b.scorer));

  function grant() {
    s.term++;
    s.scorer = s.peer;
    s.request = false;
    sendState();
    changed('The other phone is scoring now');
  }

  function receive(msg) {
    if (!msg || msg.from === deviceId) return;
    s.peer = msg.from;
    if (msg.t === 'match') {
      const m = msg.match;
      if (!store || !m || !m.id || m.series !== s.series || msg.series !== s.series || s.have?.includes(m.id)) return;
      s.have = [...(s.have || []), m.id];
      store.add(m);
      return;
    }
    handleState(msg);
    if (msg.t === 'state') pushMissing(msg);
  }

  function handleState(msg) {
    if (msg.t === 'req') {
      if (!isScorer()) return;
      if (mode() === 'instant') return grant();
      s.request = true;
      return changed();
    }
    if (msg.t === 'deny') {
      s.pending = false;
      return changed('The scorer said no to the takeover');
    }
    if (msg.t !== 'state') return;
    if (beats(msg, s)) {
      const wasScorer = isScorer();
      s.term = msg.term;
      s.scorer = msg.scorer;
      s.match = msg.match;
      s.request = false;
      if (isScorer()) s.pending = false;
      follow(isScorer() ? s.match : null);
      adopt(msg);
      return changed(isScorer() && !wasScorer ? 'You are now the scorer' : !isScorer() && wasScorer ? 'The other phone is scoring now' : '');
    }
    if (msg.term === s.term && msg.scorer === s.scorer) {
      // Same authority: take the scorer's match; ignore echoes of my own.
      if (!isScorer()) {
        s.match = msg.match;
        adopt(msg);
        changed();
      }
      return;
    }
    sendState(); // the other phone is behind: bring it up to date
  }

  const isScorer = () => s.scorer === deviceId;

  const api = {
    get state() {
      return s;
    },
    get role() {
      return isScorer() ? 'scorer' : 'viewer';
    },
    // The phone that starts sharing scores first.
    host(match) {
      s.term = Math.max(s.term, 1);
      s.scorer = deviceId;
      s.match = match;
      follow(match);
      changed();
    },
    setMatch(match) {
      if (!isScorer()) throw new Error('Only the scorer can change the match');
      s.match = match;
      follow(match);
      sendState();
    },
    connected(on) {
      s.connected = on;
      if (!on) {
        s.pending = false;
        s.request = false;
      }
      if (on) {
        sendState();
        advertise();
      }
      changed(on ? '' : 'Connection lost');
    },
    receive,
    requestTakeover() {
      if (isScorer()) return;
      if (!s.connected) throw new Error('Not connected');
      s.pending = true;
      send({ t: 'req', from: deviceId });
      changed();
    },
    respond(accept) {
      if (!s.request) return;
      if (accept) return grant();
      s.request = false;
      send({ t: 'deny', from: deviceId });
      changed();
    },
    // Only when the other phone is gone (flat battery etc). If it comes back,
    // the higher term makes it a viewer automatically.
    forceTakeover() {
      if (isScorer()) return;
      if (s.connected) throw new Error('Ask the scorer instead');
      s.term++;
      s.scorer = deviceId;
      s.pending = false;
      changed('You are now the scorer');
    },
  };
  return api;
}
