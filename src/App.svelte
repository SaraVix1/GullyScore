<script>
  import { createMatch, getState, startSuperOver } from './lib/engine.js';
  import { undoLogged, note } from './lib/editlog.js';
  import {
    loadCurrent,
    saveMatch,
    clearCurrent,
    loadPrefs,
    savePrefs,
    deleteHistory,
    saveToHistory,
    listSeries,
    deviceId,
    migrateLocalStorage,
    requestPersistence,
    loadNextSetup,
    saveNextSetup,
    clearNextSetup,
  } from './lib/db.js';
  import Setup from './screens/Setup.svelte';
  import Scoring from './screens/Scoring.svelte';
  import Result from './screens/Result.svelte';
  import History from './screens/History.svelte';
  import Settings from './screens/Settings.svelte';
  import Sheet from './components/Sheet.svelte';

  // Match objects are replaced, never mutated, so raw state is enough.
  let ready = $state(false);
  let match = $state.raw(null);
  let saved = $state.raw(null);
  let prefs = $state.raw({});
  let seed = $state.raw({});
  let setupKey = $state(0);
  let page = $state(null); // 'history' | 'settings' | { record } while browsing
  let saveError = $state('');
  let toast = $state('');
  let toastTimer;

  // Live sharing (loaded on first use)
  let live = $state.raw(null);
  let snap = $state.raw(null);
  let LiveSheet = $state.raw(null);
  let liveSheet = $state(null); // { start } while the pairing sheet is open
  let lastRole = null;

  const viewing = $derived(!!snap && snap.role === 'viewer' && snap.phase !== 'idle');
  const st = $derived(match ? getState(match) : null);
  const screen = $derived(
    page === 'history' || page === 'settings'
      ? page
      : page?.record
        ? 'record'
        : viewing && !match
          ? 'waiting'
          : !match
            ? 'setup'
            : st.result
              ? 'result'
              : 'scoring',
  );

  $effect(() => {
    screen;
    window.scrollTo(0, 0);
  });

  function flash(msg) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 2800);
  }

  async function boot() {
    let next = null;
    try {
      await migrateLocalStorage();
      [saved, prefs, next] = await Promise.all([loadCurrent(), loadPrefs(), loadNextSetup()]);
    } catch {
      saveError = 'Storage is not available, so matches will not be saved. Private browsing can cause this.';
    }
    seed = next || prefs;
    // Reloaded to apply an app update: go straight back to the match.
    try {
      if (sessionStorage.getItem('gully-resume') && saved) resume();
      sessionStorage.removeItem('gully-resume');
    } catch {
      /* ignore */
    }
    ready = true;
    requestPersistence();
  }
  boot();

  function update(m) {
    if (viewing) return; // watch-only
    match = m;
    if (m) {
      saveMatch(m).then(
        () => (saveError = ''),
        () => (saveError = 'Could not save the last ball. Check that the phone has free space.'),
      );
    }
    if (live && snap?.role === 'scorer') live.sync.setMatch(m);
  }

  function start(cfg) {
    prefs = { ...prefs, players: cfg.players, overs: cfg.overs, rules: cfg.rules };
    savePrefs(prefs);
    clearNextSetup().catch(() => {});
    saved = null;
    update(createMatch(cfg));
  }

  function resume() {
    match = saved;
    saved = null;
  }

  function discard() {
    clearCurrent();
    saved = null;
  }

  // `nextSeed.teams` set: continue with the same teams (kept across restarts).
  // Otherwise a new match with fresh random teams.
  function toSetup(nextSeed) {
    clearCurrent();
    (nextSeed.teams ? saveNextSetup(nextSeed) : clearNextSetup()).catch(() => {});
    saved = null;
    seed = nextSeed;
    match = null;
    setupKey++;
    if (live && snap?.role === 'scorer') live.sync.setMatch(null);
  }

  function continueSame() {
    const { players, overs, rules, teams, names, series } = match;
    toSetup({ players, overs, rules, series, teams: teams.map((t, i) => ({ ...t, players: [...names[i]] })) });
  }

  async function reloadSaved() {
    if (!match) saved = await loadCurrent();
  }

  async function deleteRecord(id) {
    await deleteHistory(id);
    page = 'history';
    reloadSaved();
  }

  function savePrefsNow(p) {
    prefs = p;
    savePrefs(p);
  }

  // ---------- live sharing ----------

  function onLive(l) {
    if (l !== live) return; // a session the user already left
    const next = l.snapshot;
    const s = l.sync.state;
    const was = lastRole;
    lastRole = next.role;
    snap = next;
    if (next.role === 'viewer') {
      match = s.match;
      if (s.match) saveToHistory(s.match);
      // The other phone owns the match now; don't offer it for resume here.
      if (was === 'scorer') clearCurrent();
    } else if (was === 'viewer') {
      match = s.match;
      if (match) {
        // The takeover goes in the edit log, so nobody can say the scorer changed quietly.
        match = note(match, 'Scoring taken over on this phone');
        l.sync.setMatch(match);
        saveMatch(match);
      }
    }
    if (next.note) flash(next.note);
  }

  async function openLive(start) {
    try {
      if (!live) {
        const [{ createLive }, sheet, id] = await Promise.all([
          import('./lib/live.js'),
          import('./components/LiveSheet.svelte'),
          deviceId(),
        ]);
        LiveSheet = sheet.default;
        live = createLive({
          deviceId: id,
          mode: () => prefs.takeover || 'ask',
          onChange: onLive,
          store: { list: listSeries, add: saveToHistory },
        });
        snap = live.snapshot;
      }
      // The phone that shares a match it is scoring starts as the scorer.
      if (match && !live.sync.state.scorer) live.sync.host(match);
      liveSheet = { start };
    } catch {
      flash('Live sharing is not supported on this browser');
    }
  }

  function leaveLive() {
    const wasViewer = viewing;
    const old = live;
    live = null;
    old?.leave();
    snap = null;
    lastRole = null;
    liveSheet = null;
    if (wasViewer) match = null;
  }

  function takeOver() {
    try {
      live.sync.requestTakeover();
    } catch (e) {
      flash(e.message);
    }
  }

  function forceTakeOver() {
    try {
      live.sync.forceTakeover();
    } catch (e) {
      flash(e.message);
    }
  }

  const liveProps = $derived({
    live: snap && snap.phase !== 'idle' ? snap : null,
    onlive: () => openLive(viewing ? 'scan' : 'choose'),
    ontakeover: takeOver,
    onforce: forceTakeOver,
    onleave: leaveLive,
  });
</script>

{#if saveError}
  <div class="banner" role="alert">{saveError}</div>
{/if}

{#if !ready}
  <div class="boot" aria-busy="true"></div>
{:else if screen === 'history'}
  <History onback={() => ((page = null), reloadSaved())} onopen={(record) => (page = { record })} />
{:else if screen === 'record'}
  <Result
    match={page.record.match}
    st={getState(page.record.match)}
    mode="history"
    onback={() => (page = 'history')}
    ondelete={() => deleteRecord(page.record.id)}
  />
{:else if screen === 'settings'}
  <Settings {prefs} onprefs={savePrefsNow} onback={() => (page = null)} onimported={reloadSaved} />
{:else if screen === 'waiting'}
  <main class="waiting">
    <div class="big">👀</div>
    <h1>Watching live</h1>
    <p>
      {snap.connected
        ? 'Connected. Waiting for the scorer to start a match…'
        : 'Not connected to the other phone.'}
    </p>
    {#if !snap.connected}
      <button class="btn primary block big" onclick={() => openLive('scan')}>Reconnect</button>
    {/if}
    <button class="btn ghost block big" onclick={leaveLive}>Stop watching</button>
  </main>
{:else if screen === 'setup'}
  {#key setupKey}
    <Setup
      {seed}
      {saved}
      onstart={start}
      onresume={resume}
      ondiscard={discard}
      onhistory={() => (page = 'history')}
      onsettings={() => (page = 'settings')}
      onjoin={() => openLive('scan')}
    />
  {/key}
{:else if screen === 'result'}
  <Result
    {match}
    {st}
    mode={viewing ? 'watch' : 'live'}
    oncontinue={continueSame}
    onnew={() => toSetup(prefs)}
    onundo={() => update(undoLogged(match))}
    onsuperover={() => update(startSuperOver(match))}
    {...liveProps}
  />
{:else}
  <Scoring {match} {st} viewer={viewing} onchange={update} onabandon={() => toSetup(prefs)} {...liveProps} />
{/if}

{#if liveSheet && LiveSheet && snap}
  <LiveSheet
    {live}
    {snap}
    start={liveSheet.start}
    takeover={prefs.takeover || 'ask'}
    ontakeovermode={(t) => savePrefsNow({ ...prefs, takeover: t })}
    onclose={() => (liveSheet = null)}
    onleave={leaveLive}
  />
{/if}

{#if snap?.request}
  <Sheet title="Hand over scoring?" onclose={() => live.sync.respond(false)}>
    <p class="note">The other phone wants to take over scoring. This phone will switch to watch-only.</p>
    <div class="grid2">
      <button class="btn big" onclick={() => live.sync.respond(false)}>Keep scoring</button>
      <button class="btn primary big" onclick={() => live.sync.respond(true)}>Let them score</button>
    </div>
  </Sheet>
{/if}

{#if toast}<div class="toast" role="status">{toast}</div>{/if}

<style>
  .banner {
    position: sticky;
    top: 0;
    z-index: 70;
    padding: calc(env(safe-area-inset-top) + 8px) 16px 8px;
    background: var(--red);
    color: var(--red-ink);
    font-weight: 700;
    text-align: center;
  }

  .boot {
    min-height: 100dvh;
  }

  .waiting {
    max-width: 480px;
    margin: 0 auto;
    padding: calc(env(safe-area-inset-top) + 80px) var(--gutter) 24px;
    text-align: center;
    display: grid;
    gap: 10px;
  }

  .waiting .big {
    font-size: 64px;
  }

  .waiting h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 900;
  }

  .waiting p {
    color: var(--muted);
    margin: 0 0 12px;
  }

  .note {
    margin: 0 0 14px;
    color: var(--muted);
  }

  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .toast {
    position: fixed;
    left: 50%;
    top: calc(env(safe-area-inset-top) + 16px);
    transform: translateX(-50%);
    z-index: 90;
    max-width: calc(100% - 32px);
    padding: 12px 18px;
    border-radius: 2px;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 800;
    pointer-events: none;
  }
</style>
