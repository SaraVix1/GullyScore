<script>
  import { oversText, rate, howOut, inningsTitle } from '../lib/engine.js';
  import Badge from './Badge.svelte';

  let { match, inn } = $props();

  const batNames = $derived(match.names[inn.battingTeam]);
  const bowlNames = $derived(match.names[inn.bowlingTeam]);
  const atCrease = $derived(new Set([inn.striker, inn.nonStriker]));
  const yetToBat = $derived(batNames.map((n, i) => (inn.order.includes(i) ? null : n)).filter(Boolean));
  const ex = $derived(inn.extras);
  const sr = (r, b) => (b ? ((r * 100) / b).toFixed(0) : '–');
</script>

<section class="sc" style="--tc:{match.teams[inn.battingTeam].color}">
  <header>
    <Badge team={match.teams[inn.battingTeam]} size={34} />
    <h3>
      {match.teams[inn.battingTeam].name}
      <small>{inningsTitle(match, inn)}</small>
    </h3>
    <div class="total num">
      {inn.runs}/{inn.wickets} <span>({oversText(inn.balls)} ov)</span>
    </div>
  </header>

  <table>
    <thead>
      <tr><th class="name">Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>
    </thead>
    <tbody>
      {#each inn.order as p (p)}
        {@const b = inn.batters[p]}
        <tr>
          <td class="name">
            <span class="who">{batNames[p]}{#if !b.out && !inn.done && atCrease.has(p) && inn.striker === p}<span class="star">*</span>{/if}</span>
            <span class="how" class:out={b.out}>{b.out ? howOut(b.out, bowlNames[b.out.bowler]) : 'not out'}</span>
          </td>
          <td class="r num">{b.runs}</td>
          <td class="num">{b.balls}</td>
          <td class="num">{b.fours}</td>
          <td class="num">{b.sixes}</td>
          <td class="num dim">{sr(b.runs, b.balls)}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <p class="line">
    <b>Extras {inn.extrasTotal}</b>
    <span class="dim num">(wd {ex.wd}, nb {ex.nb}, b {ex.b}, lb {ex.lb}{ex.p ? `, penalty ${ex.p}` : ''})</span>
  </p>
  {#if yetToBat.length}
    <p class="line"><b>Yet to bat</b> <span class="dim">{yetToBat.join(', ')}</span></p>
  {/if}
  {#if inn.fow.length}
    <p class="line">
      <b>Fall of wickets</b>
      <span class="dim num">
        {inn.fow.map((f) => `${f.runs}-${f.wicket} (${batNames[f.player]}, ${oversText(f.balls)})`).join(' · ')}
      </span>
    </p>
  {/if}

  {#if inn.bowlerOrder.length}
    <table class="bowl">
      <thead>
        <tr><th class="name">Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr>
      </thead>
      <tbody>
        {#each inn.bowlerOrder as p (p)}
          {@const b = inn.bowlers[p]}
          <tr>
            <td class="name"><span class="who">{bowlNames[p]}</span>
              {#if b.wd || b.nb}<span class="how">{[b.wd && `${b.wd} wd`, b.nb && `${b.nb} nb`].filter(Boolean).join(', ')}</span>{/if}
            </td>
            <td class="num">{oversText(b.balls)}</td>
            <td class="num">{b.maidens}</td>
            <td class="num">{b.runs}</td>
            <td class="r num">{b.wickets}</td>
            <td class="num dim">{rate(b.runs, b.balls)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<style>
  .sc {
    background: var(--surface);
    border-top: 4px solid var(--tc);
    border-radius: var(--radius);
    padding: 14px 14px 10px;
    margin-bottom: 14px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  h3 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    line-height: 1.15;
  }

  h3 small {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }

  .total {
    font-family: var(--display);
    font-stretch: condensed;
    font-size: 28px;
    font-weight: 900;
    white-space: nowrap;
  }

  .total span {
    font-size: 15px;
    font-weight: 600;
    color: var(--muted);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 15px;
  }

  table.bowl {
    margin-top: 12px;
  }

  th {
    text-align: right;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--dim);
    padding: 6px 4px;
    border-bottom: 1px solid var(--line);
  }

  td {
    text-align: right;
    padding: 8px 4px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }

  th.name,
  td.name {
    text-align: left;
    padding-left: 0;
    width: 100%;
  }

  .who {
    display: block;
    font-weight: 700;
  }

  .star {
    color: var(--accent-text);
  }

  .how {
    display: block;
    font-size: 13px;
    color: var(--accent-text);
  }

  .how.out {
    color: var(--dim);
  }

  .r {
    font-weight: 800;
  }

  .dim {
    color: var(--muted);
  }

  .line {
    margin: 10px 0 0;
    font-size: 14px;
  }
</style>
