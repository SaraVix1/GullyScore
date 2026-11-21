<script>
  import Sheet from './Sheet.svelte';
  import { verifyLog } from '../lib/editlog.js';

  // Read-only list of every edit made to a match, newest first. There is no
  // way to change or delete an entry from here: the log only goes away
  // together with its match.
  let { match, onclose } = $props();
  const log = $derived(match.log || []);
  const ok = $derived(verifyLog(log));
  const rows = $derived([...log].reverse());
  const when = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
</script>

<Sheet title="Edit log" {onclose}>
  <p class="seal" class:bad={!ok} role="status">
    {#if !log.length}No edits: the score is exactly as entered.{:else if ok}{log.length} {log.length === 1 ? 'edit' : 'edits'} · log is intact.{:else}Warning: this log has been altered.{/if}
  </p>
  <ol>
    {#each rows as e (e.n)}
      <li>
        <div class="meta num"><b>#{e.n}</b> <span>{when(e.at)}</span> <span>at {e.ov} ov</span></div>
        <div class="what">{e.what}</div>
        <div class="score num">{e.from} <span aria-label="changed to">→</span> {e.to}</div>
      </li>
    {/each}
  </ol>
</Sheet>

<style>
  .seal {
    margin: 0 0 12px;
    padding: 8px 12px;
    border-left: 5px solid var(--accent);
    background: var(--surface-2);
    color: var(--text);
    font-weight: 700;
  }

  .seal.bad {
    border-left-color: var(--red);
    background: var(--red);
    color: var(--red-ink);
  }

  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }

  li {
    padding: 10px 12px;
    background: var(--surface-2);
    border-left: 5px solid var(--line);
  }

  .meta {
    display: flex;
    gap: 10px;
    font-size: 13px;
    color: var(--muted);
  }

  .what {
    margin: 2px 0;
    font-weight: 700;
  }

  .score {
    font-family: var(--display);
    font-size: 20px;
    font-weight: 800;
    color: var(--text);
  }
</style>
