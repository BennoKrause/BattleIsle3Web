// Dumps the bitmaps of a LIB archive to PNG files for inspection.
// usage: node tools/dump-lib.ts <file.LIB> <outdir> [paletteName=STD] [sheet]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseLib } from '../src/formats/lib.ts';
import { decodeTpwm } from '../src/formats/tpwm.ts';
import { isInfoBitmap, parseInfoBitmap, parseRawSprite, toRgba, type IndexedBitmap } from '../src/formats/bitmap.ts';
import { encodePng } from './lib/png.ts';

const [libPath, outDir, palName = 'STD', mode = ''] = process.argv.slice(2);
const root = join(import.meta.dirname, '..', 'original', 'cd1');
const palettes = parseLib(readFileSync(join(root, 'LIB', 'PALT000.LIB')));
const pal = palettes.find((p) => p.name === palName)?.data;
if (!pal) throw new Error(`palette ${palName} not found; have ${palettes.map((p) => p.name).join(',')}`);

mkdirSync(outDir, { recursive: true });
const entries = parseLib(readFileSync(libPath));
const bitmaps: { name: string; bmp: IndexedBitmap }[] = [];
for (const e of entries) {
  const d = decodeTpwm(e.data);
  if (isInfoBitmap(d)) bitmaps.push({ name: e.name, bmp: parseInfoBitmap(d) });
  else if (d.length === 576) bitmaps.push({ name: e.name, bmp: parseRawSprite(d) });
}

if (mode === 'sheet') {
  const cols = 32;
  const w = 24, h = 24;
  const rows = Math.ceil(bitmaps.length / cols);
  const sheet = new Uint8ClampedArray(cols * w * rows * h * 4);
  bitmaps.forEach(({ bmp }, i) => {
    const rgba = toRgba(bmp, pal);
    const ox = (i % cols) * w, oy = Math.floor(i / cols) * h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y * bmp.width + x) * 4, t = ((oy + y) * cols * w + ox + x) * 4;
      for (let k = 0; k < 4; k++) sheet[t + k] = rgba[s + k];
    }
  });
  writeFileSync(join(outDir, basename(libPath) + '.png'), encodePng(cols * w, rows * h, sheet));
} else {
  for (const { name, bmp } of bitmaps) {
    writeFileSync(join(outDir, `${name.replace(/[^\w-]/g, '_')}.png`), encodePng(bmp.width, bmp.height, toRgba(bmp, pal)));
  }
}
console.log(`${bitmaps.length}/${entries.length} bitmaps written to ${outDir}`);
