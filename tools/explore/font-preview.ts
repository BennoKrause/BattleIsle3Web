// Renders sample text of the fonts (original vs thinned) to a PNG. usage: node tools/explore/font-preview.ts <out.png>
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm } from '../../src/formats/tpwm.ts';
import { parseInfoBitmap } from '../../src/formats/bitmap.ts';
import { thinGlyph } from '../../src/ui/font.ts';
import { encodePng } from '../lib/png.ts';
const S = 3;
const sample = ['Neue Kampagne starten', 'Einzelne Karte, Spiel laden', 'GOLEM SCHW. K.ROBOTER 0123456789'];
const rows: { lib: string; thin: boolean; text: string }[] = [];
for (const lib of ['CHAR009', 'CHAR012']) for (const thin of [false, true]) for (const text of sample.slice(0, 2)) rows.push({ lib, thin, text });
const W = 330 * S, H = rows.length * 16 * S;
const rgba = new Uint8Array(W * H * 4).fill(25); for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
const fonts: Record<string, Map<number, { w: number; h: number; p: Uint8Array }>> = {};
for (const lib of ['CHAR009', 'CHAR012']) fonts[lib] = new Map(parseLib(readFileSync(`public/gamedata/LIB/${lib}.LIB`)).map((e) => { const b = parseInfoBitmap(decodeTpwm(e.data)); return [e.name.charCodeAt(0), { w: b.width, h: b.height, p: b.pixels }]; }));
rows.forEach((r, ri) => {
  let x0 = 4;
  for (const ch of r.text) {
    const g = fonts[r.lib].get(ch.charCodeAt(0)); if (!g) { x0 += 9; continue; }
    const px = r.thin ? thinGlyph(g.p, g.w, g.h, r.lib === 'CHAR012' ? 1 : 1) : g.p;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (px[y * g.w + x] !== 255) for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) { const o = (((ri * 16 + y) * S + dy) * W + (x0 + x) * S + dx) * 4; rgba[o] = 196; rgba[o + 1] = 232; rgba[o + 2] = 156; }
    x0 += g.w;
  }
});
writeFileSync(process.argv[2], encodePng(W, H, rgba));
