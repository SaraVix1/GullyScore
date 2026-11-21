<script>
  // Bottom sheet modal. Closes on backdrop tap or Escape.
  let { title = '', onclose, children } = $props();

  function onkey(e) {
    if (e.key === 'Escape') onclose?.();
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
  <div class="head">
    <h2>{title}</h2>
    <button class="close" aria-label="Close" onclick={onclose}>✕</button>
  </div>
  <div class="body">
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    z-index: 40;
    animation: fade 0.15s ease;
  }

  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 41;
    max-height: 88dvh;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-top: 4px solid var(--accent);
    border-radius: var(--radius) var(--radius) 0 0;
    padding-bottom: env(safe-area-inset-bottom);
    animation: up 0.18s ease-out;
    max-width: 640px;
    margin: 0 auto;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px var(--gutter) 6px;
  }

  h2 {
    margin: 0;
    font-family: var(--display);
    font-stretch: condensed;
    font-size: 24px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    line-height: 1.1;
  }

  .close {
    width: 44px;
    height: 44px;
    border-radius: var(--radius);
    font-size: 18px;
    color: var(--muted);
    background: var(--surface-2);
  }

  .body {
    overflow-y: auto;
    padding: 8px var(--gutter) 20px;
  }

  @keyframes up {
    from {
      transform: translateY(40px);
      opacity: 0;
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
