<script>
  import { untrack } from 'svelte';
  import Sheet from './Sheet.svelte';
  import Badge from './Badge.svelte';
  import { TEAMS, ICONS, COLORS, presetFor, inkFor } from '../lib/teams.js';

  let { team, taken = [], onsave, onclose } = $props();

  let draft = $state(untrack(() => ({ ...team })));
  let error = $state('');

  function choose(t) {
    draft = { ...t };
    error = '';
  }

  function onName(e) {
    draft.name = e.currentTarget.value;
    // Typing a built-in name picks up its icon and colour.
    const p = presetFor(draft.name);
    if (p) draft = { ...p, name: draft.name };
  }

  function save() {
    const name = draft.name.trim().slice(0, 24);
    if (!name) return (error = 'Give the team a name');
    if (taken.some((n) => n.toLowerCase() === name.toLowerCase())) return (error = 'The other team already has that name');
    onsave({ ...draft, name });
  }
</script>

<Sheet title="Edit team" {onclose}>
  <div class="preview" style="background:{draft.color}; color:{inkFor(draft.color)}">
    <Badge team={draft} size={48} />
    <span class="pv-name">{draft.name || 'Team name'}</span>
  </div>

  <div class="label">Type your own name</div>
  <input class="text-input" maxlength="24" aria-label="Team name" value={draft.name} oninput={onName} />
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <div class="label gap">Or pick a name</div>
  <div class="names">
    {#each TEAMS as t (t.name)}
      {@const used = taken.includes(t.name)}
      <button class="name" aria-pressed={draft.name === t.name} disabled={used} onclick={() => choose(t)}>
        <Badge team={t} size={28} />
        <span>{t.name}</span>
      </button>
    {/each}
  </div>

  <div class="label gap">Icon</div>
  <div class="icons">
    {#each ICONS as ic (ic)}
      <button class="icon" aria-label="Icon {ic}" aria-pressed={draft.icon === ic} onclick={() => (draft.icon = ic)}><Badge team={{ icon: ic, color: draft.color }} size={36} /></button>
    {/each}
  </div>

  <div class="label gap">Colour</div>
  <div class="colors">
    {#each COLORS as c (c)}
      <button class="swatch" style="background:{c}" aria-label="Colour {c}" aria-pressed={draft.color === c} onclick={() => (draft.color = c)}></button>
    {/each}
  </div>

  <button class="btn primary block big gap" onclick={save}>Save team</button>
</Sheet>

<style>
  .preview {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-radius: var(--radius);
    margin-bottom: 16px;
  }



  .pv-name {
    font-family: var(--display);
    font-stretch: condensed;
    text-transform: uppercase;
    font-size: 26px;
    font-weight: 900;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .label {
    margin-bottom: 8px;
  }

  .gap {
    margin-top: 18px;
  }

  .error {
    margin: 6px 0 0;
    color: var(--red);
    font-weight: 700;
  }

  .names {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 10px 0 8px;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: 15px;
    font-weight: 700;
    text-align: left;
  }

  .name span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name[aria-pressed='true'] {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .icons {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 6px;
  }

  .icon {
    height: 48px;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: 24px;
  }

  .icon[aria-pressed='true'] {
    box-shadow: inset 0 0 0 3px var(--accent);
  }

  .colors {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
  }

  .swatch {
    aspect-ratio: 1;
    border-radius: 50%;
  }

  .swatch[aria-pressed='true'] {
    box-shadow: 0 0 0 3px var(--bg), 0 0 0 6px var(--text);
  }
</style>
