<script>
  import Sheet from './Sheet.svelte';
  import { scorecardText, scorecardImage, shareText, shareImage } from '../lib/share.js';

  let { match, st, onclose, onflash } = $props();
  let busy = $state(false);
  let image = $state.raw(null);
  let withLog = $state(false);

  // Draw the image up front: navigator.share must be called straight from the
  // tap, and some browsers (Safari) refuse it after a slow await.
  $effect(() => {
    image = null;
    scorecardImage(match, st, { log: withLog }).then((b) => (image = b));
  });

  const MESSAGES = {
    shared: 'Shared',
    copied: 'Scorecard copied. Paste it into WhatsApp.',
    downloaded: 'Image saved to downloads',
  };

  async function go(kind) {
    busy = true;
    try {
      const text = scorecardText(match, st, { log: withLog });
      const res =
        kind === 'image' ? await shareImage(image, text.split('\n').slice(0, 4).join('\n')) : await shareText(text);
      if (MESSAGES[res]) onflash?.(MESSAGES[res]);
      onclose();
    } catch {
      onflash?.('Could not share on this device');
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title="Share scorecard" {onclose}>
  <div class="stack">
    <button class="btn primary block big" disabled={busy} onclick={() => go('text')}>💬 Share as text</button>
    <button class="btn block big" disabled={busy || !image} onclick={() => go('image')}>🖼️ Share as image</button>
  </div>
  <label class="check">
    <input type="checkbox" bind:checked={withLog} />
    <span>Include the edit log ({match.log?.length || 0} {(match.log?.length || 0) === 1 ? 'edit' : 'edits'}) at the bottom</span>
  </label>
  <p class="note">Opens your phone's share menu (WhatsApp and others). If sharing is not available, text is copied and images are saved.</p>
</Sheet>

<style>
  .stack {
    display: grid;
    gap: 8px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    margin-top: 12px;
    color: var(--text);
    font-weight: 600;
  }

  .check input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }

  .note {
    margin: 14px 0 0;
    font-size: 14px;
    color: var(--muted);
  }
</style>
