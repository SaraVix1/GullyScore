<script>
  // Phones allowed to join this series' room. Removing one cuts it off at once.
  let { list = [], onremove } = $props();
</script>

<div class="label">Share list</div>
{#if list.length}
  <ul>
    {#each list as p (p.id)}
      <li>
        <span>📱 {p.name}</span>
        <button class="btn" onclick={() => onremove?.(p.id)}>Remove</button>
      </li>
    {/each}
  </ul>
{/if}
<p class="hint">
  {list.length ? 'Only these phones can join this series.' : 'Nobody yet.'} A new phone asks you first, and you add it by
  tapping Let in.
</p>

<style>
  ul {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--line);
  }

  li span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
  }

  li .btn {
    flex: none;
    min-height: 40px;
    padding: 0 14px;
  }

  .hint {
    margin: 8px 0 0;
    font-size: 14px;
    color: var(--muted);
  }
</style>
