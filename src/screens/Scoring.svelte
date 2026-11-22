<script>
  import { untrack } from 'svelte';
  import {
    addBall,
    setBowler,
    replaceBatter,
    swapStrike,
    undo,
    canUndo,
    renamePlayer,
    canChangeBatter,
    availableBatters,
    addPenalty,
    retireBatter,
    getState,
    oversText,
    rate,
    inningsTitle,
    DISMISSALS,
  } from '../lib/engine.js';
  import { inkFor } from '../lib/teams.js';
  import { withLog, undoLogged } from '../lib/editlog.js';
  import Sheet from '../components/Sheet.svelte';
  import Badge from '../components/Badge.svelte';
  import NumPick from '../components/NumPick.svelte';
  import Scorecard from '../components/Scorecard.svelte';
  import ShareSheet from '../components/ShareSheet.svelte';
  import EditLog from '../components/EditLog.svelte';

  // viewer: this phone is watching a live match (read-only).
  // live: live-sharing snapshot, or null when not sharing.
  let { match, st, onchange, onabandon, viewer = false, live = null, onlive, ontakeover, onforce, onleave } = $props();

  const s = $derived(st.cur);
  const R = $derived(match.rules);
  const bat = $derived(match.teams[s.battingTeam]);
  const field = $derived(match.teams[s.bowlingTeam]);
  const batNames = $derived(match.names[s.battingTeam]);
  const bowlNames = $derived(match.names[s.bowlingTeam]);
  const overNo = $derived(Math.floor(s.balls / 6) + 1);
  const undoable = $derived(canUndo(match));
  const OT = $derived(R.overthrows !== false);
  const extras = $derived(
    [
      { id: 'wd', label: 'Wide' },
      { id: 'nb', label: 'No ball' },
      R.byes && { id: 'b', label: 'Bye' },
      R.legByes && { id: 'lb', label: 'Leg bye' },
    ].filter(Boolean),
  );

  let sheet = $state(null);
  let nameDraft = $state('');
  let ro = $state({ batter: 'striker', runs: 0, extra: null });
  let pen = $state({ team: 0, runs: 5 });
  let otf = $state({ ran: 0, ot: 4 }); // overthrow form
  let cus = $state({ total: 5, ran: 5, touched: false }); // custom runs form
  let toast = $state('');
  let toastTimer;

  function flash(msg) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 2600);
  }

  function buzz() {
    try {
      navigator.vibrate?.(12);
    } catch {
      /* not supported */
    }
  }

  function act(fn) {
    try {
      const next = fn(match);
      onchange(next);
      buzz();
      sheet = null;
      return next;
    } catch (e) {
      flash(e.message);
      return null;
    }
  }

  // Run an action that may bring in a new batter, and say who came in.
  function actWithIncoming(fn) {
    const idx = st.current;
    const before = [s.striker, s.nonStriker];
    const names = batNames;
    const next = act(fn);
    if (!next) return;
    const inn = getState(next).innings[idx];
    const incoming = [inn.striker, inn.nonStriker].find((p) => p != null && !before.includes(p));
    if (!inn.done && incoming != null) flash(`${names[incoming]} comes in. Tap the name to change.`);
  }

  const ball = (b) => (b.wicket ? actWithIncoming((m) => addBall(m, b)) : act((m) => addBall(m, b)));

  function doUndo() {
    if (act(undoLogged)) flash('Undone');
  }

  function openBatter(p) {
    if (viewer) return;
    nameDraft = batNames[p];
    sheet = { type: 'batter', p };
  }

  function openBowler(p) {
    if (viewer) return;
    nameDraft = bowlNames[p];
    sheet = { type: 'bowler', p };
  }

  function saveName(team, p) {
    act((m) => {
      const old = m.names[team][p];
      const next = renamePlayer(m, team, p, nameDraft);
      const now = next.names[team][p];
      return now === old ? next : withLog(m, next, `Renamed ${old} to ${now}`);
    });
  }

  function openRunOut() {
    ro = { batter: 'striker', runs: 0, extra: null };
    sheet = { type: 'runout' };
  }

  function recordRunOut() {
    const extra = (ro.extra === 'b' || ro.extra === 'lb') && ro.runs === 0 ? null : ro.extra;
    ball({ runs: ro.runs, extra, wicket: { how: 'runout', batter: ro.batter } });
  }

  // Overthrow on a normal ball (extra null) or on top of an extra.
  function openOverthrow(extra = null) {
    otf = { ran: extra === 'b' || extra === 'lb' ? 1 : 0, ot: 4 };
    sheet = extra ? { type: extra, ot: true } : { type: 'ot' };
  }

  const baseRun = (extra) => (extra === 'wd' ? (R.wideRun ? 1 : 0) : extra === 'nb' ? (R.noBallRun ? 1 : 0) : 0);

  function otWhere(extra) {
    const name = batNames[s.striker];
    if (!extra) return `All to ${name}`;
    if (extra === 'wd') return 'All as wides';
    if (extra === 'nb') return otf.ran ? `${otf.ran} to ${name}, the rest as no-ball extras` : 'All as no-ball extras';
    return `All as ${extra === 'b' ? 'byes' : 'leg byes'}`;
  }

  function openCustom() {
    cus = { total: 5, ran: 5, touched: false };
    sheet = { type: 'custom' };
  }

  const strikeNote = (ran) =>
    s.nonStriker == null
      ? ''
      : ran % 2
        ? `Ran ${ran}, an odd number, so the batters change ends.`
        : `Ran ${ran}, so strike stays the same.`;

  // Big-moment flash for a four, six or wicket (also on the watching phone).
  const ACTION_T = new Set(['ball', 'penalty', 'retire']);
  function lastAction(m) {
    let n = 0;
    let last = null;
    for (const evs of m.innings)
      for (const e of evs)
        if (ACTION_T.has(e.t)) {
          n++;
          last = e;
        }
    return { n, last };
  }
  let fx = $state(null);
  let seen = untrack(() => lastAction(match).n);
  $effect(() => {
    const { n, last } = lastAction(match);
    if (n > seen && last?.t === 'ball') {
      const boundary = !last.extra && !last.ot && last.ran == null && (last.runs === 4 || last.runs === 6);
      const kind = last.wicket ? 'w' : boundary ? (last.runs === 4 ? 'four' : 'six') : null;
      if (kind) fx = { kind, id: n, text: kind === 'w' ? 'Wicket' : kind === 'four' ? 'Four' : 'Six' };
    }
    seen = n;
  });

  function openPenalty() {
    pen = { team: s.battingTeam, runs: 5 };
    sheet = { type: 'penalty' };
  }

  function retire(p, kind) {
    const slot = p === s.striker ? 'striker' : 'nonStriker';
    actWithIncoming((m) => withLog(m, retireBatter(m, slot, kind), `${batNames[p]} retired ${kind}`));
  }

  function figures(b) {
    return `${oversText(b.balls)}-${b.maidens}-${b.runs}-${b.wickets}`;
  }

  // Keep the screen awake while scoring.
  $effect(() => {
    let lock = null;
    const request = async () => {
      try {
        lock = await navigator.wakeLock?.request('screen');
      } catch {
        /* denied or unsupported */
      }
    };
    const onVis = () => document.visibilityState === 'visible' && request();
    request();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release?.().catch(() => {});
    };
  });
</script>

<main class="scoring">
  <div class="top">
    <header class="hero" style="--tc:{bat.color}; --ti:{inkFor(bat.color)}">
      <div class="bar">
        <Badge team={bat} size={40} />
        <div class="tname display">{bat.name}</div>
        <button class="icon" aria-label="Share scorecard" onclick={() => (sheet = { type: 'share' })}>↗</button>
        <button class="icon" aria-label="Match menu" onclick={() => (sheet = { type: 'menu' })}>⋯</button>
      </div>
      <div class="board">
        <div class="total num"><span>{s.runs}</span><span class="wk">/{s.wickets}</span></div>
        <div class="side">
          <div class="stat"><span>Overs</span><b class="num">{oversText(s.balls)}</b><small class="num">/{s.overs}</small></div>
          <div class="stat"><span>CRR</span><b class="num">{rate(s.runs, s.balls)}</b></div>
        </div>
      </div>
      {#if fx}
        {#key fx.id}
          <div class="fx {fx.kind}" aria-hidden="true"><span class="display">{fx.text}</span></div>
        {/key}
      {/if}
    </header>
    <div class="ticker display" style="--tc:{bat.color}">
      <span class="tk">{inningsTitle(match, s)} · vs <Badge team={field} size={20} inline />{field.name}</span>
      <button class="pill edits" class:hot={match.log?.length} onclick={() => (sheet = { type: 'editlog' })} aria-label="Edit log, {match.log?.length || 0} edits">
        ✎ {match.log?.length || 0}
      </button>
      {#if live}
        <button class="pill" class:off={!live.connected && live.phase !== 'waiting'} onclick={onlive}>
          {live.connected
            ? viewer ? '👀 Live' : '📡 Live'
            : live.phase === 'waiting' ? '📡 Room open' : live.phase === 'lost' ? '⚠ Offline' : '📡 Connecting…'}
        </button>
      {/if}
    </div>

    {#if s.target != null}
      <section class="chase num display">
        <div><span>Target</span><b>{s.target}</b></div>
        <div class="need"><span>Need</span><b>{s.need}</b> off <b>{s.ballsLeft}</b></div>
        <div class="rrr"><span>RRR</span><b>{s.ballsLeft ? rate(s.need, s.ballsLeft) : '–'}</b></div>
      </section>
    {/if}

    <section class="over">
      <span class="label">{s.overDone ? `Over ${overNo - 1}` : 'This over'}</span>
      <div class="chips">
        {#each s.thisOver as c, i (i)}
          <span class="chip {c.kind}">{c.label}</span>
        {:else}
          <span class="empty">No balls yet</span>
        {/each}
      </div>
    </section>

    {#if s.freeHit}
      <div class="freehit" role="status">FREE HIT · only a run out counts</div>
    {/if}

    <section class="crease">
      {#each [s.striker, s.nonStriker] as p, i (i)}
        {#if p != null}
          {@const b = s.batters[p]}
          <button class="batter" class:on={i === 0} onclick={() => openBatter(p)}>
            <span class="mark" aria-label={i === 0 ? 'On strike' : 'Non-striker'}>{i === 0 ? '▶' : ''}</span>
            <span class="bname">
              {batNames[p]}
              {#if b.fresh && !viewer}<small>tap to edit</small>{/if}
            </span>
            <span class="bstat num"><b>{b.runs}</b> <span>({b.balls})</span></span>
          </button>
        {/if}
      {/each}
      {#if s.striker != null && s.nonStriker == null}
        <div class="alone">Last batter: on strike every ball</div>
      {/if}
    </section>

    {#if !s.needBowler && s.bowler != null}
      <button class="bowler" onclick={() => openBowler(s.bowler)}>
        <span class="label">Bowler</span>
        <span class="bwname">{bowlNames[s.bowler]}</span>
        <span class="num fig">{figures(s.bowlers[s.bowler])}</span>
      </button>
    {/if}
  </div>

  {#if viewer}
    <section class="watch">
      <div class="label">👀 Watching live</div>
      {#if live?.connected}
        <p>The other phone is scoring. Every ball shows up here as it happens.</p>
        <button class="btn primary block big" disabled={live.pending} onclick={ontakeover}>
          {live.pending ? 'Waiting for the scorer to accept…' : 'Take over scoring'}
        </button>
      {:else}
        <p class="warn">Connection to the scoring phone was lost.</p>
        <div class="grid2">
          <button class="btn primary big" onclick={onlive}>Reconnect</button>
          <button class="btn big" onclick={() => (sheet = { type: 'force' })}>Take over anyway</button>
        </div>
      {/if}
    </section>
  {:else if s.needBowler}
    <section class="picker">
      {#if !s.started && s.balls === 0}
        {#if s.superOver}
          <div class="break">
            <div class="label">{inningsTitle(match, s)}</div>
            <p>
              {#if s.target != null}
                <b><Badge team={bat} size={22} inline />{bat.name}</b> need <b class="num">{s.target}</b> from 1 over
              {:else}
                Match tied! <b><Badge team={bat} size={22} inline />{bat.name}</b> bat first: 1 over, 2 wickets.
              {/if}
            </p>
            <p class="small">Tap a batter above to pick who bats.</p>
          </div>
        {:else if s.target != null}
          <div class="break">
            <div class="label">Innings break</div>
            <p>
              <b><Badge team={bat} size={22} inline />{bat.name}</b> need <b class="num">{s.target}</b> to win from
              <b class="num">{s.overs}</b> {s.overs === 1 ? 'over' : 'overs'}
            </p>
          </div>
        {:else}
          <p class="tip">Openers are in. Tap a batter's name above to rename or swap them.</p>
        {/if}
      {/if}
      <h2>Who bowls over {overNo}?</h2>
      <div class="plist">
        {#each bowlNames as name, p (p)}
          {@const b = s.bowlers[p]}
          <div class="prow">
            <button class="pick" disabled={p === s.prevBowler} onclick={() => act((m) => setBowler(m, p))}>
              <span>{name}</span>
              <small class="num">
                {p === s.prevBowler ? 'bowled last over' : b.balls || b.runs ? figures(b) : ''}
              </small>
            </button>
            <button class="edit" aria-label="Rename {name}" onclick={() => openBowler(p)}>✎</button>
          </div>
        {/each}
      </div>
      <div class="grid2">
        <button class="btn ghost" disabled={!undoable} onclick={doUndo}>↶ Undo</button>
        <button class="btn ghost" onclick={() => (sheet = { type: 'menu' })}>More…</button>
      </div>
    </section>
  {:else}
    <section class="pad" aria-label="Scoring keypad">
      {#each [0, 1, 2, 3, 4, 6] as r (r)}
        <button class="k run" class:dot={r === 0} class:four={r === 4} class:six={r === 6} onclick={() => ball({ runs: r })}>
          {r}
        </button>
      {/each}
      {#if OT}
        <button class="k ot" onclick={() => openOverthrow()}>Over<wbr />throw</button>
      {/if}
      <button class="k out" class:wide={!OT} onclick={() => (sheet = { type: 'wicket' })}>OUT</button>
      <div class="xrow" style="grid-template-columns: repeat({extras.length}, 1fr)">
        {#each extras as x (x.id)}
          <button class="k x" onclick={() => (sheet = { type: x.id })}>{x.label}</button>
        {/each}
      </div>
      <button class="k util" disabled={!undoable} onclick={doUndo}>↶ Undo</button>
      <button class="k util" disabled={s.nonStriker == null} onclick={() => act((m) => withLog(m, swapStrike(m), 'Strike swapped by hand'))}>⇄ Swap</button>
      <button class="k util" onclick={openCustom}>± Runs</button>
      <button class="k util" onclick={() => (sheet = { type: 'menu' })}>More…</button>
    </section>
  {/if}

  {#if toast}
    <div class="toast" role="status">{toast}</div>
  {/if}
</main>

{#if sheet?.type === 'wicket'}
  <Sheet title="How was {batNames[s.striker]} out?" onclose={() => (sheet = null)}>
    {#if s.freeHit}<p class="note">Free hit: the batter can only be run out.</p>{/if}
    <div class="grid2">
      {#each DISMISSALS as d (d.id)}
        <button
          class="btn big"
          class:danger={d.id !== 'runout'}
          disabled={s.freeHit && d.id !== 'runout'}
          onclick={() => (d.id === 'runout' ? openRunOut() : ball({ runs: 0, wicket: { how: d.id } }))}
        >
          {d.label}
        </button>
      {/each}
    </div>
  </Sheet>
{:else if sheet?.type === 'runout'}
  <Sheet title="Run out" onclose={() => (sheet = null)}>
    <div class="label">Who is out?</div>
    <div class="seg">
      <button aria-pressed={ro.batter === 'striker'} onclick={() => (ro.batter = 'striker')}>
        {batNames[s.striker]} (striker)
      </button>
      {#if s.nonStriker != null}
        <button aria-pressed={ro.batter === 'nonStriker'} onclick={() => (ro.batter = 'nonStriker')}>
          {batNames[s.nonStriker]}
        </button>
      {/if}
    </div>
    <div class="label gap">Runs completed</div>
    <div class="seg">
      {#each [0, 1, 2, 3] as r (r)}
        <button aria-pressed={ro.runs === r} onclick={() => (ro.runs = r)}>{r}</button>
      {/each}
    </div>
    <div class="label gap">Delivery</div>
    <div class="seg wrap">
      {#each [{ id: null, label: 'Normal' }, ...extras] as x (x.id)}
        <button aria-pressed={ro.extra === x.id} onclick={() => (ro.extra = x.id)}>{x.label}</button>
      {/each}
    </div>
    <button class="btn danger block big gap" onclick={recordRunOut}>Record run out</button>
  </Sheet>
{:else if sheet?.ot || sheet?.type === 'ot'}
  {@const extra = sheet.type === 'ot' ? null : sheet.type}
  {@const total = baseRun(extra) + otf.ran + otf.ot}
  {@const title = { ot: 'Overthrow', wd: 'Wide + overthrow', nb: 'No ball + overthrow', b: 'Byes + overthrow', lb: 'Leg byes + overthrow' }[sheet.type]}
  <Sheet {title} onclose={() => (sheet = null)}>
    <NumPick
      label={extra === 'nb' ? 'Runs off the bat' : extra === 'b' || extra === 'lb' ? 'Byes ran' : 'Runs the batters ran'}
      value={otf.ran}
      quick={[0, 1, 2, 3]}
      onpick={(v) => (otf.ran = v)}
    />
    <NumPick label="Overthrow runs" value={otf.ot} quick={[1, 2, 3, 4]} onpick={(v) => (otf.ot = v)} />
    <div class="sum">
      <b class="num display">{total}</b>
      <span>
        {total === 1 ? 'run' : 'runs'}{baseRun(extra) ? ` (incl. 1 ${extra === 'wd' ? 'wide' : 'no ball'})` : ''}. {otWhere(extra)}.
        {strikeNote(otf.ran)}
      </span>
    </div>
    <button
      class="btn primary block big"
      disabled={(extra === 'b' || extra === 'lb') && total < 1}
      onclick={() => ball({ runs: otf.ran, ot: otf.ot, extra })}>Record {total}</button
    >
  </Sheet>
{:else if sheet?.type === 'custom'}
  <Sheet title="Custom runs" onclose={() => (sheet = null)}>
    <NumPick
      label="Total runs for this ball"
      value={cus.total}
      max={40}
      quick={[5, 7, 8]}
      onpick={(v) => {
        cus.total = v;
        if (!cus.touched || cus.ran > v) cus.ran = v;
      }}
    />
    <NumPick
      label="How many the batters ran"
      value={cus.ran}
      max={cus.total}
      quick={[0, 1, 2, 3]}
      onpick={(v) => {
        cus.ran = v;
        cus.touched = true;
      }}
    />
    <div class="sum">
      <b class="num display">{cus.total}</b>
      <span>{cus.total === 1 ? 'run' : 'runs'} to {batNames[s.striker]}, one legal ball. {strikeNote(cus.ran)}</span>
    </div>
    <button class="btn primary block big" onclick={() => ball({ runs: cus.total, ran: cus.ran })}>Record {cus.total}</button>
  </Sheet>
{:else if sheet?.type === 'wd'}
  <Sheet title="Wide: extra runs?" onclose={() => (sheet = null)}>
    <p class="note">
      {R.wideRun ? 'Adds 1 run' : 'No run for a wide'}, ball not counted. Add any runs the batters ran.
    </p>
    <div class="grid3">
      {#each [0, 1, 2, 3, 4] as r (r)}
        <button class="btn big" onclick={() => ball({ extra: 'wd', runs: r })}>{r ? `Wide +${r}` : 'Wide'}</button>
      {/each}
      {#if OT}<button class="btn big alt" onclick={() => openOverthrow('wd')}>+ Overthrow</button>{/if}
    </div>
  </Sheet>
{:else if sheet?.type === 'nb'}
  <Sheet title="No ball: runs off the bat?" onclose={() => (sheet = null)}>
    <p class="note">
      {R.noBallRun ? 'Adds 1 run' : 'No run for a no ball'}, ball not counted.{R.freeHit
        ? ' Next ball is a free hit.'
        : ''}
    </p>
    <div class="grid3">
      {#each [0, 1, 2, 3, 4, 6] as r (r)}
        <button class="btn big" onclick={() => ball({ extra: 'nb', runs: r })}>{r ? `NB +${r}` : 'No ball'}</button>
      {/each}
    </div>
    {#if OT}<button class="btn big block alt gap" onclick={() => openOverthrow('nb')}>+ Overthrow</button>{/if}
  </Sheet>
{:else if sheet?.type === 'b' || sheet?.type === 'lb'}
  {@const lbl = sheet.type === 'b' ? 'Byes' : 'Leg byes'}
  <Sheet title="{lbl}: how many runs?" onclose={() => (sheet = null)}>
    <div class="grid4">
      {#each [1, 2, 3, 4] as r (r)}
        <button class="btn big" onclick={() => ball({ extra: sheet.type, runs: r })}>{r}</button>
      {/each}
    </div>
    {#if OT}<button class="btn big block alt gap" onclick={() => openOverthrow(sheet.type)}>+ Overthrow</button>{/if}
  </Sheet>
{:else if sheet?.type === 'batter'}
  {@const p = sheet.p}
  <Sheet title="Batter" onclose={() => (sheet = null)}>
    <form
      class="rename"
      onsubmit={(e) => {
        e.preventDefault();
        saveName(s.battingTeam, p);
      }}
    >
      <input class="text-input" aria-label="Batter name" maxlength="24" bind:value={nameDraft} />
      <button class="btn primary" type="submit">Save</button>
    </form>
    {#if canChangeBatter(s, p)}
      {@const options = availableBatters(s)}
      {#if options.length}
        <div class="label gap">Or send in someone else</div>
        <div class="grid2">
          {#each options as i (i)}
            <button class="btn" onclick={() => act((m) => withLog(m, replaceBatter(m, p, i), `Batter ${batNames[p]} replaced by ${batNames[i]}`))}>
              {batNames[i]}{s.batters[i].out ? ' (retired hurt)' : ''}
            </button>
          {/each}
        </div>
      {/if}
    {/if}
    <div class="label gap">Retire {batNames[p]}</div>
    <div class="grid2">
      <button class="btn" onclick={() => retire(p, 'hurt')}>Retired hurt</button>
      <button class="btn danger" onclick={() => retire(p, 'out')}>Retired out</button>
    </div>
    <p class="note small">Retired hurt is not a wicket, and the batter can come back later. Retired out counts as a wicket.</p>
  </Sheet>
{:else if sheet?.type === 'bowler'}
  {@const p = sheet.p}
  <Sheet title="Bowler" onclose={() => (sheet = null)}>
    <form
      class="rename"
      onsubmit={(e) => {
        e.preventDefault();
        saveName(s.bowlingTeam, p);
      }}
    >
      <input class="text-input" aria-label="Bowler name" maxlength="24" bind:value={nameDraft} />
      <button class="btn primary" type="submit">Save</button>
    </form>
    {#if p === s.bowler && !s.needBowler}
      <div class="label gap">Change bowler {s.balls % 6 ? 'for the rest of this over' : 'for this over'}</div>
      <div class="grid2">
        {#each bowlNames as n, i (i)}
          {#if i !== p && i !== s.prevBowler}
            <button class="btn" onclick={() => act((m) => withLog(m, setBowler(m, i), `Bowler changed from ${bowlNames[p]} to ${n}`))}>{n}</button>
          {/if}
        {/each}
      </div>
      <p class="note small">Each bowler keeps their own figures for the balls they bowl.</p>
    {/if}
  </Sheet>
{:else if sheet?.type === 'penalty'}
  <Sheet title="Penalty runs" onclose={() => (sheet = null)}>
    <div class="label">Award to</div>
    <div class="seg">
      {#each [s.battingTeam, s.bowlingTeam] as t (t)}
        <button aria-pressed={pen.team === t} onclick={() => (pen.team = t)}>
          <Badge team={match.teams[t]} size={22} inline />{match.teams[t].name}
        </button>
      {/each}
    </div>
    <div class="label gap">Runs</div>
    <div class="seg">
      {#each [1, 2, 3, 4, 5] as r (r)}
        <button aria-pressed={pen.runs === r} onclick={() => (pen.runs = r)}>{r}</button>
      {/each}
    </div>
    <p class="note gap">
      {pen.team === s.battingTeam
        ? 'Added to the batting score now. No ball is counted.'
        : s.target != null
          ? 'Added to their innings total, so the target goes up.'
          : 'Added to their score when they bat.'}
    </p>
    <button class="btn primary block big" onclick={() => act((m) => withLog(m, addPenalty(m, pen.team, pen.runs), `${pen.runs} penalty ${pen.runs === 1 ? 'run' : 'runs'} to ${match.teams[pen.team].name}`))}>
      Add {pen.runs} penalty {pen.runs === 1 ? 'run' : 'runs'}
    </button>
  </Sheet>
{:else if sheet?.type === 'retire'}
  <Sheet title="Retire a batter" onclose={() => (sheet = null)}>
    {#each [s.striker, s.nonStriker].filter((p) => p != null) as p (p)}
      <div class="label gap">{batNames[p]}</div>
      <div class="grid2">
        <button class="btn" onclick={() => retire(p, 'hurt')}>Retired hurt</button>
        <button class="btn danger" onclick={() => retire(p, 'out')}>Retired out</button>
      </div>
    {/each}
    <p class="note gap">Retired hurt is not a wicket, and the batter can come back later. Retired out counts as a wicket.</p>
  </Sheet>
{:else if sheet?.type === 'menu'}
  <Sheet title="Match" onclose={() => (sheet = null)}>
    <div class="grid2">
      <button class="btn big" onclick={() => (sheet = { type: 'share' })}>↗ Share</button>
      <button class="btn big" onclick={() => (sheet = { type: 'scorecard' })}>Scorecard</button>
      <button class="btn big" onclick={() => (sheet = { type: 'editlog' })}>Edit log ({match.log?.length || 0})</button>
      <button
        class="btn big live"
        onclick={() => {
          sheet = null;
          onlive?.();
        }}>📡 {live ? 'Live sharing' : 'Share live'}</button
      >
      {#if viewer}
        <button
          class="btn big"
          onclick={() => {
            sheet = null;
            onleave?.();
          }}>Stop watching</button
        >
      {/if}
    </div>
    {#if !viewer}
    <div class="grid2 gap">
      <button class="btn big" onclick={openPenalty}>Penalty runs</button>
      <button class="btn big" onclick={() => (sheet = { type: 'retire' })}>Retire batter</button>
      <button
        class="btn big"
        disabled={s.needBowler || s.bowler == null}
        onclick={() => openBowler(s.bowler)}>Change bowler</button
      >
      <button class="btn big" disabled={!undoable} onclick={doUndo}>↶ Undo</button>
    </div>
    <button class="btn ghost block big gap" onclick={() => (sheet = { type: 'abandon' })}>Abandon match</button>
    {/if}
    <p class="note gap">
      {match.players} a side · {match.overs} overs · {match.teams[match.toss.winner].name} won the toss and chose to
      {match.toss.choice}.
      {#if !viewer}To hand scoring to someone else on this phone, just pass it over: every ball is saved, and they can
        tap Resume match after reopening the app. To score from another phone, use Share live to open a room.{/if}
    </p>
  </Sheet>
{:else if sheet?.type === 'force'}
  <Sheet title="Take over without asking?" onclose={() => (sheet = null)}>
    <p class="note">
      Only do this if the scoring phone is gone (flat battery, app closed). This phone becomes the scorer from the last
      ball it received. If the other phone reconnects, it switches to watching automatically.
    </p>
    <div class="grid2">
      <button class="btn big" onclick={() => (sheet = null)}>Cancel</button>
      <button
        class="btn primary big"
        onclick={() => {
          sheet = null;
          onforce?.();
        }}>Take over</button
      >
    </div>
  </Sheet>
{:else if sheet?.type === 'share'}
  <ShareSheet {match} {st} onclose={() => (sheet = null)} onflash={flash} />
{:else if sheet?.type === 'editlog'}
  <EditLog {match} onclose={() => (sheet = null)} />
{:else if sheet?.type === 'scorecard'}
  <Sheet title="Scorecard" onclose={() => (sheet = null)}>
    {#each st.innings as inn (inn.index)}
      <Scorecard {match} {inn} />
    {/each}
  </Sheet>
{:else if sheet?.type === 'abandon'}
  <Sheet title="Abandon this match?" onclose={() => (sheet = null)}>
    <p class="note">The score will be deleted from this phone. This cannot be undone.</p>
    <div class="grid2">
      <button class="btn big" onclick={() => (sheet = null)}>Keep scoring</button>
      <button class="btn danger big" onclick={onabandon}>Abandon</button>
    </div>
  </Sheet>
{/if}

<style>
  .scoring {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    max-width: 560px;
    margin: 0 auto;
  }

  .top {
    flex: 1;
    padding: calc(env(safe-area-inset-top) + 8px) var(--gutter) 8px;
  }

  /* ---- broadcast score bar ---- */
  .hero {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius) var(--radius) 0 0;
    background: var(--tc);
    color: var(--ti);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 0 10px;
  }

  .tname {
    flex: 1;
    min-width: 0;
    font-size: clamp(19px, 5.8vw, 26px);
    font-weight: 900;
    line-height: 1.05;
    /* Long names wrap to a second line rather than being cut off. */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  .total {
    font-family: var(--display);
    font-stretch: condensed;
    font-size: clamp(72px, 22vw, 104px);
    font-weight: 900;
    line-height: 0.92;
    letter-spacing: -0.02em;
    padding: 4px 8px 8px 12px;
    align-self: flex-end;
  }

  .board {
    display: flex;
    justify-content: space-between;
    align-items: stretch;
    margin-top: 2px;
  }

  .total .wk {
    font-size: 0.62em;
    opacity: 0.8;
  }

  /* Dark side panel with an angled edge, like a TV graphic. */
  .side {
    flex: none;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
    min-width: 118px;
    padding: 8px 12px 8px calc(var(--cut) + 14px);
    background: var(--bg);
    color: var(--text);
    clip-path: polygon(var(--cut) 0, 100% 0, 100% 100%, 0 100%);
    text-align: right;
  }

  .icon {
    flex: none;
    width: 42px;
    height: 40px;
    border-radius: var(--radius);
    background: rgba(0, 0, 0, 0.2);
    color: inherit;
    font-size: 22px;
    line-height: 1;
    font-weight: 900;
  }

  .stat {
    font-family: var(--display);
    font-stretch: condensed;
    line-height: 1;
  }

  .stat span {
    display: block;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-text);
  }

  .stat b {
    font-size: 30px;
    font-weight: 900;
  }

  .stat small {
    font-size: 17px;
    font-weight: 700;
    color: var(--muted);
  }

  .ticker {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 34px;
    padding: 2px 4px 2px 12px;
    margin-bottom: 10px;
    background: var(--surface-2);
    border-bottom: 3px solid var(--tc, var(--accent));
    border-radius: 0 0 var(--radius) var(--radius);
    font-size: 15px;
    color: var(--muted);
  }

  .tk {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pill {
    flex: none;
    min-height: 28px;
    padding: 0 10px;
    border-radius: 2px;
    background: var(--accent);
    color: var(--accent-ink);
    font: inherit;
    font-size: 14px;
    font-weight: 900;
  }

  .pill.edits {
    background: var(--surface-3);
    color: var(--text);
  }

  .pill.edits.hot {
    background: var(--amber);
    color: var(--amber-ink);
  }

  .pill.off {
    background: var(--red);
    color: var(--red-ink);
  }

  /* four / six / wicket flash */
  .fx {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    animation: fx-bg 1s ease-out forwards;
  }

  .fx.four {
    background: var(--blue);
    color: var(--blue-ink);
  }

  .fx.six {
    background: var(--six);
    color: var(--six-ink);
  }

  .fx.w {
    background: var(--red);
    color: var(--red-ink);
  }

  .fx span {
    font-size: clamp(56px, 18vw, 88px);
    font-weight: 900;
    letter-spacing: 0.06em;
    animation: fx-word 1s cubic-bezier(0.2, 1.4, 0.4, 1) forwards;
  }

  @keyframes fx-bg {
    0% {
      opacity: 0;
      clip-path: polygon(0 0, 0 0, -20% 100%, -20% 100%);
    }
    15% {
      opacity: 1;
      clip-path: polygon(0 0, 120% 0, 100% 100%, -20% 100%);
    }
    70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  @keyframes fx-word {
    0% {
      transform: scale(1.8) skewX(-12deg);
      opacity: 0;
    }
    20% {
      transform: scale(1) skewX(-12deg);
      opacity: 1;
    }
    75% {
      transform: scale(1.04) skewX(-12deg);
      opacity: 1;
    }
    100% {
      transform: scale(1.1) skewX(-12deg);
      opacity: 0;
    }
  }

  /* ---- chase, over, crease ---- */
  .chase {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--radius);
    background: var(--surface);
    border-left: 6px solid var(--accent);
    font-size: 17px;
    margin-bottom: 8px;
  }

  .chase > div {
    line-height: 1.05;
    white-space: nowrap;
  }

  .chase span {
    display: block;
    color: var(--muted);
    font-size: 13px;
    letter-spacing: 0.1em;
  }

  .chase .need {
    text-align: center;
  }

  .chase .rrr {
    text-align: right;
  }

  .chase b {
    font-weight: 900;
    font-size: 26px;
    color: var(--accent-text);
  }

  .over {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    margin-bottom: 8px;
  }

  .over .label {
    flex: none;
    min-width: 84px;
    white-space: nowrap;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .empty {
    color: var(--dim);
    font-size: 15px;
  }

  .freehit {
    padding: 10px 12px;
    margin-bottom: 8px;
    border-radius: var(--radius);
    background: var(--amber);
    color: var(--amber-ink);
    font-family: var(--display);
    font-stretch: condensed;
    font-size: 19px;
    font-weight: 900;
    letter-spacing: 0.04em;
    text-align: center;
    text-transform: uppercase;
  }

  .crease {
    background: var(--surface);
    border-radius: var(--radius);
    overflow: hidden;
    margin-bottom: 8px;
  }

  .batter {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 56px;
    padding: 8px 14px 8px 10px;
    text-align: left;
    border-left: 6px solid transparent;
  }

  .batter + .batter {
    border-top: 1px solid var(--line);
  }

  .batter.on {
    border-left-color: var(--accent);
    background: var(--surface-2);
  }

  .mark {
    width: 14px;
    color: var(--accent-text);
    font-size: 13px;
  }

  .bname {
    flex: 1;
    min-width: 0;
    font-size: 19px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .batter:not(.on) .bname {
    color: var(--muted);
  }

  .bname small {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--dim);
  }

  .bstat {
    font-family: var(--display);
    font-stretch: condensed;
  }

  .bstat b {
    font-size: 28px;
    font-weight: 900;
  }

  .bstat span {
    font-size: 17px;
    color: var(--muted);
  }

  .alone {
    padding: 8px 14px;
    font-size: 14px;
    color: var(--amber);
    border-top: 1px solid var(--line);
  }

  .bowler {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 48px;
    padding: 0 14px;
    border-radius: var(--radius);
    background: var(--surface);
    text-align: left;
  }

  .bwname {
    flex: 1;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fig {
    font-family: var(--display);
    font-stretch: condensed;
    font-size: 19px;
    color: var(--muted);
    font-weight: 800;
  }

  .watch {
    padding: 12px var(--gutter) calc(env(safe-area-inset-bottom) + 16px);
  }

  .watch p {
    margin: 8px 0 14px;
    color: var(--muted);
  }

  .watch .warn {
    color: var(--amber);
    font-weight: 700;
  }

  /* ---- keypad: chunky flat tiles ---- */
  .pad {
    position: sticky;
    bottom: 0;
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 6px;
    padding: 8px var(--gutter) calc(env(safe-area-inset-bottom) + 12px);
    background: var(--bg);
  }

  .k {
    grid-column: span 3;
    height: clamp(58px, 9.8dvh, 80px);
    border-radius: var(--radius);
    background: var(--surface-3);
    font-family: var(--display);
    font-stretch: condensed;
    font-size: 38px;
    font-weight: 900;
    line-height: 1;
    transition: transform 0.05s ease, filter 0.1s;
  }

  .k:active:not(:disabled) {
    transform: scale(0.94);
    filter: brightness(1.3);
  }

  .k.dot {
    color: var(--muted);
  }

  .k.four {
    background: var(--blue);
    color: var(--blue-ink);
  }

  .k.six {
    background: var(--six);
    color: var(--six-ink);
  }

  .k.ot {
    font-size: 17px;
    font-weight: 800;
    text-transform: uppercase;
    background: var(--surface-2);
    color: var(--accent-text);
    box-shadow: inset 0 0 0 2px var(--accent);
    padding: 0 2px;
  }

  .k.out {
    background: var(--red);
    color: var(--red-ink);
    font-size: 30px;
    letter-spacing: 0.06em;
  }

  .k.out.wide {
    grid-column: span 6;
  }

  .xrow {
    grid-column: 1 / -1;
    display: grid;
    gap: 6px;
  }

  .k.x {
    grid-column: auto;
    height: clamp(50px, 8dvh, 62px);
    font-size: 19px;
    font-weight: 800;
    text-transform: uppercase;
    background: var(--amber);
    color: var(--amber-ink);
  }

  .k.util {
    height: 50px;
    font-size: 16px;
    font-weight: 800;
    text-transform: uppercase;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  /* ---- bowler picker ---- */
  .picker {
    padding: 8px var(--gutter) calc(env(safe-area-inset-bottom) + 14px);
  }

  .picker h2 {
    margin: 4px 0 10px;
    font-family: var(--display);
    font-stretch: condensed;
    font-size: 26px;
    font-weight: 900;
    text-transform: uppercase;
  }

  .break {
    padding: 14px;
    border-radius: var(--radius);
    background: var(--surface);
    border-left: 6px solid var(--accent);
    margin-bottom: 12px;
  }

  .break p {
    margin: 6px 0 0;
    font-size: 18px;
  }

  .break p.small {
    font-size: 14px;
    color: var(--muted);
  }

  .break b {
    color: var(--accent-text);
  }

  .tip {
    margin: 0 0 6px;
    color: var(--muted);
    font-size: 15px;
  }

  .plist {
    display: grid;
    gap: 6px;
    margin-bottom: 12px;
  }

  .prow {
    display: flex;
    gap: 6px;
  }

  .pick {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 56px;
    padding: 0 16px;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: 18px;
    font-weight: 700;
    text-align: left;
  }

  .pick small {
    color: var(--muted);
    font-size: 14px;
    font-weight: 600;
  }

  .edit {
    flex: none;
    width: 56px;
    border-radius: var(--radius);
    background: var(--surface);
    font-size: 20px;
    color: var(--muted);
  }

  /* ---- sheets ---- */
  .grid2,
  .grid3,
  .grid4 {
    display: grid;
    gap: 8px;
  }

  .grid2 {
    grid-template-columns: 1fr 1fr;
  }

  .grid3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .grid4 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .grid3 .btn,
  .grid4 .btn {
    padding: 0 6px;
  }

  .btn.alt {
    background: transparent;
    color: var(--accent-text);
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .sum {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 16px 0 12px;
    padding: 10px 12px;
    background: var(--bg);
    border-left: 6px solid var(--accent);
    border-radius: var(--radius);
    color: var(--muted);
    font-size: 15px;
  }

  .sum b {
    font-size: 44px;
    line-height: 1;
    color: var(--accent-text);
  }

  .note {
    margin: 0 0 12px;
    color: var(--muted);
    font-size: 15px;
  }

  .note.small {
    margin-top: 10px;
    font-size: 14px;
  }

  .gap {
    margin-top: 16px;
  }

  .label.gap {
    margin-bottom: 8px;
  }

  .label:first-child {
    margin-bottom: 8px;
  }

  .seg.wrap {
    flex-wrap: wrap;
  }

  .seg.wrap button {
    flex: 1 1 30%;
  }

  .rename {
    display: flex;
    gap: 8px;
  }
</style>
