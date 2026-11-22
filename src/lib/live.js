// Live sharing between two phones in a room, over a PeerJS (WebRTC) data
// channel. The PeerJS cloud server only introduces the phones; the match goes
// phone to phone, encrypted, and is never stored on any server. With a TURN key
// saved on this phone, phones on strict mobile networks connect through Open
// Relay, which only forwards the encrypted bytes.
//
// The phone that creates the room is its host. A joining phone says hello with
// its device id; the host lets it in only if it is on the series' share list,
// or after asking the user. Removing a phone closes its link at once and moves
// the room to a new code, so an old code is useless.
//
// phase: 'idle' | 'connecting' (host: opening the room; guest: reaching it)
//        | 'waiting' (host: room open, nobody connected) | 'approval' (guest:
//        waiting for the host to let it in) | 'connected' | 'lost' (guest:
//        retrying on its own)
import { Peer } from 'peerjs';
import { PEER_SERVER, ROOM_PREFIX, CONNECT_HINT_MS, MAX_MESSAGE, RATE, ROOM_TTL_MS } from './syncConfig.js';
import { createLimiter, iceServers, loadTurn, makeRoomCode, peerIdFor, loadRoom, saveRoom, clearRoom } from './room.js';
import { createSync } from './sync.js';

const REFUSED = {
  busy: 'Another phone is already connected to this room.',
  denied: 'The scorer did not let this phone join.',
  removed: 'You were removed from this series. Ask the scorer to add you again.',
};

// allowed(id) -> Promise<bool>: is this device on the current series' share list?
export function createLive({ deviceId, mode, onChange, store, allowed }) {
  let peer = null;
  let host = false;
  let room = null; // room code
  let name = '';
  let phase = 'idle';
  let error = '';
  let link = null; // the connection that passed hello/welcome: sync runs over it
  let dialing = null; // guest: connection waiting for welcome
  let joinReq = null; // host: { c, id, name } waiting for the user's answer
  let everJoined = false;
  let last = 0;
  let saved = 0;
  let slow = false;
  let timers = { slow: 0, retry: 0, ttl: 0 };
  let tries = 0;

  const emit = () => onChange(api);
  const sync = createSync({ deviceId, mode, send: (m) => out(link, m), onChange: emit, store });

  function out(c, m) {
    if (!c?.open) return;
    const text = JSON.stringify(m);
    if (text.length > MAX_MESSAGE) return; // the other phone would drop it anyway
    try {
      c.send(text);
      touch();
    } catch {
      /* channel closing */
    }
  }

  function touch() {
    last = Date.now();
    if (last - saved > 60_000) {
      saved = last;
      saveRoom({ code: room, host, series: sync.state.series, last });
    }
  }

  function setPhase(p) {
    phase = p;
    if (p === 'connecting' || p === 'lost') {
      timers.slow ||= setTimeout(() => {
        slow = true;
        emit();
      }, CONNECT_HINT_MS);
    } else {
      clearTimeout(timers.slow);
      timers.slow = 0;
      slow = false;
    }
    emit();
  }

  function stop(msg = '') {
    for (const t of Object.values(timers)) clearTimeout(t), clearInterval(t);
    timers = { slow: 0, retry: 0, ttl: 0 };
    removeEventListener('online', redialNow);
    const p = peer;
    peer = link = dialing = joinReq = null;
    p?.destroy();
    error = msg;
    room = null;
    host = false;
    if (msg) clearRoom();
    phase = 'idle';
    slow = false;
    if (sync.state.connected) sync.connected(false);
    else emit();
  }

  function wire(c) {
    const ok = createLimiter(RATE);
    let dropped = 0;
    c.on('open', () => {
      if (!host && c === dialing) {
        out(c, { t: 'hello', id: deviceId, name });
        setPhase('approval');
      }
    });
    c.on('data', (raw) => {
      if (typeof raw !== 'string' || raw.length > MAX_MESSAGE || !ok()) {
        if (++dropped > 50) c.close(); // flooding
        return;
      }
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (!m || typeof m !== 'object') return;
      touch();
      host ? fromGuest(c, m) : fromHost(c, m);
    });
    c.on('close', () => closed(c));
    c.on('error', () => closed(c));
  }

  // ---------- host ----------

  async function fromGuest(c, m) {
    if (c === link) return sync.receive(m);
    if (m.t !== 'hello' || typeof m.id !== 'string' || c.gsId) return;
    c.gsId = m.id.slice(0, 40);
    c.gsName = String(m.name || '').trim().slice(0, 30) || 'Another phone';
    if (link && link.gsId !== c.gsId) return refuse(c, 'busy');
    if (await allowed(c.gsId)) return welcome(c);
    if (joinReq && joinReq.c !== c) return refuse(c, 'busy');
    joinReq = { c, id: c.gsId, name: c.gsName };
    emit();
  }

  function welcome(c) {
    if (!c.open) return;
    joinReq = null;
    const old = link;
    link = c;
    if (old && old !== c) old.close(); // the same phone reconnected
    out(c, { t: 'welcome' });
    setPhase('connected');
    sync.connected(true);
  }

  function refuse(c, why) {
    out(c, { t: 'refused', why });
    setTimeout(() => c.close(), 300);
  }

  function openRoom(code) {
    room = code;
    host = true;
    setPhase('connecting');
    const p = newPeer(peerIdFor(ROOM_PREFIX, code));
    p.on('open', () => {
      if (p !== peer) return;
      tries = 0;
      touch();
      if (!link) setPhase('waiting');
    });
    p.on('connection', (c) => {
      if (p !== peer) return c.close();
      wire(c);
      setTimeout(() => !c.gsId && c.close(), 15_000); // said nothing
    });
  }

  // ---------- guest ----------

  function fromHost(c, m) {
    if (m.t === 'welcome' && c === dialing) {
      dialing = null;
      link = c;
      everJoined = true;
      tries = 0;
      setPhase('connected');
      return sync.connected(true);
    }
    if (m.t === 'refused') return stop(REFUSED[m.why] || REFUSED.denied);
    if (c === link) sync.receive(m);
  }

  function dial() {
    clearTimeout(timers.retry);
    timers.retry = 0;
    if (!peer || host || link || dialing) return;
    if (!peer.open) return peer.disconnected && !peer.destroyed && peer.reconnect();
    const c = (dialing = peer.connect(peerIdFor(ROOM_PREFIX, room), { reliable: true, serialization: 'raw' }));
    wire(c);
    // An offer nobody answers (the room just closed or moved): try again,
    // which then reports a missing room properly.
    setTimeout(() => {
      if (c !== dialing || c.open) return;
      dialing = null;
      c.close();
      redialLater();
    }, 15_000);
  }

  function redialLater() {
    if (host || !peer || timers.retry) return;
    const wait = Math.min(15_000, 2000 * 2 ** Math.min(tries++, 3));
    timers.retry = setTimeout(dial, wait);
  }

  function guestPeer() {
    const p = newPeer();
    p.on('open', () => p === peer && dial()); // also fires after a server reconnect
  }

  const redialNow = () => !host && peer && !link && (dialing?.close(), (dialing = null), dial());

  // ---------- both ----------

  function newPeer(id) {
    const p = new Peer(id, { ...PEER_SERVER, debug: 0, config: { iceServers: iceServers(loadTurn()) } });
    peer = p;
    const later = (ms) => setTimeout(() => p === peer && revive(), ms);
    // Lost the signalling server (not the other phone): reconnect quietly.
    p.on('disconnected', () => later(3000));
    p.on('error', (e) => {
      if (p !== peer) return;
      const type = e?.type;
      if (type === 'browser-incompatible') return stop('This browser cannot do live sharing.');
      if (type === 'unavailable-id' && host) {
        // Usually this phone's own room from before a reload, still held by
        // the server for a few seconds.
        if (tries++ > 12) return stop('That room code is in use. Create a new room.');
        p.destroy();
        return later(5000);
      }
      if (type === 'peer-unavailable' && !host) {
        dialing = null;
        if (!everJoined) return stop('Room not found. Check the code; rooms close after 3 hours without activity.');
        return redialLater(); // the host may be reloading
      }
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(type)) later(5000);
    });
    timers.ttl ||= setInterval(() => {
      if (Date.now() - last > ROOM_TTL_MS) stop('The room closed after 3 hours without activity.');
    }, 60_000);
    addEventListener('online', redialNow);
    return p;
  }

  // Bring the signalling side back: a peer that never reached the server is
  // destroyed by PeerJS and must be rebuilt; one that lost it can reconnect.
  function revive() {
    const p = peer;
    if (!room || !p) return;
    if (p.destroyed) host ? openRoom(room) : guestPeer();
    else if (p.disconnected) p.reconnect();
  }

  function closed(c) {
    if (c === link) {
      link = null;
      sync.connected(false);
      setPhase(host ? 'waiting' : 'lost');
      if (!host) redialLater();
    } else if (c === dialing) {
      dialing = null;
      if (phase !== 'idle') redialLater();
    } else if (joinReq?.c === c) {
      joinReq = null;
      emit();
    }
  }

  const api = {
    sync,
    get phase() {
      return phase;
    },
    get snapshot() {
      const s = sync.state;
      return {
        phase,
        host,
        room,
        slow,
        error,
        role: sync.role,
        connected: s.connected,
        pending: s.pending,
        request: s.request,
        note: s.note,
        joinReq: joinReq && { id: joinReq.id, name: joinReq.name },
        peerName: link?.gsName || '',
        peerId: link?.gsId || '',
      };
    },
    // This phone opens a room for its series (call sync.host first). After a
    // reload it reopens the same, still fresh room so the other phone can
    // come back with the code it has.
    createRoom() {
      const prev = loadRoom();
      stop();
      last = Date.now();
      saved = 0;
      const same = prev?.host && prev.series && prev.series === sync.state.series;
      openRoom(same ? prev.code : makeRoomCode());
      touch();
    },
    joinRoom(code, myName) {
      stop();
      room = code;
      name = myName;
      everJoined = false;
      tries = 0;
      last = Date.now();
      saved = 0;
      setPhase('connecting');
      guestPeer();
      touch();
    },
    retry: redialNow,
    // Host: answer a phone that is not on the share list yet.
    answerJoin(allow) {
      const r = joinReq;
      if (!r) return;
      joinReq = null;
      allow ? welcome(r.c) : refuse(r.c, 'denied');
      emit();
    },
    // Host: a phone was taken off the share list. Cut it off now and move to
    // a new code so it can't come back with the old one.
    remove(id) {
      if (!host) return;
      if (joinReq?.id === id) api.answerJoin(false);
      if (link?.gsId !== id) return;
      const c = link;
      out(c, { t: 'refused', why: 'removed' });
      link = null;
      sync.connected(false);
      setTimeout(() => c.close(), 300);
      const p = peer;
      peer = null;
      setTimeout(() => p?.destroy(), 400);
      tries = 0;
      openRoom(makeRoomCode());
      touch();
    },
    leave() {
      stop();
      clearRoom();
    },
  };
  return api;
}
