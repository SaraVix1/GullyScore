<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import QrCode from './QrCode.svelte';
  import Scanner from './Scanner.svelte';
  import ShareList from './ShareList.svelte';
  import { parseRoomCode, roomLink, loadRoom, loadName, saveName, loadTurn } from '../lib/room.js';

  // start: 'join' (form) | 'status' (in a room) | 'error'
  let {
    snap = null,
    start = 'join',
    code: given = '',
    error = '',
    takeover = 'ask',
    sharelist = [],
    ontakeovermode,
    onjoin,
    onremove,
    onretry,
    onclose,
    onleave,
  } = $props();

  const last = loadRoom();
  let step = $state(untrack(() => start));
  let code = $state(untrack(() => parseRoomCode(given)) || (last && !last.host ? last.code : '') || '');
  let name = $state(loadName());
  let scanning = $state(false);
  let bad = $state('');
  let copied = $state(false);
  const hasTurn = !!loadTurn();

  const inRoom = $derived(snap && snap.phase !== 'idle');
  const link = $derived(snap?.room ? roomLink(location.href, snap.room) : '');

  $effect(() => {
    if (inRoom) step = 'status';
  });

  function join(text = code) {
    const c = parseRoomCode(text);
    if (!c) {
      bad = 'That is not a room code. It looks like ABCD-EFGH-JKMN.';
      scanning = false;
      return;
    }
    bad = '';
    scanning = false;
    code = c;
    saveName(name.trim());
    onjoin?.(c, name.trim() || 'Another phone');
  }

  async function copy() {
    try {
      if (navigator.share) await navigator.share({ title: 'Gully Score room', text: 'Join my Gully Score room ' + snap.room, url: link });
      else await navigator.clipboard.writeText(link);
      copied = true;
    } catch {
      /* cancelled */
    }
  }
</script>

<Sheet title={step === 'join' ? 'Join a room' : 'Sync'} {onclose}>
  {#if step === 'error'}
    <p class="err">{error}</p>
    <button class="btn primary block big" onclick={() => (step = 'join')}>Join a room</button>
    <button class="btn ghost block gap" onclick={onclose}>Close</button>
  {:else if step === 'join'}
    <p class="note">Scan the QR code on the scoring phone, or type its room code.</p>
    {#if scanning}
      <Scanner onresult={join} accept={(t) => !!parseRoomCode(t)} placeholder="Paste the room code or link" />
      <button class="btn block gap" onclick={() => (scanning = false)}>Type the code instead</button>
    {:else}
      <label class="label" for="room-code">Room code</label>
      <input id="room-code" class="field code-in" autocomplete="off" autocapitalize="characters" spellcheck="false"
        placeholder="ABCD-EFGH-JKMN" bind:value={code} />
      <label class="label gap" for="my-name">Your name (the scorer sees it)</label>
      <input id="my-name" class="field" maxlength="30" placeholder="e.g. Ravi" bind:value={name} />
      {#if bad}<p class="err">{bad}</p>{/if}
      <div class="grid2 gap">
        <button class="btn big" onclick={() => (scanning = true)}>📷 Scan QR</button>
        <button class="btn primary big" disabled={!code.trim()} onclick={() => join()}>Join room</button>
      </div>
    {/if}
    <p class="hint">Both phones need internet (Wi-Fi or mobile data) when they are on different networks.</p>
  {:else if snap}
    {#if snap.host}
      <div class="label">Room code</div>
      <div class="room">{snap.room}</div>
      {#if snap.phase === 'connecting'}
        <p class="wait">Opening room…</p>
      {:else if !snap.connected}
        <QrCode text={link} />
        <div class="row">
          <button class="link" onclick={copy}>{copied ? 'Link shared' : 'Share link instead'}</button>
        </div>
        <p class="note">On the other phone: Settings → Sync → Join room, then scan this code.</p>
      {/if}
    {/if}

    {#if snap.connected}
      <div class="ok">
        <span class="tick">✓</span>
        <div>
          <b>Connected{snap.peerName ? ' to ' + snap.peerName : ''}</b>
          <p>
            {snap.role === 'scorer'
              ? 'This phone is scoring. The other phone sees every ball live.'
              : 'This phone is watching. Tap Take over scoring to swap.'}
          </p>
        </div>
      </div>
    {:else if snap.phase === 'waiting'}
      <p class="wait">Waiting for the other phone…</p>
    {:else if snap.phase === 'approval'}
      <p class="wait">Waiting for the scorer to let this phone in…</p>
    {:else if snap.phase === 'lost'}
      <p class="wait">Connection lost. Reconnecting…</p>
      <button class="btn block" onclick={onretry}>Try now</button>
    {:else if !snap.host}
      <p class="wait">Connecting to room {snap.room}…</p>
    {/if}

    {#if snap.slow}
      <p class="hint warn">
        Still connecting. Check that both phones have internet. On some mobile networks the phones can't reach each
        other directly{hasTurn ? '; your TURN key is in use' : ': add a free TURN key in Settings → Sync'}.
      </p>
    {/if}

    {#if snap.role === 'scorer' && snap.connected}
      <div class="label gap">If the other phone asks to take over</div>
      <div class="seg">
        <button aria-pressed={takeover === 'ask'} onclick={() => ontakeovermode?.('ask')}>Ask me first</button>
        <button aria-pressed={takeover === 'instant'} onclick={() => ontakeovermode?.('instant')}>Instant</button>
      </div>
    {/if}

    {#if snap.host}
      <div class="gap"><ShareList list={sharelist} {onremove} /></div>
    {/if}

    <button class="btn primary block big gap" onclick={onclose}>Done</button>
    <button class="btn ghost block gap" onclick={onleave}>{snap.host ? 'Close room' : 'Leave room'}</button>
  {/if}
</Sheet>

<style>
  .note {
    margin: 0 0 14px;
    color: var(--muted);
  }

  .hint {
    margin: 12px 0 0;
    font-size: 14px;
    color: var(--muted);
  }

  .warn {
    color: var(--accent-text);
    font-weight: 700;
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

  .room {
    font-size: 30px;
    font-weight: 900;
    letter-spacing: 2px;
    text-align: center;
    margin: 4px 0 12px;
    font-variant-numeric: tabular-nums;
  }

  .field {
    width: 100%;
    min-height: 48px;
    margin-top: 6px;
    padding: 0 12px;
    border-radius: var(--radius);
    border: 2px solid var(--line);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
  }

  .code-in {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  .label {
    display: block;
  }

  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
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
    margin: 8px 0 6px;
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
    margin-top: 12px;
  }
</style>
