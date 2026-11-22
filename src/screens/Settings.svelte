<script>
  import { exportAll, importAll } from '../lib/db.js';
  import { downloadBlob } from '../lib/share.js';
  import { PRESETS, getMode, setMode, getAccent, setAccent } from '../lib/theme.js';
  import { inkFor } from '../lib/teams.js';
  import { loadTurn, saveTurn, clearTurn, mask } from '../lib/room.js';
  import ShareList from '../components/ShareList.svelte';

  let { prefs = {}, onprefs, onback, onimported, canCreate = false, sharelist = [], oncreate, onjoin, onremove } = $props();

  // TURN key from the user's own Open Relay account, on this phone only.
  let turn = $state(loadTurn());
  let turnUser = $state('');
  let turnPass = $state('');
  function keepTurn() {
    saveTurn(turnUser.trim(), turnPass.trim());
    turn = loadTurn();
    turnUser = turnPass = '';
  }
  function dropTurn() {
    clearTurn();
    turn = null;
  }
  const takeover = $derived(prefs.takeover || 'ask');

  // Appearance is saved on this phone only and never synced.
  let mode = $state(getMode());
  let accent = $state(getAccent());
  const pickMode = (m) => setMode((mode = m));
  const pickAccent = (c) => setAccent((accent = c));

  let msg = $state('');
  let busy = $state(false);
  let persisted = $state(null);
  let fileInput;

  navigator.storage?.persisted?.().then((p) => (persisted = p)).catch(() => {});

  async function doExport() {
    busy = true;
    try {
      const data = await exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      downloadBlob(blob, `gully-score-backup-${new Date().toISOString().slice(0, 10)}.json`);
      msg = `Backup saved with ${data.history.length} finished ${data.history.length === 1 ? 'match' : 'matches'}${data.current ? ' and the current match' : ''}.`;
    } catch (e) {
      msg = 'Could not create the backup: ' + e.message;
    } finally {
      busy = false;
    }
  }

  async function doImport(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    busy = true;
    try {
      const res = await importAll(JSON.parse(await file.text()));
      msg = `Restored ${res.matches} ${res.matches === 1 ? 'match' : 'matches'} into history${res.restoredCurrent ? ' and the in-progress match' : ''}.`;
      onimported?.();
    } catch (err) {
      msg = err instanceof SyntaxError ? 'That file is not a valid backup.' : err.message;
    } finally {
      busy = false;
    }
  }
</script>

<main class="settings">
  <header class="top">
    <button class="back" onclick={onback}>‹ Back</button>
    <h1>Settings</h1>
    <span></span>
  </header>

  <section class="card">
    <div class="label">Theme</div>
    <div class="seg">
      {#each [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as [id, name] (id)}
        <button aria-pressed={mode === id} onclick={() => pickMode(id)}>{name}</button>
      {/each}
    </div>
    <p class="hint">{mode === 'system' ? "Follows your phone's light or dark setting." : 'Always ' + mode + ', whatever the phone uses.'}</p>
    <div class="label gap">Accent color</div>
    <div class="swatches" role="group" aria-label="Accent color">
      {#each PRESETS as c (c)}
        <button
          class="sw"
          style="background:{c}; color:{inkFor(c)}"
          aria-label="Accent {c}"
          aria-pressed={accent === c}
          onclick={() => pickAccent(c)}>{accent === c ? '✓' : ''}</button
        >
      {/each}
      <label class="sw custom" class:on={accent && !PRESETS.includes(accent)} style={accent && !PRESETS.includes(accent) ? `background:${accent}; color:${inkFor(accent)}` : ''}>
        <span aria-hidden="true">{accent && !PRESETS.includes(accent) ? '✓' : '+'}</span>
        <input type="color" aria-label="Custom accent color" value={accent || '#2dd4bf'} oninput={(e) => pickAccent(e.currentTarget.value)} />
      </label>
    </div>
    <button class="btn ghost block gap" disabled={!accent} onclick={() => pickAccent(null)}>Reset accent</button>
    <p class="hint">Saved on this phone only. Team colors and the wicket red don't change.</p>
  </section>

  <section class="card">
    <div class="label">Backup</div>
    <p>
      Everything is stored only on this phone. iPhones can clear website data after a few weeks unused, so export a
      backup now and then.
    </p>
    <div class="grid2">
      <button class="btn primary big" disabled={busy} onclick={doExport}>⬇ Export backup</button>
      <button class="btn big" disabled={busy} onclick={() => fileInput.click()}>⬆ Import backup</button>
    </div>
    <input bind:this={fileInput} type="file" accept="application/json,.json" hidden onchange={doImport} />
    {#if msg}<p class="msg" role="status">{msg}</p>{/if}
  </section>

  <section class="card">
    <div class="label">Sync</div>
    <p>Share the current series with another phone, live. Only the scorer enters balls; the other phone watches until it takes over.</p>
    <div class="grid2">
      <button class="btn primary big" disabled={!canCreate} onclick={oncreate}>Create room</button>
      <button class="btn big" onclick={onjoin}>Join room</button>
    </div>
    <p class="hint">
      {canCreate ? 'Create room shows a code and QR code for this series.' : 'Start a match first to create a room.'}
      Both phones need internet when they are on different networks.
    </p>

    <div class="label gap">Takeover mode</div>
    <p>When the other phone asks to take over scoring while this phone is the scorer:</p>
    <div class="seg">
      <button aria-pressed={takeover === 'ask'} onclick={() => onprefs({ ...prefs, takeover: 'ask' })}>Ask me first</button>
      <button aria-pressed={takeover === 'instant'} onclick={() => onprefs({ ...prefs, takeover: 'instant' })}>Instant</button>
    </div>
    <p class="hint">
      {takeover === 'ask'
        ? 'You see a message and control moves only after you accept.'
        : 'Control moves immediately and this phone switches to watch-only.'}
    </p>

    <div class="gap"><ShareList list={sharelist} {onremove} /></div>

    <div class="label gap">TURN key (optional)</div>
    {#if turn}
      <p class="mono">Username {mask(turn.username)}<br />Credential ••••••••</p>
      <button class="btn block" onclick={dropTurn}>Clear key</button>
    {:else}
      <p>
        Helps phones on strict mobile networks connect. Sign up free at Open Relay (metered.ca), create a TURN app, and
        copy its username and credential here.
      </p>
      <input class="field" autocomplete="off" spellcheck="false" placeholder="Username" bind:value={turnUser} />
      <input class="field" type="password" autocomplete="off" placeholder="Credential" bind:value={turnPass} />
      <button class="btn block gap" disabled={!turnUser.trim() || !turnPass.trim()} onclick={keepTurn}>Save key</button>
    {/if}
    <p class="hint">Saved on this phone only. It is never synced, backed up or sent anywhere except to the TURN server.</p>
  </section>

  <section class="card">
    <div class="label">Storage</div>
    <p>
      {persisted === true
        ? 'Protected: the browser has agreed not to clear Gully Score data on its own.'
        : persisted === false
          ? 'Not protected yet. Installing the app to your home screen usually fixes this.'
          : 'Checking…'}
    </p>
  </section>

  <section class="card">
    <div class="label">Handing over scoring</div>
    <p>
      Every ball is saved the moment it is entered. To let someone else score on this phone, just pass it over; if the
      app was closed, they open it and tap Resume match.
    </p>
    <p>
      To score from a different phone, use <b>Create room</b> above (or <b>Share live</b> in the match menu) and
      <b>Join room</b> on the other phone. The watching phone can take over with one tap.
    </p>
  </section>
</main>

<style>
  .settings {
    max-width: 560px;
    margin: 0 auto;
    padding: calc(env(safe-area-inset-top) + 12px) var(--gutter) calc(env(safe-area-inset-bottom) + 24px);
  }

  .top {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    margin-bottom: 14px;
  }

  .back {
    justify-self: start;
    min-height: 44px;
    font-size: 18px;
    font-weight: 800;
    color: var(--accent-text);
  }

  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 900;
  }

  .card {
    background: var(--surface);
    border-radius: var(--radius);
    padding: 16px;
    margin-bottom: 12px;
  }

  .card p {
    margin: 8px 0 14px;
    color: var(--muted);
  }

  .card p:last-child {
    margin-bottom: 0;
  }

  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .grid2 .btn {
    padding: 0 8px;
  }

  .gap {
    margin-top: 16px;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 10px;
  }

  .sw {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 900;
    box-shadow: 0 0 0 2px var(--line);
  }

  .sw[aria-pressed='true'],
  .sw.on {
    box-shadow: 0 0 0 3px var(--bg), 0 0 0 6px var(--text);
  }

  .sw.custom {
    background: var(--surface-3);
    color: var(--text);
    cursor: pointer;
  }

  .sw input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .hint {
    margin: 10px 0 0 !important;
    font-size: 14px;
  }

  .field {
    width: 100%;
    min-height: 48px;
    margin-top: 8px;
    padding: 0 12px;
    border-radius: var(--radius);
    border: 2px solid var(--line);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
  }

  .mono {
    font-variant-numeric: tabular-nums;
    letter-spacing: 1px;
  }

  .msg {
    color: var(--accent-text) !important;
    font-weight: 700;
    margin-top: 12px !important;
  }
</style>
