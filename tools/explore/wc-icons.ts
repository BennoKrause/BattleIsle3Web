import { NodeSource } from '../lib/node-source.ts';
import { textTable } from '../../src/formats/text.ts';
const src = new NodeSource();
const lines = textTable(await src.read('GER/WC000.DAT'));
for (const t of [0, 6, 11, 14, 30, 40, 50]) console.log(t, JSON.stringify(lines.get(t)));
const all = new Set<number>(); for (const [, v] of lines) v.split(':').forEach((p, i) => { if (i % 2 === 0 && /^\d+$/.test(p.trim())) all.add(Number(p)); });
console.log('icon numbers used', [...all].sort((a, b) => a - b).join(','));
