import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packDescription, unpackDescription } from './signal.js';
import { encodeQR } from './qr.js';

// Shaped like a real Chrome offer, with documentation-only addresses.
const OFFER = [
  'v=0',
  'o=- 2758251047818460074 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 39942 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 203.0.113.7',
  'a=candidate:3425593065 1 udp 2113937151 bde67781-f109-4278-b534-44742b16b5d6.local 39942 typ host generation 0 network-cost 999',
  'a=candidate:1 1 udp 2113937151 192.168.1.23 39942 typ host generation 0',
  'a=candidate:2 1 tcp 1518280447 192.168.1.23 9 typ host tcptype active generation 0',
  'a=candidate:3 1 udp 2113939711 2001:db8::1:2 40001 typ host generation 0',
  'a=candidate:1094135892 1 udp 1677729535 203.0.113.7 39942 typ srflx raddr 0.0.0.0 rport 0 generation 0',
  'a=candidate:1094135892 1 udp 1677729535 203.0.113.7 39942 typ srflx raddr 0.0.0.0 rport 0 generation 0',
  'a=ice-ufrag:Tk55',
  'a=ice-pwd:fENPCRZvA/sqHI69aCkTvh+7',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 EC:40:D1:EC:D9:10:7A:71:12:0D:AA:31:5B:47:89:DD:DA:08:2A:87:FF:97:00:41:3A:0C:DF:21:F7:BB:43:6D',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

test('offer packs into a short QR-friendly code and back', () => {
  const code = packDescription({ type: 'offer', sdp: OFFER });
  assert.match(code, /^GS1[0-9A-V]+$/);
  assert.ok(code.length <= 200, `code is ${code.length} chars`);
  assert.ok(encodeQR(code).size <= 49, 'fits a version 8 QR or smaller');
  const { type, sdp } = unpackDescription(code);
  assert.equal(type, 'offer');
  for (const line of [
    'a=ice-ufrag:Tk55',
    'a=ice-pwd:fENPCRZvA/sqHI69aCkTvh+7',
    'a=fingerprint:sha-256 EC:40:D1:EC:D9:10:7A:71:12:0D:AA:31:5B:47:89:DD:DA:08:2A:87:FF:97:00:41:3A:0C:DF:21:F7:BB:43:6D',
    'a=setup:actpass',
    'a=mid:0',
    'a=group:BUNDLE 0',
  ])
    assert.ok(sdp.includes(line), line);
  const cands = sdp.match(/a=candidate:.*/g);
  assert.equal(cands.length, 4, 'tcp and duplicate dropped, capped at 4');
  assert.match(cands[0], / 192\.168\.1\.23 39942 typ host$/);
  assert.match(cands[1], / bde67781-f109-4278-b534-44742b16b5d6\.local 39942 typ host$/);
  assert.match(cands[2], / 203\.0\.113\.7 39942 typ srflx raddr/);
  assert.match(cands[3], / 2001:db8:0:0:0:0:1:2 40001 typ host$/);
  assert.ok(sdp.endsWith('\r\n'));
});

test('answer keeps its type and DTLS role', () => {
  const ans = OFFER.replace('a=setup:actpass', 'a=setup:active');
  const { type, sdp } = unpackDescription(packDescription({ type: 'answer', sdp: ans }));
  assert.equal(type, 'answer');
  assert.ok(sdp.includes('a=setup:active'));
});

test('codes survive lower case and stray spaces; damage is detected', () => {
  const code = packDescription({ type: 'offer', sdp: OFFER });
  assert.equal(unpackDescription(` ${code.toLowerCase().replace(/(.{20})/g, '$1 ')}\n`).type, 'offer');
  const broken = code.slice(0, 40) + (code[40] === 'A' ? 'B' : 'A') + code.slice(41);
  assert.throws(() => unpackDescription(broken), /Damaged/);
  assert.throws(() => unpackDescription(code.slice(0, 60)), /Damaged/);
  assert.throws(() => unpackDescription('HELLO'), /Not a Gully Score code/);
});

test('rejects descriptions without the needed fields', () => {
  assert.throws(() => packDescription({ type: 'offer', sdp: 'v=0\r\n' }), /Unsupported/);
});
