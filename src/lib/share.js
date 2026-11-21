// Share a scorecard as text or as a PNG drawn on a canvas, via the Web Share
// API (WhatsApp etc). Falls back to the clipboard (text) or a download (image).
import { oversText, howOut, inningsTitle } from './engine.js';
import { inkFor, badgeFor } from './teams.js';

const teamLabel = (m, t) => `${m.teams[t].icon} ${m.teams[t].name}`;
const score = (inn) => `${inn.runs}/${inn.wickets} (${oversText(inn.balls)} ov)`;

function statusLine(m, st) {
  if (st.result) {
    const main = st.result.superOver && st.mainResult ? ` (${st.mainResult.text})` : '';
    return `🏆 *${st.result.text}*${main}`;
  }
  const s = st.cur;
  if (s.target != null) {
    return `🔴 LIVE · ${m.teams[s.battingTeam].name} need ${s.need} from ${s.ballsLeft} balls`;
  }
  return `🔴 LIVE · ${m.teams[s.battingTeam].name} batting`;
}

// Edit log lines, oldest first, for sharing.
function logLines(m) {
  const log = m.log || [];
  const out = [`*Edit log* · ${log.length} ${log.length === 1 ? 'edit' : 'edits'}${log.length ? '' : ' (score exactly as entered)'}`];
  for (const e of log) out.push(`  #${e.n} ${new Date(e.at).toLocaleString()} · ${e.ov} ov · ${e.what} · ${e.from} → ${e.to}`);
  return out;
}

export function scorecardText(m, st, { log = false } = {}) {
  const lines = ['🏏 *Gully Score*'];
  for (const inn of st.innings) {
    const tag = inn.superOver ? ' · Super Over' : '';
    lines.push(`${teamLabel(m, inn.battingTeam)}  ${score(inn)}${tag}`);
  }
  lines.push(statusLine(m, st), '');

  for (const inn of st.innings) {
    const bat = m.names[inn.battingTeam];
    const bowl = m.names[inn.bowlingTeam];
    lines.push(`*${teamLabel(m, inn.battingTeam)}* · ${inningsTitle(m, inn)} · ${score(inn)}`);
    for (const p of inn.order) {
      const b = inn.batters[p];
      const how = howOut(b.out, b.out ? bowl[b.out.bowler] : '');
      const extra = [b.fours && `${b.fours}x4`, b.sixes && `${b.sixes}x6`].filter(Boolean).join(' ');
      lines.push(`  ${bat[p]} ${b.runs} (${b.balls})${extra ? ' ' + extra : ''} · ${how}`);
    }
    const ex = inn.extras;
    lines.push(`  Extras ${inn.extrasTotal} (wd ${ex.wd}, nb ${ex.nb}, b ${ex.b}, lb ${ex.lb}${ex.p ? `, pen ${ex.p}` : ''})`);
    if (inn.fow.length) lines.push(`  FoW ${inn.fow.map((f) => `${f.runs}-${f.wicket}`).join(', ')}`);
    const bowlers = inn.bowlerOrder.map((p) => {
      const b = inn.bowlers[p];
      return `${bowl[p]} ${oversText(b.balls)}-${b.maidens}-${b.runs}-${b.wickets}`;
    });
    if (bowlers.length) lines.push(`  Bowling: ${bowlers.join(' · ')}`);
    lines.push('');
  }
  if (log) lines.push(...logLines(m));
  return lines.join('\n').trim();
}

// ---------- image ----------

const W = 1080;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

export function scorecardImage(m, st, { log = false } = {}) {
  const blocks = st.innings.map((inn) => {
    const top = [...inn.order].sort((a, b) => inn.batters[b].runs - inn.batters[a].runs).slice(0, 3);
    const bowl = [...inn.bowlerOrder]
      .sort((a, b) => inn.bowlers[b].wickets - inn.bowlers[a].wickets || inn.bowlers[a].runs - inn.bowlers[b].runs)
      .slice(0, 2);
    return { inn, top, bowl, h: 150 + (top.length + bowl.length) * 52 + 30 };
  });
  const entries = log ? (m.log || []).slice(-8).reverse() : [];
  const logH = log ? 90 + Math.max(1, entries.length) * 46 + 24 : 0;
  const H = 300 + blocks.reduce((s, b) => s + b.h + 24, 0) + logH + 60;

  // Team emoji in its round contrasting badge, as in the app.
  const badge = (team, cx, cy, r) => {
    const b = badgeFor(team.color);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = b.bg;
    ctx.fill();
    ctx.lineWidth = Math.max(3, r * 0.12);
    ctx.strokeStyle = b.ring;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(r * 1.1)}px ${FONT}`;
    ctx.fillStyle = '#000';
    ctx.fillText(team.icon, cx, cy + r * 0.06);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  };

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#040817';
  ctx.fillRect(0, 0, W, H);

  // header
  const win = st.result && st.result.winner != null ? m.teams[st.result.winner] : null;
  const hc = win ? win.color : '#2dd4bf';
  ctx.fillStyle = hc;
  roundRect(ctx, 40, 40, W - 80, 220, 8);
  ctx.fill();
  ctx.fillStyle = inkFor(hc);
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText('🏏 GULLY SCORE', 80, 105);
  ctx.font = `900 58px ${FONT}`;
  const head = st.result ? st.result.text : `🔴 Live: ${m.teams[st.cur.battingTeam].name}`;
  if (win) {
    badge(win, 116, 160, 36);
    ctx.fillStyle = inkFor(hc);
    ctx.font = `900 58px ${FONT}`;
    ctx.fillText(fit(ctx, head, W - 240), 170, 180);
  } else ctx.fillText(fit(ctx, head, W - 160), 80, 180);
  ctx.font = `600 32px ${FONT}`;
  const sub = st.result ? (st.result.superOver ? st.mainResult?.text || '' : st.result.detail) : statusLine(m, st).replace('🔴 LIVE · ', '');
  ctx.fillText(fit(ctx, sub, W - 160), 80, 230);

  let y = 300;
  for (const { inn, top, bowl, h } of blocks) {
    const team = m.teams[inn.battingTeam];
    ctx.fillStyle = '#0b1430';
    roundRect(ctx, 40, y, W - 80, h, 8);
    ctx.fill();
    ctx.fillStyle = team.color;
    roundRect(ctx, 40, y, W - 80, 110, 8);
    ctx.fill();
    ctx.fillRect(40, y + 80, W - 80, 30);
    badge(team, 106, y + 55, 34);
    ctx.fillStyle = inkFor(team.color);
    ctx.font = `900 44px ${FONT}`;
    ctx.fillText(fit(ctx, team.name, 560), 158, y + 72);
    ctx.textAlign = 'right';
    ctx.font = `900 56px ${FONT}`;
    ctx.fillText(`${inn.runs}/${inn.wickets}`, W - 76, y + 74);
    ctx.textAlign = 'left';
    ctx.font = `600 28px ${FONT}`;
    ctx.fillStyle = '#b8c4e8';
    ctx.fillText(`${inningsTitle(m, inn)} · ${oversText(inn.balls)} overs · extras ${inn.extrasTotal}`, 76, y + 150);

    let ry = y + 205;
    const row = (left, right, color = '#ffffff') => {
      ctx.fillStyle = color;
      ctx.font = `700 34px ${FONT}`;
      ctx.fillText(fit(ctx, left, 640), 76, ry);
      ctx.textAlign = 'right';
      ctx.fillText(right, W - 76, ry);
      ctx.textAlign = 'left';
      ry += 52;
    };
    for (const p of top) {
      const b = inn.batters[p];
      row(`🏏 ${m.names[inn.battingTeam][p]}${b.out ? '' : '*'}`, `${b.runs} (${b.balls})`);
    }
    for (const p of bowl) {
      const b = inn.bowlers[p];
      row(`🎯 ${m.names[inn.bowlingTeam][p]}`, `${b.wickets}-${b.runs} (${oversText(b.balls)})`, '#2dd4bf');
    }
    y += h + 24;
  }
  if (log) {
    const all = m.log || [];
    ctx.fillStyle = '#0b1430';
    roundRect(ctx, 40, y, W - 80, logH, 8);
    ctx.fill();
    ctx.fillStyle = '#ffb000';
    ctx.font = `900 34px ${FONT}`;
    ctx.fillText(`EDIT LOG · ${all.length} ${all.length === 1 ? 'edit' : 'edits'}`, 76, y + 56);
    let ly = y + 106;
    ctx.font = `600 26px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    if (!entries.length) ctx.fillText('No edits: score exactly as entered', 76, ly);
    for (const e of entries) {
      ctx.fillText(fit(ctx, `#${e.n} ${e.ov} ov · ${e.what}`, 700), 76, ly);
      ctx.textAlign = 'right';
      ctx.fillText(`${e.from} → ${e.to}`, W - 76, ly);
      ctx.textAlign = 'left';
      ly += 46;
    }
    y += logH + 24;
  }
  ctx.fillStyle = '#8090bb';
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText(new Date(m.created).toLocaleDateString(), 50, H - 30);

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

// ---------- delivery ----------

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

const cancelled = (e) => e && e.name === 'AbortError';

// Returns 'shared' | 'copied' | 'downloaded' | 'cancelled'.
export async function shareText(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (e) {
      if (cancelled(e)) return 'cancelled';
    }
  }
  await copy(text);
  return 'copied';
}

export async function shareImage(blob, text) {
  const file = new File([blob], 'gully-score.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if (cancelled(e)) return 'cancelled';
    }
  }
  downloadBlob(blob, 'gully-score.png');
  return 'downloaded';
}
