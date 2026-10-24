import { readFileSync } from 'node:fs';
import { parseLib } from '../../src/formats/lib.ts';
const pal = parseLib(readFileSync('public/gamedata/LIB/PALT000.LIB'))[0].data;
const hex = (i: number) => '#' + [0, 1, 2].map((k) => pal[i * 3 + k].toString(16).padStart(2, '0')).join('');
for (const [a, b] of [[0xd0, 0xd9], [0xe8, 0xf2], [0x68, 0x69], [0xd3, 0xd4]]) console.log(a.toString(16), Array.from({ length: b - a }, (_, i) => hex(a + i)).join(' '));
console.log('pal len', pal.length);
