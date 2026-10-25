// Fight statistics for phones: the same values and the same sequence as the strip of the original fight window
// (fightpanel.ts, MS_FIGTR.DLL W_FGT.C), laid out as a large panel instead of the 640×73 strip. Per side: name,
// weapon, rank (FF01_10..21), number of units counting down; per row the two tubes of the original (firepower,
// armour, terrain) as horizontal bars facing each other; at the bottom the total bar.
import type { Assets } from '../assets.ts';
import { el } from '../desktop.ts';
import { CHROMA_SCHEMES } from '../../render/chroma.ts';
import { barHeights, totalBars, type FightPanelHandle, type FightPanelInput, type FightSide } from '../fightpanel.ts';
import { COLORS, setText } from './pixel.ts';

const TICK = 10;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createMobileFightStats(parent: HTMLElement, assets: Assets, inp: FightPanelInput, startDelay: number): FightPanelHandle {
  const pal = assets.palette;
  const colour = (i: number) => `rgb(${pal[i * 3]},${pal[i * 3 + 1]},${pal[i * 3 + 2]})`;
  // brightest shade of the player's colour scheme (the order of the shades differs between the schemes) and a darker one
  const shades = (s: FightSide) => {
    const sorted = [...(CHROMA_SCHEMES[s.scheme] ?? CHROMA_SCHEMES[12])].slice(1)
      .sort((a, b) => pal[b * 3] + pal[b * 3 + 1] + pal[b * 3 + 2] - (pal[a * 3] + pal[a * 3 + 1] + pal[a * 3 + 2]));
    return { light: colour(sorted[0]), dark: colour(sorted[3]) };
  };
  const left = inp.attackerLeft ? inp.attacker : inp.defender;
  const right = inp.attackerLeft ? inp.defender : inp.attacker;

  const box = el('div', 'm-fstats', parent);
  // --- heads: rank, name, weapon, unit count
  const heads = el('div', 'm-fs-heads', box);
  const head = (s: FightSide, side: 'l' | 'r') => {
    const h = el('div', `m-fs-head m-field m-fs-${side}`, heads);
    h.style.borderTop = `4px solid ${shades(s).light}`;
    const top = el('div', 'm-fs-top', h);
    const rank = el('canvas', 'm-fs-rank', top);
    rank.width = 24; rank.height = 24;
    const num = el('div', 'm-fs-count', top);
    const role = el('div', 'm-fs-role', h);
    setText(role, s === inp.attacker ? 'Angreifer' : 'Verteidiger', { color: COLORS.muted, scale: 1.2 });
    setText(el('div', 'm-fs-name', h), s.name, { color: COLORS.white, scale: 1.6, maxWidth: 160 });
    setText(el('div', 'm-fs-weapon', h), s.weapon, { color: COLORS.text, scale: 1.3, maxWidth: 160 });
    const loss = el('div', 'm-fs-loss', h);
    const showRank = (xp: number) => {
      const cx = rank.getContext('2d')!;
      cx.clearRect(0, 0, 24, 24);
      cx.drawImage(assets.canvas('FF000', `FF01_${10 + Math.max(0, Math.min(11, xp))}`), 0, 0);
    };
    const showCount = (n: number, lost: number) => {
      setText(num, String(n), { font: 'large', color: COLORS.accent, scale: 2 });
      setText(loss, lost ? `Verluste ${lost}` : 'keine Verluste', { color: lost ? COLORS.danger : COLORS.muted, scale: 1.3 });
    };
    showRank(s.xpBefore);
    showCount(s.count, 0);
    return { showRank, showCount };
  };
  const hl = head(left, 'l'), hr = head(right, 'r');

  // --- the three pairs of tubes: bars grow outwards from the middle, the larger value fills its half
  const rows = el('div', 'm-fs-rows m-field', box);
  const bars: { el: HTMLElement; target: number }[] = [];
  const row = (labelText: string, pair: [number, number]) => {
    setText(el('div', 'm-fs-label', rows), labelText, { color: COLORS.muted, scale: 1.2 });
    const r = el('div', 'm-fs-row', rows);
    for (const [i, s] of [[0, left], [1, right]] as const) {
      const half = el('div', `m-fs-half m-fs-${i ? 'r' : 'l'}`, r);
      const b = el('div', 'm-fs-bar', half);
      b.style.background = `linear-gradient(${i ? 90 : 270}deg, ${shades(s).dark}, ${shades(s).light})`;
      b.style.width = '0%';
      bars.push({ el: b, target: pair[i] });
    }
  };
  row('Feuerkraft', barHeights(left.firepower, right.firepower));
  row('Panzerung', barHeights(left.armor, right.armor));
  row('Gelände', barHeights(left.ground, right.ground));
  // --- total value: the two bars of the original meet in the middle (lengths 100 ± 10 per lost unit difference)
  setText(el('div', 'm-fs-label', rows), 'Gesamt', { color: COLORS.muted, scale: 1.2 });
  const total = el('div', 'm-fs-total', rows);
  const tl = el('div', 'm-fs-tbar', total), tr = el('div', 'm-fs-tbar m-fs-r', total);
  tl.style.background = shades(left).light; tr.style.background = shades(right).light;
  tl.style.width = tr.style.width = '0%';
  const tb = totalBars(left.losses, right.losses);
  const tsum = Math.max(1, tb.left + tb.right);

  let closed = false;
  const close = () => { if (closed) return; closed = true; box.remove(); };
  const done = (async () => {
    if (startDelay) await sleep(startDelay);
    // same steps as FGT_CalcStatistik: 4 of 31 pixels and 12 pixels of the total bar every 5 ticks
    const cur = bars.map(() => 0);
    let l = 0, r = 0;
    for (;;) {
      if (closed) return;
      let busy = false;
      bars.forEach((b, i) => {
        if (cur[i] < b.target) { cur[i] = Math.min(b.target, cur[i] + 4); b.el.style.width = `${(cur[i] / 31) * 100}%`; }
        if (cur[i] < b.target) busy = true;
      });
      if (l < tb.left) { l = Math.min(tb.left, l + tb.leftSpeed * 12); tl.style.width = `${(l / tsum) * 100}%`; }
      if (r < tb.right) { r = Math.min(tb.right, r + tb.rightSpeed * 12); tr.style.width = `${(r / tsum) * 100}%`; }
      if (!busy && l >= tb.left && r >= tb.right) break;
      await sleep(5 * TICK);
    }
    for (let i = 0; i < Math.max(left.losses, right.losses) && !closed; i++) await sleep(3 * TICK);
    if (closed) return;
    hl.showRank(left.xpAfter);
    hr.showRank(right.xpAfter);
    const a = { n: left.count, lost: 0 }, b = { n: right.count, lost: 0 };
    while (!closed && (a.lost < left.losses || b.lost < right.losses)) {
      if (a.lost < left.losses) { a.n--; a.lost++; hl.showCount(a.n, a.lost); }
      if (b.lost < right.losses) { b.n--; b.lost++; hr.showCount(b.n, b.lost); }
      await sleep(30);
    }
  })();
  return { done, close };
}
