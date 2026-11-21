<script>
  import { badgeFor } from '../lib/teams.js';

  // A team's emoji in a round, contrasting badge. The same badge is used
  // everywhere an icon appears. `inline` sizes it to sit inside a line of text.
  let { team, size = 36, inline = false } = $props();
  const b = $derived(badgeFor(team.color));
</script>

<span
  class="badge"
  class:inline
  style="--s:{size}px; --bb:{b.bg}; --br:{b.ring}; --tc:{team.color}"
  aria-hidden="true"><span class="e">{team.icon}</span></span
>

<style>
  .badge {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--s);
    height: var(--s);
    border-radius: 50%;
    background: var(--bb);
    border: max(1.5px, calc(var(--s) * 0.06)) solid var(--br);
    line-height: 1;
  }

  .badge.inline {
    vertical-align: -0.28em;
    margin: 0 0.12em;
  }

  .e {
    font-size: calc(var(--s) * 0.56);
    /* A thin dark outline keeps pale emoji (clouds, wolves) visible on white. */
    filter: drop-shadow(0 0 0.6px rgba(0, 0, 0, 0.9)) drop-shadow(0 0 0.6px rgba(0, 0, 0, 0.5));
  }
</style>
