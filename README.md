# Gully Score

Ball-by-ball cricket scoring for street and local matches. A tiny, offline-first
Progressive Web App built with Svelte 5 + Vite. No backend: everything is stored on
the phone in IndexedDB.

- ~43 KB JS + 5 KB CSS (gzipped), no runtime dependencies beyond Svelte
- Works fully offline after the first visit, installable on Android and iPhone
- Teams with emoji + colour identities, local rule toggles, free hits, retirements,
  penalty runs, mid-over bowler changes, Super Over, share as text or image,
  match history, JSON backup/restore
- Live sync between two phones over WebRTC (PeerJS), even on different networks:
  create a room, the other phone scans its QR code or types the code. Safe handover
  of the scorer role. Loaded only when used (~115 KB, 35 KB gzipped)

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 (no service worker in dev)
npm test           # scoring engine tests (node:test, no extra deps)
npm run build      # production build into dist/
npm run preview    # serve dist/ with the service worker on http://localhost:4173
npm run icons      # regenerate the PNG icons in public/
```

## Project layout

```
src/lib/engine.js       Scoring engine: pure functions, no DOM or storage
src/lib/engine.test.js  Engine tests
src/lib/teams.js        Built-in team names, emoji, colours
src/lib/db.js           IndexedDB: current match, history, prefs, backup
src/lib/share.js        Text / canvas-image scorecards, Web Share + fallbacks
src/lib/qr.js           QR encoder + camera decoder (for iPhone, which lacks BarcodeDetector)
src/lib/syncConfig.js   PeerJS server address, STUN/TURN URLs, room lifetime, limits (one place)
src/lib/room.js         Room codes, rate limiter, ICE list, this phone's TURN key (unit-tested)
src/lib/sync.js         Live sync rules: one scorer, takeover, resync (unit-tested)
src/lib/live.js         PeerJS rooms: join approval, share list, reconnects, expiry
src/screens/            Setup, Scoring, Result, History, Settings
src/components/         Sheet, Scorecard, TeamEditor, ShareSheet, Badge
src/sw.js               Service worker template (precache list filled in at build)
vite.config.js          Relative base + plugin that writes dist/sw.js
scripts/make-icons.js   Zero-dependency PNG icon renderer
```

### How the data works

A match is plain JSON: settings, team identities, player names and an append-only
**event log** per innings (`ball`, `penalty`, `retire`, `bowler`, `bat`, `swap`).
Everything on screen (score, strike, overs, free hit, result) is computed by
replaying that log in `getState(match)`. That gives:

- **Undo** = drop the last scoring event (plus any bowler pick or batter change after it).
- **Autosave** = write the match object to IndexedDB after every change, in one
  transaction together with its history entry, so a ball is never half-saved.
- **Future live sync** = send events; `match.rev` increments on every change, so two
  devices can tell who is ahead and resync by exchanging the event lists.

Innings `0` and `1` are the main match; each Super Over appends a pair (`2, 3`, ...).

A `ball` event is worth `runs + ot`. `ot` holds overthrow runs, which are never
run, so they don't change strike. A custom-runs ball also stores `ran`, the runs
the batters actually ran. Strike changes when `ran ?? runs` is odd. Overthrows on
a wide, no ball, bye or leg bye go to that extra, never to the batter.

**Continue with same teams** saves the teams, with their icons, colours and
player names, under the IndexedDB key `next`, so they survive a restart. **New
match** clears that key. Each history entry keeps its own copy of the match, so
renaming a player later doesn't change old scorecards.

### Edit log, series, appearance

- **Edit log:** `match.log` is an append-only list (Undo, renames, retirements, bowler and
  batter changes, strike swaps, penalties, takeovers) with the over, the score before and
  after, and a hash chained to the previous entry, so an altered entry shows as "log has
  been altered" (tamper-evident, not cryptographic). It lives inside the match, so it is
  saved, exported, synced and deleted with it. See `src/lib/editlog.js`.
- **Series:** every match has a `series` id; Continue with same teams keeps it (renaming a
  team starts a new one). History groups by series with a win tally. Live sharing sends the
  current series only, and only the finished matches the other phone lacks.
- **Appearance:** Settings has Theme (System / Light / Dark) and Accent colour, saved in
  localStorage on that phone only. All colours are CSS variables in `src/app.css`;
  `index.html` applies the saved choice before first paint. `npm test` includes
  `src/lib/contrast.test.js`, which checks the contrast of the main pairs in both themes.

## Live sync (two phones)

1. On the scoring phone: **Settings → Sync → Create room** (or match menu ⋯ → **Share live**).
   It shows a room code such as `KV7A-74EA-4ZZG` and a QR code for the current series.
2. On the other phone: **Settings → Sync → Join room** (or **Join live** on the start
   screen), then scan the QR code or type the code. Scanning it with the phone's own
   camera app also works: the QR code is a link that opens Gully Score on the join screen.
3. The first time, the scoring phone asks **Let this phone join?** Tapping **Let in** adds
   that phone to the series' **share list**; next time it joins without asking.

The watching phone sees every ball as it happens and can tap **Take over scoring**.
**Takeover mode** (Settings → Sync, or the Sync sheet) is **Ask me first** (control moves
only after the scorer accepts) or **Instant**. Whoever takes control becomes the only scorer;
the other phone turns watch-only.

What gets synced: the whole current series, meaning every finished match in it (with its
edit log) plus the live match. Each phone sends only the finished matches the other lacks.
Older series are never sent.

How it works:

- **Signalling** uses the free PeerJS cloud server (`0.peerjs.com`), which only introduces
  the two phones. Match data goes phone to phone over an encrypted WebRTC data channel and is
  never stored on any server. GitHub Pages is static, so there is no backend of ours; to use a
  self-hosted PeerJS server, change `PEER_SERVER` in `src/lib/syncConfig.js`.
- **TURN (optional):** phones on strict mobile networks sometimes can't reach each other
  directly. Sign up free at Open Relay (metered.ca), create a TURN app, and paste its username
  and credential in **Settings → Sync → TURN key**. The key is saved in that phone's
  localStorage only, shown masked, and never synced, backed up or committed. **Clear key**
  removes it. No key is in the code.
- **Rooms:** codes are 12 random symbols (60 bits) from `crypto.getRandomValues`. A room
  closes after 3 hours without activity. After a reload the scoring phone reopens the same
  room for the same series, so the other phone reconnects with the code it has.
- **Share list:** only phones on the series' list get in; others must be let in by the room's
  phone. **Remove** cuts that phone off at once and moves the room to a new code, so the old
  code stops working. The list is kept on the phone that creates the room. One other phone
  can be connected at a time.
- **Limits:** messages over 250 KB are dropped, incoming messages are rate-limited (burst 100,
  20/s), and a flooding connection is closed. Nothing is logged; PeerJS runs with logging off.
- **Reconnects:** if the link drops, the joining phone retries on its own (and at once when
  the phone comes back online), and the phones resync. If the phones haven't connected after
  20 seconds, the Sync sheet shows a hint about internet and TURN. If the scoring phone is gone
  (flat battery), the watcher can **Take over anyway**; if the old phone returns, it becomes
  the watcher.
- Both phones need internet (Wi-Fi or mobile data). The camera needs HTTPS, which GitHub
  Pages and Cloudflare Pages provide.

### Testing sync

1. One phone, local: `npm run dev -- --host`, open it in two browser windows (one private),
   create a room in one and join from the other.
2. Two real phones on the GitHub Pages link, one on Wi-Fi and one on mobile data.
3. Check a takeover in both modes, then turn on airplane mode on the watcher for a few
   seconds, score a ball, turn it off: the watcher resyncs on its own.

## Deploy

The build is a static folder (`dist/`). Its base path is `/GullyScore/` (the repo name, for
GitHub Pages); for a domain root such as Cloudflare Pages build with `VITE_BASE=/ npm run build`. The service worker and manifest are included.

### GitHub Pages (automatic, using the included workflow)

1. Create a GitHub repository and push this project to the `main` branch:
   ```bash
   git add -A && git commit -m "Gully Score"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. On GitHub open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` runs the tests, builds and publishes.
   Watch it under the **Actions** tab. The app goes live at
   `https://saravix1.github.io/GullyScore/`.
4. Every push to `main` redeploys. Open apps show a "New version ready" bar.

### Cloudflare Pages

1. Push the project to GitHub (or GitLab).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**,
   and pick the repository.
3. Build settings: Framework preset **None**, build command `npm run build`,
   build output directory `dist`. Under environment variables set
   `NODE_VERSION` to `22`.
4. Save and deploy. The app is served at `https://<project>.pages.dev`.

Or upload without Git: `npm run build`, then
`npx wrangler pages deploy dist --project-name gully-score`.

## Install on a phone

- **Android (Chrome):** open the site, tap **Install app** (or menu ⋮ → **Add to Home
  screen**).
- **iPhone (Safari):** open the site, tap **Share → Add to Home Screen**.

After the first load the app works with no internet. Installing it also helps the
browser keep its data. iPhones can still clear website data after weeks unused, so
use **Settings → Export backup** now and then; **Import backup** restores it.
# GullyScore
