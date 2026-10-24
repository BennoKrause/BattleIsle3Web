// Finds rectangles of the dark-blue text-field colour in a LIB bitmap. usage: node tools/explore/fields.ts <LIB> <bitmap> <x> <y>  (x,y = a pixel inside a field)
import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
import { decodeTpwm } from '../../src/formats/tpwm.ts';
import { parseInfoBitmap } from '../../src/formats/bitmap.ts';
const [lib, name, xs, ys] = process.argv.slice(2);
const b = parseInfoBitmap(decodeTpwm(parseLib(readFileSync(`public/gamedata/LIB/${lib}.LIB`)).find((e) => e.name === name)!.data));
const key = b.pixels[Number(ys) * b.width + Number(xs)];
console.log(name, `${b.width}x${b.height}`, 'field colour index', key);
const seen = new Uint8Array(b.pixels.length);
const boxes: number[][] = [];
for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
  const i = y * b.width + x;
  if (seen[i] || b.pixels[i] !== key) continue;
  let x0 = x, x1 = x, y0 = y, y1 = y, n = 0; const st = [i]; seen[i] = 1;
  while (st.length) { const j = st.pop()!; const jx = j % b.width, jy = (j - jx) / b.width; n++; x0 = Math.min(x0, jx); x1 = Math.max(x1, jx); y0 = Math.min(y0, jy); y1 = Math.max(y1, jy);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = jx + dx, ny = jy + dy; if (nx < 0 || ny < 0 || nx >= b.width || ny >= b.height) continue; const k = ny * b.width + nx; if (!seen[k] && b.pixels[k] === key) { seen[k] = 1; st.push(k); } } }
  if (n >= 30) boxes.push([x0, y0, x1 - x0 + 1, y1 - y0 + 1, n]);
}
console.log(boxes.map((r) => `(${r[0]},${r[1]} ${r[2]}x${r[3]})`).join(' '));
