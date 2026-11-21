// Compact WebRTC connection codes for QR pairing, with no signalling server.
// An SDP offer/answer is ~600 characters; only a few fields matter for a data
// channel (ICE credentials, DTLS fingerprint, candidates), so we pack those
// into ~90 bytes and rebuild a minimal SDP on the other phone.
//
// Code format: "GS1" + base32 of
//   [flags][mid][ufrag][pwd][fingerprint x32][count][candidates...][crc16]
// Base32 uses only 0-9 A-V, which is QR alphanumeric and survives copy/paste.

const B32 = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
const PREFIX = 'GS1';
const SETUP = ['actpass', 'active', 'passive'];
const TYPES = ['host', 'srflx', 'prflx'];
const MAX_CANDIDATES = 4;

function crc16(bytes) {
  let c = 0xffff;
  for (const b of bytes) {
    c ^= b << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

function toB32(bytes) {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) out += B32[(acc >>> (bits -= 5)) & 31];
  }
  if (bits) out += B32[(acc << (5 - bits)) & 31];
  return out;
}

function fromB32(str) {
  const out = [];
  let acc = 0;
  let bits = 0;
  for (const ch of str) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('bad');
    acc = ((acc << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) out.push((acc >>> (bits -= 8)) & 255);
  }
  return out;
}

const hex = (s) => s.match(/../g).map((h) => parseInt(h, 16));

function addrBytes(addr) {
  const v4 = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) return [0, v4.slice(1).map(Number)];
  const mdns = addr.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i);
  if (mdns) return [2, hex(mdns.slice(1).join(''))];
  if (addr.includes(':')) {
    const [head, tail = ''] = addr.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    if (!addr.includes('::') && h.length !== 8) return null;
    const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
    return [1, groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255])];
  }
  return null;
}

function addrText(kind, b) {
  if (kind === 0) return b.join('.');
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  if (kind === 2) return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
  return h.match(/..../g).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}

// Pack an RTCSessionDescription ({ type, sdp }) into a short code.
export function packDescription({ type, sdp }) {
  const get = (re) => (sdp.match(re) || [])[1];
  const ufrag = get(/a=ice-ufrag:(\S+)/);
  const pwd = get(/a=ice-pwd:(\S+)/);
  const fp = get(/a=fingerprint:sha-256 (\S+)/i);
  const mid = get(/a=mid:(\S+)/) || '0';
  const setup = SETUP.indexOf(get(/a=setup:(\S+)/));
  if (!ufrag || !pwd || !fp || setup < 0) throw new Error('Unsupported connection details');

  const cands = [];
  const seen = new Set();
  for (const m of sdp.matchAll(/a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ (host|srflx|prflx)/gi)) {
    const a = addrBytes(m[1]);
    const key = m[1] + ':' + m[2];
    if (!a || seen.has(key)) continue;
    seen.add(key);
    const rank = (a[0] === 0 ? 0 : a[0] === 2 ? 1 : 3) + (m[3] === 'host' ? 0 : 1);
    cands.push({ rank, kind: a[0], addr: a[1], port: +m[2], type: TYPES.indexOf(m[3].toLowerCase()) });
  }
  cands.sort((a, b) => a.rank - b.rank);

  const out = [0x10 | ((type === 'answer' ? 1 : 0) << 3) | setup];
  const str = (s) => out.push(s.length, ...[...s].map((c) => c.charCodeAt(0)));
  str(mid);
  str(ufrag);
  str(pwd);
  out.push(...hex(fp.replace(/:/g, '')));
  const keep = cands.slice(0, MAX_CANDIDATES);
  out.push(keep.length);
  for (const c of keep) out.push(c.type | (c.kind << 2), ...c.addr, c.port >> 8, c.port & 255);
  const crc = crc16(out);
  out.push(crc >> 8, crc & 255);
  return PREFIX + toB32(out);
}

// Rebuild a minimal SDP from a code. Throws on anything malformed.
export function unpackDescription(code) {
  const clean = String(code).toUpperCase().replace(/[^0-9A-V]/g, '');
  if (!clean.startsWith(PREFIX)) throw new Error('Not a Gully Score code');
  let b;
  try {
    b = fromB32(clean.slice(PREFIX.length));
  } catch {
    throw new Error('Damaged code');
  }
  const body = b.slice(0, -2);
  if (b.length < 40 || crc16(body) !== ((b[b.length - 2] << 8) | b[b.length - 1])) throw new Error('Damaged code');
  let i = 0;
  const flags = body[i++];
  if (flags >> 4 !== 1) throw new Error('Code from a newer app version');
  const str = () => {
    const n = body[i++];
    return String.fromCharCode(...body.slice(i, (i += n)));
  };
  const mid = str();
  const ufrag = str();
  const pwd = str();
  const fp = body
    .slice(i, (i += 32))
    .map((x) => x.toString(16).toUpperCase().padStart(2, '0'))
    .join(':');
  const count = body[i++];
  const lines = [];
  for (let k = 0; k < count; k++) {
    const f = body[i++];
    const kind = f >> 2;
    const len = kind === 0 ? 4 : 16;
    const addr = addrText(kind, body.slice(i, (i += len)));
    const port = (body[i++] << 8) | body[i++];
    const type = TYPES[f & 3];
    const prio = type === 'host' ? 2113937151 - k : 1677729535 - k;
    lines.push(`a=candidate:${k + 1} 1 udp ${prio} ${addr} ${port} typ ${type}${type === 'host' ? '' : ' raddr 0.0.0.0 rport 0'}`);
  }
  const sdp = [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    `a=group:BUNDLE ${mid}`,
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...lines,
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${SETUP[flags & 3]}`,
    `a=mid:${mid}`,
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    'a=end-of-candidates',
    '',
  ].join('\r\n');
  return { type: flags & 8 ? 'answer' : 'offer', sdp };
}
