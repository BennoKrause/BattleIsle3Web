import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Iso } from '../lib/iso9660.ts';
const walk = (dir: string, rel = ''): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f), `${rel}${f}/`) : [`${rel}${f}`]));
for (const n of [1, 2]) {
  const iso = new Iso(`iso/Battle Isle 3 - CD${n}.iso`);
  const dir = `original/cd${n}`;
  const files = walk(dir);
  let bad = 0, count = 0;
  const t0 = Date.now();
  for (const f of files) {
    const e = iso.find(f);
    if (!e) { bad++; if (bad < 5) console.log('missing in iso', f); continue; }
    if (e.size !== statSync(join(dir, f)).size) { bad++; if (bad < 5) console.log('size differs', f); continue; }
    if (e.size < 3_000_000) { count++; if (createHash('md5').update(iso.readFile(f)).digest('hex') !== createHash('md5').update(readFileSync(join(dir, f))).digest('hex')) { bad++; console.log('content differs', f); } }
  }
  // files in the ISO that the extracted folder lacks
  const inIso = (d: string): string[] => iso.list(d).flatMap((e) => (e.isDir ? inIso(`${d}${e.name}/`) : [`${d}${e.name}`]));
  const isoFiles = inIso('');
  console.log(`CD${n}: ${files.length} extracted files, ${isoFiles.length} in the image, ${bad} problems, ${count} contents compared, ${Date.now() - t0} ms`);
}
