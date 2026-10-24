// Fight statistics window ("Schneller Kampf", manual p. 39f): the panel of the 3D fight window without
// the picture window. Reconstructed from MS_FIGTR.DLL (source W_FGT.C): FGT_LoadGraphic loads the 22
// bitmaps of LIB/FF000, FGT_InitStatistik draws the static part, FGT_CalcStatistik grows the bars,
// FGT_InitFlash/FGT_CalcFlash count the unit number down, FGT_DispErfahrung shows the new rank.
// All coordinates, colours and the bar rules are taken from that code; timings are in ticks of 10 ms.
//
// Deviations: the original plays sample 0 at the end (no sound effects yet); the count-down steps are
// slowed to 30 ms so they are visible (the original has no pause there).
import type { Assets } from './assets.ts';
import type { BitmapFont } from './font.ts';
import { el } from './desktop.ts';
import { DESKTOP_H, DESKTOP_W } from './desktop.ts';
import { CHROMA_SCHEMES } from '../render/chroma.ts';

export interface FightSide {
  name: string;
  weapon: string;
  /** Chroma scheme (colours of the player). */
  scheme: number;
  /** Units before the fight and units lost. */
  count: number;
  losses: number;
  /** Raw weapon strength and armour of the unit class (0 -> 1, as in the EXE). */
  firepower: number;
  armor: number;
  /** Product firepower * armour * units after the terrain step (CombatResult.bars[2], struct +0x24). */
  ground: number;
  /** 100 + agility table value of the field (struct +0x30). */
  field: number;
  xpBefore: number;
  xpAfter: number;
}

export interface FightPanelInput {
  attacker: FightSide;
  defender: FightSide;
  /** The viewing player takes the left side; the attacker is left if neither side belongs to the viewer. */
  attackerLeft: boolean;
}

const W = 640, H = 73;
const BAR_X = [285, 295, 310, 320, 335, 345];
const BAR_Y = 19;
const BAR_H = 36;
const LEFT_BAR: [number, number] = [220, 4];
const RIGHT_BAR_END = 419;
const END_MARKER = 0xd3;
const TICK = 10;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Bar height rule of FGT_Fight: the larger value fills the tube (31), the other one proportionally. */
export function barHeights(left: number, right: number): [number, number] {
  const calc = (a: number, b: number) => {
    const v = Math.trunc((31 / a) * b);
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  };
  return left > right ? [31, calc(left, right)] : [calc(right, left), 31];
}

/** Lengths and speeds of the two horizontal bars (total value). */
export function totalBars(leftLosses: number, rightLosses: number) {
  const diff = rightLosses - leftLosses;
  const left = diff * 10 + 100, right = -diff * 10 + 100;
  let leftSpeed = 1, rightSpeed = 1;
  if (left < right) { if (left < -diff * 10 + 50) leftSpeed = 2; }
  else if (right < left && -diff * 10 + 150 < left) rightSpeed = 2;
  return { left, right, leftSpeed, rightSpeed };
}

export interface FightPanelOptions {
  /** Position inside the parent (default: bottom centre of the desktop). */
  left?: number;
  top?: number;
  /** Wait this long before the bars start to grow (the 3D fight calls FGT_CalcStatistik when the hits land). */
  startDelay?: number;
  /** Part of the 3D fight window: no own input handling and no 3 s hold at the end. */
  embedded?: boolean;
}

export interface FightPanelHandle { done: Promise<void>; close(): void }

export function showFightPanel(parent: HTMLElement, assets: Assets, fonts: { small: BitmapFont; large: BitmapFont }, inp: FightPanelInput): Promise<void> {
  return createFightPanel(parent, assets, fonts, inp).done;
}

export function createFightPanel(parent: HTMLElement, assets: Assets, fonts: { small: BitmapFont; large: BitmapFont }, inp: FightPanelInput, opts: FightPanelOptions = {}): FightPanelHandle {
  let closeFn = () => {};
  const done = new Promise<void>((resolve) => {
    const pal = assets.palette;
    const colour = (i: number) => `rgb(${pal[i * 3]},${pal[i * 3 + 1]},${pal[i * 3 + 2]})`;
    const left = inp.attackerLeft ? inp.attacker : inp.defender;
    const right = inp.attackerLeft ? inp.defender : inp.attacker;

    const box = el('div', 'fightpanel', parent, { left: `${opts.left ?? (DESKTOP_W - W) / 2}px`, top: `${opts.top ?? DESKTOP_H - H}px`, width: `${W}px`, height: `${H}px` });
    box.style.zIndex = '4800';
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    box.append(cv);
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // --- bar images FF01_06 (attacker) / FF01_07 (defender): palette 0x80.. / 0xa0.. = player colours
    const barImage = (name: string, first: number, side: FightSide) => {
      const b = assets.bitmap('FF000', name);
      const c = document.createElement('canvas');
      c.width = b.width; c.height = b.height;
      const cx = c.getContext('2d')!, img = cx.createImageData(b.width, b.height);
      const scheme = CHROMA_SCHEMES[side.scheme] ?? CHROMA_SCHEMES[12];
      b.pixels.forEach((v, i) => {
        if (v === b.transparent) return;
        const idx = v >= first && v < first + 32 ? scheme[(v - first) >> 2] : v;
        img.data[i * 4] = pal[idx * 3]; img.data[i * 4 + 1] = pal[idx * 3 + 1]; img.data[i * 4 + 2] = pal[idx * 3 + 2]; img.data[i * 4 + 3] = 255;
      });
      cx.putImageData(img, 0, 0);
      return c;
    };
    const attImg = barImage('FF01_06', 0x80, inp.attacker), defImg = barImage('FF01_07', 0xa0, inp.defender);
    const sideImg = (s: FightSide) => (s === inp.attacker ? attImg : defImg);

    // --- static part (FGT_InitStatistik)
    const put = (name: string, x: number, y: number) => ctx.drawImage(assets.canvas('FF000', name), x, y);
    const text = (c: HTMLCanvasElement, x: number, y: number, w: number) => ctx.drawImage(c, 0, 0, Math.min(c.width, w), c.height, x, y, Math.min(c.width, w), c.height);
    const icon = (side: 'left' | 'right', xp: number) => {
      const x = side === 'left' ? 0x5d : 0x20a;
      ctx.clearRect(x, 0x2c, 24, 24);
      put(`FF01_${10 + Math.max(0, Math.min(11, xp))}`, x, 0x2c);
    };
    const count = (side: 'left' | 'right', n: number) => {
      const x = side === 'left' ? 0x16 : 0x24a;
      ctx.clearRect(x, 0x2e, 32, 16);
      put('FF01_04', x, 0x2e);
      // two characters, the first one a blank for single digits (FGT_InitStatistik)
      const s = n < 10 ? ` ${n}` : `${n}`;
      text(fonts.large.renderPalette(s, pal, 0xd0), x, 0x30, 0x20);
    };
    put('FF00_03', 0, 0);
    icon('left', left.xpBefore);
    icon('right', right.xpBefore);
    put('FF01_00', inp.attackerLeft ? 0x47 : 0x22b, 0x2c);
    // original quirk: both comparisons test the same condition, so the marker only ever appears on the left side
    if (left.field < right.field) put('FF01_01', 0x47, 0x39);
    text(fonts.small.renderPalette(left.name, pal, 0xeb), 0x7f, 0x2c, 0x90);
    text(fonts.small.renderPalette(right.name, pal, 0xeb), 0x170, 0x2c, 0x90);
    text(fonts.small.renderPalette(left.weapon, pal, 0xee), 0x7f, 0x37, 0x90);
    text(fonts.small.renderPalette(right.weapon, pal, 0xee), 0x170, 0x37, 0x90);
    count('left', left.count);
    count('right', right.count);

    // --- bars: [left firepower, right firepower, left armour, right armour, left ground, right ground]
    const fp = barHeights(left.firepower, right.firepower);
    const ar = barHeights(left.armor, right.armor);
    const gr = barHeights(left.ground, right.ground);
    const target = [fp[0], fp[1], ar[0], ar[1], gr[0], gr[1]];
    const current = [0, 0, 0, 0, 0, 0];
    const images = [sideImg(left), sideImg(right), sideImg(left), sideImg(right), sideImg(left), sideImg(right)];
    const tb = totalBars(left.losses, right.losses);
    let hl = 0, hr = 0;
    const hColour = (s: FightSide) => colour((CHROMA_SCHEMES[s.scheme] ?? CHROMA_SCHEMES[12])[6]);

    const growBars = (): boolean => {
      let done = true;
      for (let i = 0; i < 6; i++) {
        if (current[i] < target[i]) {
          current[i] = Math.min(target[i], current[i] + 4);
          ctx.drawImage(images[i], 0, BAR_H - current[i], 8, current[i], BAR_X[i], BAR_Y + BAR_H - current[i], 8, current[i]);
        }
        if (current[i] < target[i]) done = false;
      }
      if (hl < tb.left) {
        hl = Math.min(tb.left, hl + tb.leftSpeed * 12);
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = hColour(left); ctx.fillRect(LEFT_BAR[0], LEFT_BAR[1] + k, Math.max(0, hl - 1), 1);
          ctx.fillStyle = colour(END_MARKER); ctx.fillRect(LEFT_BAR[0] + hl - 1, LEFT_BAR[1] + k, 1, 1);
        }
      }
      if (hr < tb.right) {
        hr = Math.min(tb.right, hr + tb.rightSpeed * 12);
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = colour(END_MARKER); ctx.fillRect(RIGHT_BAR_END - hr, LEFT_BAR[1] + k, 1, 1);
          ctx.fillStyle = hColour(right); ctx.fillRect(RIGHT_BAR_END - hr + 1, LEFT_BAR[1] + k, Math.max(0, hr - 1), 1);
        }
      }
      return done && hl >= tb.left && hr >= tb.right;
    };

    // --- input: ESC or right mouse button closes the window early (manual p. 40)
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      window.removeEventListener('keydown', onKey, true);
      box.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); } };
    closeFn = finish;
    if (!opts.embedded) {
      window.addEventListener('keydown', onKey, true);
      box.addEventListener('contextmenu', (e) => { e.preventDefault(); finish(); });
      box.addEventListener('mousedown', (e) => { e.stopPropagation(); if (e.button === 2) finish(); });
    }

    void (async () => {
      if (opts.startDelay) await sleep(opts.startDelay);
      // bars grow in steps of 4 pixels every 5 ticks (FGT_CalcStatistik(5) / SYSTEM_WaitTicks(5))
      while (!closed && !growBars()) await sleep(5 * TICK);
      // one flash per lost unit, 3 ticks apart (FGT_InitFlash loop), then the new ranks
      const most = Math.max(left.losses, right.losses);
      for (let i = 0; i < most && !closed; i++) await sleep(3 * TICK);
      if (closed) return;
      icon('left', left.xpAfter);
      icon('right', right.xpAfter);
      // the numbers count down, highest lost unit first (FGT_CalcFlash)
      const l = { n: left.count, left: left.losses }, r = { n: right.count, left: right.losses };
      while (!closed && (l.left > 0 || r.left > 0)) {
        for (const [side, which] of [[l, 'left'], [r, 'right']] as const) {
          if (side.left <= 0) continue;
          side.n--; side.left--;
          count(which, side.n);
        }
        await sleep(30);
      }
      if (opts.embedded) return;
      // the window stays for 300 ticks after the animation
      for (let t = 0; t < 300 && !closed; t++) await sleep(TICK);
      finish();
    })();
  });
  return { done, close: () => closeFn() };
}
