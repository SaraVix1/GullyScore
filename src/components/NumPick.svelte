<script>
  // A run count: quick buttons for the usual values plus a number pad for
  // anything else, so a ball worth 9 or 13 takes two taps.
  let { label, value, max = 20, min = 0, quick = [0, 1, 2, 3, 4], onpick } = $props();

  let pad = $state(false);
  let entry = $state('');

  function open() {
    entry = '';
    pad = !pad;
  }

  function press(d) {
    const next = entry === '0' ? String(d) : entry + d;
    if (Number(next) > max) return;
    entry = next;
    onpick(Number(entry));
  }

  function back() {
    entry = entry.slice(0, -1);
    onpick(Math.max(min, Number(entry) || 0));
  }

  const choices = $derived(quick.filter((q) => q >= min && q <= max));
  const custom = $derived(!choices.includes(value));
</script>

<div class="np">
  <div class="head">
    <span class="label">{label}</span>
    <b class="val num">{value}</b>
  </div>
  <div class="row">
    {#each choices as q (q)}
      <button
        class="q num"
        aria-pressed={value === q && !pad}
        onclick={() => {
          pad = false;
          onpick(q);
        }}>{q}</button
      >
    {/each}
    <button class="q more" aria-pressed={pad || custom} aria-expanded={pad} onclick={open}>
      {custom && !pad ? value : '…'}
    </button>
  </div>
  {#if pad}
    <div class="pad" role="group" aria-label="{label}: type a number up to {max}">
      {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as d (d)}
        <button class="d num" onclick={() => press(d)}>{d}</button>
      {/each}
      <button class="d fn" aria-label="Delete" onclick={back}>⌫</button>
      <button class="d num" onclick={() => press(0)}>0</button>
      <button class="d fn" onclick={() => (pad = false)}>OK</button>
    </div>
    <p class="hint">Up to {max}</p>
  {/if}
</div>

<style>
  .np + :global(.np) {
    margin-top: 14px;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .val {
    font-family: var(--display);
    font-stretch: condensed;
    font-size: 30px;
    font-weight: 900;
    line-height: 1;
    color: var(--accent-text);
  }

  .row {
    display: flex;
    gap: 6px;
  }

  .q {
    flex: 1;
    min-width: 0;
    height: 52px;
    border-radius: var(--radius);
    background: var(--surface-3);
    font-family: var(--display);
    font-stretch: condensed;
    font-size: 24px;
    font-weight: 900;
  }

  .q[aria-pressed='true'] {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .pad {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin-top: 8px;
  }

  .d {
    height: 50px;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-family: var(--display);
    font-stretch: condensed;
    font-size: 24px;
    font-weight: 800;
  }

  .d:active {
    filter: brightness(1.3);
  }

  .d.fn {
    font-size: 18px;
    color: var(--muted);
  }

  .hint {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--dim);
    text-align: center;
  }
</style>
