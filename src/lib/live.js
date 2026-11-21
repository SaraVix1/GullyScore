// Live sharing between two phones over WebRTC. Pairing is done by scanning QR
// codes both ways (see signal.js), so no server ever sees the match: a free
// public STUN server only helps each phone learn its own address.
import { packDescription, unpackDescription } from './signal.js';
import { createSync } from './sync.js';

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

function createPeer({ onOpen, onClose, onMessage, onUnstable }) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const dc = pc.createDataChannel('gully', { negotiated: true, id: 0 });
  let closed = false;
  let ready = false;
  let hello;
  const close = () => {
    clearInterval(hello);
    if (closed) return;
    closed = true;
    onClose();
  };
  // The scanning phone's channel can open before the other phone has scanned
  // its reply (and so before that phone can verify it). Only count as
  // connected once the other side says hello: it can only do that after
  // completing pairing.
  dc.onopen = () => {
    const hi = () => dc.readyState === 'open' && dc.send('{"t":"hi"}');
    hi();
    hello = setInterval(hi, 400);
  };
  dc.onclose = close;
  dc.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (!ready) {
      ready = true;
      clearInterval(hello);
      onOpen();
    }
    if (msg.t !== 'hi') onMessage(msg);
  };
  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    if (st === 'disconnected') onUnstable(true);
    else if (st === 'connected' || st === 'completed') onUnstable(false);
    else if (st === 'failed' || st === 'closed') close();
  };
  // No trickle ICE: wait for candidates so a single code carries them all.
  const gathered = () =>
    new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const t = setTimeout(resolve, 4000);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') clearTimeout(t), resolve();
      });
    });
  return {
    async offer() {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered();
      return packDescription(pc.localDescription);
    },
    async accept(code) {
      const d = unpackDescription(code);
      if (d.type !== 'answer') throw new Error("That's a first code. Scan the reply code from the other phone.");
      await pc.setRemoteDescription(d);
    },
    async answer(code) {
      const d = unpackDescription(code);
      if (d.type !== 'offer') throw new Error("That's a reply code. Scan the first code from the other phone.");
      await pc.setRemoteDescription(d);
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered();
      return packDescription(pc.localDescription);
    },
    send(msg) {
      if (dc.readyState === 'open') dc.send(JSON.stringify(msg));
    },
    close() {
      closed = true;
      clearInterval(hello);
      dc.close();
      pc.close();
    },
  };
}

// phase: 'idle' | 'pairing' | 'connected' | 'unstable' | 'lost'
export function createLive({ deviceId, mode, onChange, store }) {
  let peer = null;
  let phase = 'idle';
  const emit = () => onChange(api);
  const sync = createSync({ deviceId, mode, send: (m) => peer?.send(m), onChange: emit, store });

  function newPeer() {
    peer?.close();
    const p = createPeer({
      onOpen: () => {
        if (p !== peer) return;
        phase = 'connected';
        sync.connected(true);
      },
      onClose: () => {
        if (p !== peer) return;
        phase = 'lost';
        sync.connected(false);
      },
      onMessage: (m) => p === peer && sync.receive(m),
      onUnstable: (bad) => {
        // Only a blip on an established link; ICE also reports 'connected'
        // during pairing, before the other phone has said hello.
        if (p !== peer || (phase !== 'connected' && phase !== 'unstable')) return;
        if (bad) {
          phase = 'unstable';
          emit();
        } else if (phase === 'unstable') {
          phase = 'connected';
          sync.connected(true); // resend state after the blip
        }
      },
    });
    peer = p;
    if (phase !== 'lost') phase = 'pairing';
    emit();
    return p;
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
        role: sync.role,
        connected: s.connected,
        pending: s.pending,
        request: s.request,
        note: s.note,
      };
    },
    // Step 1 on the phone that goes first: returns the code to show.
    showCode: () => newPeer().offer(),
    // Step 2 on that phone: the reply code scanned from the other phone.
    acceptReply: (code) => peer.accept(code),
    // On the phone that scans first: returns the reply code to show.
    replyTo: (code) => newPeer().answer(code),
    leave() {
      peer?.close();
      peer = null;
      phase = 'idle';
      sync.connected(false);
    },
  };
  return api;
}
