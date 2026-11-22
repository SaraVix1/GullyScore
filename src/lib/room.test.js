import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoomCode, parseRoomCode, roomLink, peerIdFor, createLimiter, iceServers, isExpired } from './room.js';

test('room codes are 12 random symbols in 3 groups', () => {
  const a = makeRoomCode();
  assert.match(a, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  const seen = new Set(Array.from({ length: 500 }, () => makeRoomCode()));
  assert.equal(seen.size, 500);
});

test('parse accepts typed codes and room links, rejects junk', () => {
  assert.equal(parseRoomCode(' abcd efgh jkmn '), 'ABCD-EFGH-JKMN');
  assert.equal(parseRoomCode('https://x.io/GullyScore/#room=ABCD-EFGH-JKMN'), 'ABCD-EFGH-JKMN');
  assert.equal(parseRoomCode(roomLink('https://x.io/a/#old', 'ABCD-EFGH-JKMN')), 'ABCD-EFGH-JKMN');
  assert.equal(parseRoomCode('ABCD-EFGH-JKM'), null); // too short
  assert.equal(parseRoomCode('ABCD-EFGH-JKM0'), null); // 0 is not used
  assert.equal(parseRoomCode('GS1ABCDEF'), null);
});

test('peer id is prefixed and lower case', () => {
  assert.equal(peerIdFor('gullyscore-', 'ABCD-EFGH-JKMN'), 'gullyscore-abcdefghjkmn');
});

test('limiter allows a burst then refills over time', () => {
  let t = 0;
  const ok = createLimiter({ burst: 3, perSec: 2 }, () => t);
  assert.deepEqual([ok(), ok(), ok(), ok()], [true, true, true, false]);
  t = 500;
  assert.equal(ok(), true);
  assert.equal(ok(), false);
});

test('ICE uses free STUN only, no keys', () => {
  const s = iceServers();
  assert.equal(s.length, 1);
  assert.ok(s[0].urls.every((u) => u.startsWith('stun:')));
  assert.equal(s[0].username, undefined);
});

test('expiry', () => {
  assert.equal(isExpired(1000, 2000), false);
  assert.equal(isExpired(0, 2000), true);
  assert.equal(isExpired(1, 4 * 3600e3), true);
});
