<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import QrCode from './QrCode.svelte';
  import Scanner from './Scanner.svelte';

  // start: 'show' (this phone goes first) | 'scan' (this phone scans first)
  let { live, snap, start = 'choose', takeover = 'ask', ontakeovermode, onclose, onleave } = $props();

  let step = $state(untrack(() => (snap.connected ? 'status' : start)));
  let code = $state('');
  let error = $state('');
  let copied = $state(false);

  $effect(() => {
    if (step === 'show' && !code) live.showCode().then((c) => (code = c), fail);
  });

  // Close-to-done once the channel opens.
  $effect(() => {
    if (snap.connected && step !== 'status' && step !== 'done') step = 'done';
  });

  function fail(e) {
    error = e?.message || 'Something went wrong';
    code = '';
    step = 'error';
  }

  async function gotReply(text) {
    try {
      step = 'connecting';
      await live.acceptReply(text);
    } catch (e) {
      fail(e);
    }
  }

  async function gotFirst(text) {
    try {
      step = 'preparing';
      code = await live.replyTo(text);
      step = 'reply';
    } catch (e) {
      fail(e);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch {
      copied = false;
    }
  }

  const restart = () => {
    code = '';
    error = '';
    step = 'choose';
  };
</script>

<Sheet title="Live sharing" {onclose}>
  {#if step === 'choose'}
    <p class="note">
      Connect two phones directly. Nothing goes through a server. One phone shows a code and the other scans it; then
      they swap and scan back once.
    </p>
    <div class="stack">
      <button class="btn primary block big" onclick={() => (step = 'show')}>📷 Show my code first</button>
      <button class="btn block big" onclick={() => (step = 'scan')}>🔍 Scan the other phone's code</button>
    </div>
  {:else if step === 'show'}
    <p class="step"><b>1.</b> On the other phone open Gully Score, tap <b>Join live match</b>, and scan this code.</p>
    {#if code}
      <QrCode text={code} />
      <div class="row">
        <button class="link" onclick={copy}>{copied ? 'Code copied' : 'Copy code instead'}</button>
      </div>
      <p class="step"><b>2.</b> The other phone then shows a reply code.</p>
      <button class="btn primary block big" onclick={() => (step = 'scanReply')}>Next: scan their reply</button>
    {:else}
      <p class="wait">Preparing code…</p>
    {/if}
  {:else if step === 'scanReply'}
    <p class="step">Scan the <b>reply code</b> on the other phone.</p>
    <Scanner onresult={gotReply} />
  {:else if step === 'scan'}
    <p class="step">Scan the code shown on the other phone.</p>
    <Scanner onresult={gotFirst} />
  {:else if step === 'preparing'}
    <p class="wait">Preparing reply…</p>
  {:else if step === 'reply'}
    <p class="step">Now let the other phone scan this <b>reply code</b>.</p>
    <QrCode text={code} />
    <div class="row">
      <button class="link" onclick={copy}>{copied ? 'Code copied' : 'Copy code instead'}</button>
    </div>
    <p class="wait">Waiting for the other phone…</p>
  {:else if step === 'connecting'}
    <p class="wait">Connecting…</p>
    <p class="note">If this takes more than a few seconds, the phones may be on networks that block direct connections. Put both phones on the same Wi-Fi or one phone's hotspot and try again.</p>
    <button class="btn block" onclick={restart}>Start again</button>
  {:else if step === 'error'}
    <p class="err">{error}</p>
    <button class="btn primary block big" onclick={restart}>Start again</button>
  {:else}
    <div class="ok">
      <span class="tick">✓</span>
      <div>
        <b>{snap.connected ? 'Connected' : 'Not connected'}</b>
        <p>
          {snap.role === 'scorer'
            ? 'This phone is scoring. The other phone sees every ball live.'
            : 'This phone is watching. Tap Take over scoring to swap.'}
        </p>
      </div>
    </div>
    {#if snap.role === 'scorer'}
      <div class="label">If the other phone asks to take over</div>
      <div class="seg">
        <button aria-pressed={takeover === 'ask'} onclick={() => ontakeovermode?.('ask')}>Ask me first</button>
        <button aria-pressed={takeover === 'instant'} onclick={() => ontakeovermode?.('instant')}>Instant</button>
      </div>
      <div class="gap"></div>
    {/if}
    {#if !snap.connected}
      <button class="btn primary block big" onclick={restart}>Reconnect</button>
    {:else}
      <button class="btn primary block big" onclick={onclose}>Done</button>
    {/if}
    <button class="btn ghost block gap" onclick={onleave}>Stop live sharing</button>
  {/if}
</Sheet>

<style>
  .stack {
    display: grid;
    gap: 8px;
  }

  .note {
    margin: 0 0 14px;
    color: var(--muted);
  }

  .step {
    margin: 0 0 12px;
  }

  .wait {
    text-align: center;
    color: var(--accent-text);
    font-weight: 800;
    margin: 16px 0;
  }

  .err {
    color: var(--red);
    font-weight: 700;
  }

  .row {
    display: flex;
    justify-content: center;
    margin: 4px 0 8px;
  }

  .link {
    min-height: 44px;
    color: var(--muted);
    text-decoration: underline;
  }

  .ok {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    margin-bottom: 14px;
  }

  .ok p {
    margin: 4px 0 0;
    color: var(--muted);
  }

  .tick {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 20px;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 900;
    font-size: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .gap {
    margin-top: 8px;
  }

  .label {
    margin-bottom: 8px;
  }
</style>
