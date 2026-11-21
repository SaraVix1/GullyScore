<script>
  import { getState, oversText } from '../lib/engine.js';
  import { listHistory, deleteHistory, clearHistory } from '../lib/db.js';
  import Badge from '../components/Badge.svelte';
  import Sheet from '../components/Sheet.svelte';

  let { onback, onopen } = $props();

  let rows = $state.raw(null);
  let confirm = $state(null); // { all: true } or { row }

  async function load() {
    const list = await listHistory();
    rows = list.map((r) => ({ ...r, st: getState(r.match) }));
  }
  load();

  async function doDelete() {
    if (confirm.all) await clearHistory();
    else await deleteHistory(confirm.row.id);
    confirm = null;
    await load();
  }

  // Matches grouped by series (same two teams, played in a row), newest first,
  // each with the running win count for the two teams.
  const groups = $derived.by(() => {
    const by = new Map();
    for (const r of rows || []) {
      const key = r.match.series || r.id;
      if (!by.has(key)) by.set(key, { key, rows: [], wins: [0, 0], ties: 0 });
      const g = by.get(key);
      g.rows.push(r);
      const w = r.st.result?.winner;
      if (w != null) g.wins[w]++;
      else if (r.st.result) g.ties++;
    }
    return [...by.values()];
  });

  const day = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const inn = (st, team) => st.innings.find((i) => !i.superOver && i.battingTeam === team);
</script>

<main class="history">
  <header class="top">
    <button class="back" onclick={onback}>‹ Back</button>
    <h1>History</h1>
    <span></span>
  </header>

  {#if rows === null}
    <p class="empty">Loading…</p>
  {:else if !rows.length}
    <p class="empty">No finished matches yet. They appear here as soon as a match ends.</p>
  {:else}
    {#each groups as g (g.key)}
    {@const latest = g.rows[0].match}
    {#if g.rows.length > 1}
      <div class="series num" aria-label="Series tally">
        <span class="slabel">Series · {g.rows.length} matches</span>
        <b>{latest.teams[0].name} {g.wins[0]}</b>
        <b>{latest.teams[1].name} {g.wins[1]}</b>
        {#if g.ties}<span class="slabel">{g.ties} tied</span>{/if}
      </div>
    {/if}
    <ul>
      {#each g.rows as row (row.id)}
        {@const m = row.match}
        <li>
          <button class="row" onclick={() => onopen(row)}>
            <span class="date">{day(row.date)}</span>
            {#each [0, 1] as t (t)}
              {@const i = inn(row.st, t)}
              <span class="team" class:won={row.st.result?.winner === t}>
                <Badge team={m.teams[t]} size={26} />
                <span class="name">{m.teams[t].name}</span>
                <span class="sc num">{i ? `${i.runs}/${i.wickets}` : '–'} <small>{i ? `(${oversText(i.balls)})` : ''}</small></span>
              </span>
            {/each}
            <span class="res">{row.st.result?.text}</span>
          </button>
          <button class="del" aria-label="Delete match" onclick={() => (confirm = { row })}>🗑</button>
        </li>
      {/each}
    </ul>
    {/each}
    <button class="btn ghost block big clear" onclick={() => (confirm = { all: true })}>Clear all history</button>
  {/if}
</main>

{#if confirm}
  <Sheet title={confirm.all ? 'Clear all history?' : 'Delete this match?'} onclose={() => (confirm = null)}>
    <p class="note">
      {confirm.all
        ? `All ${rows.length} saved matches and their edit logs will be removed from this phone.`
        : `${confirm.row.match.teams[0].name} vs ${confirm.row.match.teams[1].name} (${day(confirm.row.date)}) will be removed, with its edit log.`}
      This cannot be undone. Export a backup in Settings first if you want to keep a copy.
    </p>
    <div class="grid2">
      <button class="btn big" onclick={() => (confirm = null)}>Cancel</button>
      <button class="btn danger big" onclick={doDelete}>{confirm.all ? 'Clear all' : 'Delete'}</button>
    </div>
  </Sheet>
{/if}

<style>
  .series {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 14px;
    margin: 16px 0 6px;
    padding: 8px 12px;
    background: var(--surface-3);
    border-left: 6px solid var(--accent);
    color: var(--text);
  }

  .series b {
    font-family: var(--display);
    font-size: 20px;
    font-weight: 900;
  }

  .slabel {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .history {
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

  .empty {
    color: var(--muted);
    text-align: center;
    margin-top: 40px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }

  li {
    display: flex;
    gap: 6px;
  }

  .row {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 6px;
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--surface);
    text-align: left;
  }

  .date {
    font-size: 13px;
    color: var(--dim);
    font-weight: 600;
  }

  .team {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
  }

  .team.won {
    color: var(--text);
  }

  .name {
    flex: 1;
    min-width: 0;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sc {
    font-weight: 900;
    font-size: 18px;
  }

  .sc small {
    font-weight: 600;
    font-size: 13px;
    color: var(--dim);
  }

  .res {
    font-size: 14px;
    font-weight: 700;
    color: var(--accent-text);
  }

  .del {
    flex: none;
    width: 52px;
    border-radius: var(--radius);
    background: var(--surface);
    font-size: 20px;
  }

  .clear {
    margin-top: 18px;
    color: var(--red);
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
</style>
