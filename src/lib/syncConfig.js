// Every address and limit used by phone-to-phone sync lives here, so the
// signalling server can be swapped for a self-hosted PeerJS server later
// (change PEER_SERVER only). Sync uses no keys or paid services.

// Signalling: PeerJS's free cloud server. It only introduces the two phones;
// match data never passes through it.
export const PEER_SERVER = { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' };

// PeerJS ids are shared by every app on the server, so ours get a prefix.
export const ROOM_PREFIX = 'gullyscore-';

export const STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

export const ROOM_TTL_MS = 3 * 60 * 60 * 1000; // a room closes after 3 hours without activity
export const CONNECT_HINT_MS = 20_000; // show the "still connecting" hint after this
export const MAX_MESSAGE = 250_000; // characters; larger messages are dropped
export const RATE = { burst: 100, perSec: 20 }; // incoming messages per connection
