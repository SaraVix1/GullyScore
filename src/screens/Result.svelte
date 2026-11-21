<script>
  import { oversText } from '../lib/engine.js';
  import { inkFor } from '../lib/teams.js';
  import Scorecard from '../components/Scorecard.svelte';
  import ShareSheet from '../components/ShareSheet.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Badge from '../components/Badge.svelte';
  import EditLog from '../components/EditLog.svelte';

  // mode 'live': the match just finished. mode 'history': a saved past match.
  let { match, st, mode = 'live', oncontinue, onnew, onundo, onsuperover, onback, ondelete, onleave, onlive, live = null } = $props();

  const r = $derived(st.result);
  const winner = $derived(r.winner != null ? match.teams[r.winner] : null);
  const color = $derived(winner ? winner.color : '#FFB627');
  let sheet = $state(null);
  let toast = $state('');

  function flash(msg) {
    toast = msg;
    setTimeout(() => (toast = ''), 2600);
  }
</script>

<main class="result">
  {#if mode === 'history'}
    <header class="top">
      <button class="back" onclick={onback}>‹ History</button>
      <span class="date">{new Date(match.created).toLocaleString()}</span>
    </header>
  {/if}

  <section class="hero" style="background:{color}; color:{inkFor(color)}">
    <div class="label">
      {r.by === 'tie' ? 'Result' : r.superOver ? 'Super Over winner' : 'Winner'}
    </div>
    <h1>{#if winner}<span class="wicon"><Badge team={winner} size={44} /></span>{/if}{r.text}</h1>
    {#if r.superOver && st.mainResult}<p>{st.mainResult.text} on {st.innings[0].runs}</p>{:else if r.detail}<p>{r.detail}</p>{/if}
    <div class="lines num">
      {#each st.innings as inn (inn.index)}
        <div class="line" class:won={r.winner === inn.battingTeam}>
          <span><Badge team={match.teams[inn.battingTeam]} size={24} inline />{match.teams[inn.battingTeam].name}{inn.superOver ? ' · SO' : ''}</span>
          <b>{inn.runs}/{inn.wickets}</b>
          <small>({oversText(inn.balls)})</small>
        </div>
      {/each}
    </div>
  </section>

  {#if mode === 'live' && st.canSuperOver}
    <section class="tie">
      <p><b>It's a tie!</b> Settle it with a Super Over: one over per team, two wickets each.</p>
      <button class="btn primary block big" onclick={onsuperover}>Play Super Over</button>
    </section>
  {/if}

  <button class="btn block share" onclick={() => (sheet = 'share')}>↗ Share scorecard</button>
  <button class="btn block share" onclick={() => (sheet = 'editlog')}>✎ Edit log ({match.log?.length || 0})</button>

  {#each st.innings as inn (inn.index)}
    <Scorecard {match} {inn} />
  {/each}

  {#if mode === 'live'}
    <button class="link" onclick={onundo}>↶ Undo last ball and keep scoring</button>
    <div class="actions">
      <button class="btn primary big" onclick={oncontinue}>Continue with same teams</button>
      <button class="btn big" onclick={onnew}>New match</button>
    </div>
  {:else if mode === 'watch'}
    <section class="watching">
      <p>👀 Watching live. When the scorer starts the next match it appears here.</p>
      <div class="grid2">
        <button class="btn big" onclick={onlive}>{live?.connected ? 'Live status' : 'Reconnect'}</button>
        <button class="btn ghost big" onclick={onleave}>Stop watching</button>
      </div>
    </section>
  {:else}
    <button class="btn ghost block big del" onclick={() => (sheet = 'delete')}>Delete this match</button>
  {/if}
</main>

{#if sheet === 'share'}
  <ShareSheet {match} {st} onclose={() => (sheet = null)} onflash={flash} />
{:else if sheet === 'editlog'}
  <EditLog {match} onclose={() => (sheet = null)} />
{:else if sheet === 'delete'}
  <Sheet title="Delete this match?" onclose={() => (sheet = null)}>
    <p class="note">
      <Badge team={match.teams[0]} size={22} />
      {match.teams[0].name} vs {match.teams[1].name} will be removed from history. This cannot be undone.
    </p>
    <div class="grid2">
      <button class="btn big" onclick={() => (sheet = null)}>Keep it</button>
      <button class="btn danger big" onclick={ondelete}>Delete</button>
    </div>
  </Sheet>
{/if}

{#if toast}<div class="toast" role="status">{toast}</div>{/if}

<style>
  .result {
    max-width: 560px;
    margin: 0 auto;
    padding: calc(env(safe-area-inset-top) + 16px) var(--gutter) 0;
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .back {
    min-height: 44px;
    font-size: 18px;
    font-weight: 800;
    color: var(--accent-text);
  }

  .date {
    color: var(--muted);
    font-size: 14px;
  }

  .hero {
    padding: 20px 18px;
    border-radius: var(--radius);
    margin-bottom: 12px;
  }

  .hero .label {
    color: inherit;
    opacity: 0.75;
  }

  h1 {
    margin: 6px 0 2px;
    font-size: clamp(28px, 8vw, 38px);
    font-weight: 900;
    line-height: 1.08;
    letter-spacing: -0.02em;
  }

  .wicon {
    display: inline-block;
    margin-right: 10px;
    vertical-align: -0.2em;
  }

  .hero p {
    margin: 0;
    font-weight: 700;
  }

  .lines {
    margin-top: 14px;
    display: grid;
    gap: 4px;
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 17px;
    opacity: 0.75;
  }

  .line.won {
    opacity: 1;
  }

  .line span {
    flex: 1;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .line b {
    font-family: var(--display);
    font-stretch: condensed;
    font-size: 28px;
    font-weight: 900;
  }

  .tie {
    padding: 16px;
    border-radius: var(--radius);
    border: 2px solid var(--amber);
    margin-bottom: 12px;
  }

  .tie p {
    margin: 0 0 12px;
  }

  .share {
    margin-bottom: 14px;
  }

  .link {
    display: block;
    width: 100%;
    min-height: 48px;
    color: var(--muted);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .actions {
    position: sticky;
    bottom: 0;
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 8px;
    padding: 12px 0 calc(env(safe-area-inset-bottom) + 14px);
    background: linear-gradient(to bottom, transparent, var(--bg) 25%);
  }

  .actions .btn {
    font-size: 17px;
    padding: 0 10px;
  }

  .watching {
    padding: 4px 0 calc(env(safe-area-inset-bottom) + 24px);
  }

  .watching p {
    color: var(--muted);
  }

  .del {
    margin: 4px 0 calc(env(safe-area-inset-bottom) + 24px);
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
