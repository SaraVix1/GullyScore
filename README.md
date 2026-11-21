# Gully Score

Ball-by-ball cricket scoring for street and local matches. A tiny, offline-first
Progressive Web App built with Svelte 5 + Vite. No backend: everything is stored on
the phone in IndexedDB.

- ~43 KB JS + 5 KB CSS (gzipped), no runtime dependencies beyond Svelte
- Works fully offline after the first visit, installable on Android and iPhone
- Teams with emoji + colour identities, local rule toggles, free hits, retirements,
  penalty runs, mid-over bowler changes, Super Over, share as text or image,
  match history, JSON backup/restore
- Live sharing between two phones over WebRTC, paired by scanning QR codes, with
  safe handover of the scorer role. Loaded only when used (~28 KB, 12 KB gzipped)

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
src/lib/signal.js       Packs WebRTC offers/answers into short QR-friendly codes
src/lib/sync.js         Live sync rules: one scorer, takeover, resync (unit-tested)
src/lib/live.js         WebRTC data channel wiring for live sharing
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

## Live sharing (two phones)

1. On the scoring phone: match menu **⋯ → Share live → Show my code first**.
2. On the other phone: **Join live** on the start screen, and scan the code.
3. The second phone now shows a **reply code**: tap **Next: scan their reply** on the
   first phone and scan it. Both phones show **Live**.

The watching phone sees every ball as it happens and can tap **Take over scoring**.
In **Settings** (or the live sharing sheet) the scorer picks the takeover mode:
**Ask me first** (control moves only after the scorer accepts) or **Instant**.
Whoever takes control becomes the only scorer; the other phone turns watch-only.

How it works and what to expect:

- No server stores or relays the match. A free public STUN server
  (`stun.l.google.com`, `stun.cloudflare.com`) only tells each phone its own
  public address; the phones then talk directly over an encrypted data channel.
- Without a signalling server, the phones swap connection details by QR code both
  ways. The codes pack only the needed fields (about 150 characters). If a camera
  can't scan, **Copy code** / **Paste the code** works over any messaging app.
- Scorer authority is a counter that rises on every handover, so a phone can never
  score while another holds the role: the old scorer steps down before the new one
  is promoted.
- Short blips recover on their own and the phones resync. If the link drops fully,
  tap **Reconnect** and scan codes again; the phones resync automatically. If the
  scoring phone is gone (flat battery), the watcher can **Take over anyway**; if the
  old phone returns, it becomes the watcher and any balls it scored offline are
  dropped in favour of the new scorer's.
- Direct connections work best when both phones share a Wi-Fi network or one
  phone's hotspot. Two phones on different mobile networks may fail to connect,
  because there is no relay (TURN) server.
- The camera needs HTTPS, which GitHub Pages and Cloudflare Pages provide.

## Deploy

The build is a static folder (`dist/`) with relative paths, so it works at a domain
root or under a sub-path. The service worker and manifest are included.

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
   `https://<you>.github.io/<repo>/`.
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
