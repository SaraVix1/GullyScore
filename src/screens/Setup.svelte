<script>
  import { untrack } from 'svelte';
  import { RULE_DEFAULTS, getState, oversText } from '../lib/engine.js';
  import { randomTeams, randomTeam, inkFor } from '../lib/teams.js';
  import TeamEditor from '../components/TeamEditor.svelte';
  import Badge from '../components/Badge.svelte';

  let { seed = {}, saved = null, onstart, onresume, ondiscard, onhistory, onsettings, onjoin } = $props();

  const s = untrack(() => seed);
  // Continuing with the same teams: each team carries its player names.
  const sameTeams = !!s.teams;
  const keptNames = sameTeams ? s.teams.map((t) => t.players || []) : undefined;
  let teams = $state(s.teams ? s.teams.map(({ name, icon, color }) => ({ name, icon, color })) : randomTeams());
  const renamed = keptNames ? keptNames.flat().filter((n) => n && !/^Player \d+$/.test(n)).length : 0;
  let editing = $state(null);
  let players = $state(s.players ?? 6);
  let overs = $state(s.overs ?? 5);
  let tossWinner = $state(0);
  let tossChoice = $state('bat');
  let rules = $state({ ...RULE_DEFAULTS, ...s.rules });
  let error = $state('');

  const RULES = [
    { key: 'wideRun', label: 'Wide gives a run' },
    { key: 'noBallRun', label: 'No ball gives a run' },
    { key: 'freeHit', label: 'Free hit after a no ball' },
    { key: 'byes', label: 'Byes allowed' },
    { key: 'legByes', label: 'Leg byes allowed' },
    {
      key: 'overthrows',
      label: 'Overthrows allowed',
      on: 'Overthrow button shown; overthrow runs count',
      off: 'No overthrow runs in this match',
    },
    {
      key: 'lastManStands',
      label: 'Last batter can play alone',
      on: 'Innings ends only when every player is out',
      off: 'Innings ends when one batter is left',
    },
  ];

  const savedInfo = $derived.by(() => {
    if (!saved) return null;
    try {
      const st = getState(saved);
      const line = (inn) => ({
        team: saved.teams[inn.battingTeam],
        text: `${saved.teams[inn.battingTeam].name} ${inn.runs}/${inn.wickets} (${oversText(inn.balls)})`,
      });
      return st.result
        ? { done: true, title: st.result.text, lines: st.innings.map(line) }
        : { done: false, title: 'Match in progress', lines: [line(st.cur)] };
    } catch {
      return null;
    }
  });

  const battingFirst = $derived(tossChoice === 'bat' ? tossWinner : 1 - tossWinner);

  function reroll(i) {
    teams[i] = randomTeam(teams[0], teams[1]);
  }

  function step(kind, d) {
    if (kind === 'players') players = Math.max(2, Math.min(11, players + d));
    else overs = Math.max(1, Math.min(50, (Number(overs) || 0) + d));
  }

  function start() {
    const t = teams.map((x) => ({ ...x, name: String(x.name || '').trim() }));
    if (!t[0].name || !t[1].name) return (error = 'Give both teams a name');
    if (t[0].name.toLowerCase() === t[1].name.toLowerCase()) return (error = 'Team names must be different');
    const o = Math.floor(Number(overs));
    if (!o || o < 1 || o > 50) return (error = 'Overs must be between 1 and 50');
    error = '';
    onstart({
      teams: t,
      players,
      overs: o,
      toss: { winner: tossWinner, choice: tossChoice },
      rules: { ...rules },
      names: keptNames,
      // Same two teams as the last match: the new match joins its series.
      series: sameTeams && t.every((x, i) => x.name === s.teams[i].name) ? s.series : undefined,
    });
  }
</script>

<main class="setup">
  <header class="brand">
    <div class="nav">
      <button class="navbtn" onclick={onjoin}>📡 Join live</button>
      <button class="navbtn" onclick={onhistory}>📜 History</button>
      <button class="navbtn" aria-label="Settings" onclick={onsettings}>⚙️</button>
    </div>
    <svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="26" fill="#e8322f" />
      <path d="M16 14c10 8 10 28 0 36M48 14c-10 8-10 28 0 36" stroke="#fff" stroke-width="3" fill="none" stroke-dasharray="4 3" />
    </svg>
    <div>
      <h1>Gully Score</h1>
      <p>Ball-by-ball scoring for street cricket</p>
    </div>
  </header>

  {#if savedInfo}
    <section class="resume" class:done={savedInfo.done}>
      <div>
        <div class="label">{savedInfo.done ? 'Last match' : 'Saved match'}</div>
        <div class="resume-title">{savedInfo.title}</div>
        <div class="resume-line num">
          {#each savedInfo.lines as l, i (i)}<span><Badge team={l.team} size={20} inline />{l.text}</span>{/each}
        </div>
      </div>
      <div class="resume-actions">
        <button class="btn primary" onclick={onresume}>{savedInfo.done ? 'View result' : 'Resume match'}</button>
        <button class="btn ghost" onclick={ondiscard}>Discard</button>
      </div>
    </section>
  {/if}

  <section class="card">
    <div class="label">Teams</div>
    {#each [0, 1] as i (i)}
      {@const t = teams[i]}
      <div class="team-row">
        <button class="team" style="background:{t.color}; color:{inkFor(t.color)}" onclick={() => (editing = i)}>
          <Badge team={t} size={40} />
          <span class="tname">{t.name}</span>
          <span class="tedit" aria-hidden="true">✎</span>
        </button>
        {#if !sameTeams}
          <button class="dice" aria-label="Random name for team {i + 1}" onclick={() => reroll(i)}>🎲</button>
        {/if}
      </div>
    {/each}
    <p class="hint">
      {sameTeams
        ? `Same teams as last match. ${renamed ? `${renamed} renamed ${renamed === 1 ? 'player is' : 'players are'} kept.` : 'Player names are kept too.'}`
        : 'Tap a team to pick another name, type your own, or change its icon and colour.'}
    </p>
  </section>

  <section class="card two">
    <div>
      <div class="label">Players per team</div>
      <div class="stepper">
        <button aria-label="Fewer players" onclick={() => step('players', -1)} disabled={players <= 2}>−</button>
        <span class="num">{players}</span>
        <button aria-label="More players" onclick={() => step('players', 1)} disabled={players >= 11}>+</button>
      </div>
    </div>
    <div>
      <div class="label">Overs per innings</div>
      <div class="stepper">
        <button aria-label="Fewer overs" onclick={() => step('overs', -1)} disabled={overs <= 1}>−</button>
        <input
          class="num"
          type="number"
          inputmode="numeric"
          min="1"
          max="50"
          aria-label="Overs per innings"
          bind:value={overs}
        />
        <button aria-label="More overs" onclick={() => step('overs', 1)} disabled={overs >= 50}>+</button>
      </div>
    </div>
  </section>

  <section class="card">
    <div class="label">Toss won by</div>
    <div class="seg toss">
      {#each [0, 1] as i (i)}
        <button aria-pressed={tossWinner === i} onclick={() => (tossWinner = i)}><Badge team={teams[i]} size={22} inline />{teams[i].name}</button>
      {/each}
    </div>
    <div class="label gap">Chose to</div>
    <div class="seg">
      <button aria-pressed={tossChoice === 'bat'} onclick={() => (tossChoice = 'bat')}>Bat</button>
      <button aria-pressed={tossChoice === 'bowl'} onclick={() => (tossChoice = 'bowl')}>Bowl</button>
    </div>
    <p class="bats-first"><b><Badge team={teams[battingFirst]} size={22} inline />{teams[battingFirst].name}</b> bat first</p>
  </section>

  <section class="card">
    <div class="label">Local rules</div>
    {#each RULES as r (r.key)}
      <button
        class="rule"
        role="switch"
        aria-checked={rules[r.key]}
        onclick={() => (rules[r.key] = !rules[r.key])}
      >
        <span>
          {r.label}
          {#if r.on}<small>{rules[r.key] ? r.on : r.off}</small>{/if}
        </span>
        <span class="switch" aria-hidden="true"><span></span></span>
      </button>
    {/each}
  </section>

  <div class="start">
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="btn primary block big" onclick={start}>Start match</button>
  </div>
</main>

{#if editing != null}
  <TeamEditor
    team={teams[editing]}
    taken={[teams[1 - editing].name]}
    onclose={() => (editing = null)}
    onsave={(t) => {
      teams[editing] = t;
      editing = null;
    }}
  />
{/if}

<style>
  .setup {
    max-width: 560px;
    margin: 0 auto;
    padding: calc(env(safe-area-inset-top) + 18px) var(--gutter) 0;
  }

  .brand {
    position: relative;
    padding-top: 52px;
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 18px;
  }

  .logo {
    width: 52px;
    height: 52px;
    flex: none;
  }

  h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 900;
    letter-spacing: -0.02em;
  }

  .brand p {
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 15px;
  }

  .card {
    background: var(--surface);
    border-radius: var(--radius);
    padding: 16px;
    margin-bottom: 12px;
  }

  .card .label {
    margin-bottom: 10px;
  }

  .label.gap {
    margin-top: 16px;
  }

  .two {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px;
  }

  .two > div {
    display: flex;
    flex-direction: column;
  }

  .two .stepper {
    margin-top: auto;
  }

  .team-row {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }

  .team {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 64px;
    padding: 8px 12px;
    border-radius: var(--radius);
    text-align: left;
  }

  .tname {
    flex: 1;
    min-width: 0;
    font-family: var(--display);
    font-stretch: condensed;
    text-transform: uppercase;
    font-size: clamp(18px, 5.4vw, 23px);
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

  .tedit {
    opacity: 0.65;
    font-size: 18px;
  }

  .nav {
    position: absolute;
    top: 0;
    right: 0;
    display: flex;
    gap: 6px;
  }

  .navbtn {
    min-height: 44px;
    min-width: 44px;
    padding: 0 12px;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-weight: 700;
    font-size: 15px;
  }

  .dice {
    flex: none;
    width: 60px;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: 24px;
  }

  .hint {
    margin: 4px 0 0;
    font-size: 14px;
    color: var(--muted);
  }

  .stepper {
    display: flex;
    align-items: center;
    background: var(--surface-2);
    border-radius: var(--radius);
    height: 56px;
  }

  .stepper button {
    flex: none;
    width: 44px;
    height: 100%;
    font-size: 28px;
    font-weight: 700;
    color: var(--accent-text);
  }

  .stepper span,
  .stepper input {
    flex: 1;
    min-width: 0;
    width: 100%;
    text-align: center;
    font-size: 26px;
    font-weight: 800;
    background: none;
    border: 0;
    padding: 0;
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .stepper input::-webkit-inner-spin-button,
  .stepper input::-webkit-outer-spin-button {
    -webkit-appearance: none;
  }

  .stepper input:focus {
    outline: none;
    color: var(--accent-text);
  }

  .toss button {
    white-space: normal;
    line-height: 1.15;
    padding: 6px 8px;
  }

  .bats-first {
    margin: 14px 0 0;
    color: var(--muted);
  }

  .bats-first b {
    color: var(--accent-text);
  }

  .rule {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 56px;
    padding: 8px 0;
    text-align: left;
    font-weight: 600;
    border-top: 1px solid var(--line);
  }

  .rule:first-of-type {
    border-top: 0;
  }

  .rule small {
    display: block;
    font-weight: 400;
    font-size: 14px;
    color: var(--muted);
    margin-top: 2px;
  }

  .switch {
    flex: none;
    width: 56px;
    height: 32px;
    border-radius: var(--radius);
    background: var(--surface-3);
    position: relative;
    transition: background 0.15s;
  }

  .switch span {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 24px;
    height: 24px;
    border-radius: var(--radius);
    background: var(--muted);
    transition: transform 0.15s, background 0.15s;
  }

  .rule[aria-checked='true'] .switch {
    background: var(--accent);
  }

  .rule[aria-checked='true'] .switch span {
    transform: translateX(24px);
    background: var(--accent-ink);
  }

  .resume {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    margin-bottom: 14px;
    border-radius: var(--radius);
    border: 2px solid var(--accent);
    background: var(--surface);
  }

  .resume.done {
    border-color: var(--line);
  }

  .resume-title {
    font-size: 19px;
    font-weight: 800;
    margin-top: 4px;
  }

  .resume-line {
    color: var(--muted);
    font-size: 15px;
  }

  .resume-line span {
    display: block;
    margin-top: 2px;
  }

  .resume-actions {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 8px;
  }

  .start {
    position: sticky;
    bottom: 0;
    padding: 12px 0 calc(env(safe-area-inset-bottom) + 14px);
    background: linear-gradient(to bottom, transparent, var(--bg) 30%);
  }

  .error {
    margin: 0 0 8px;
    color: var(--red);
    font-weight: 700;
    text-align: center;
  }
</style>
