// Imports the game data from the two original CDs into public/gamedata for the browser build.
//
//   node tools/import-cd.ts [--cd1 <dir|iso>] [--cd2 <dir|iso>] [--out <dir>] [--force] [--no-video] [--jobs n]
//
// Defaults: original/cd1 and original/cd2 (extracted ISOs). .iso files are read directly (no 7-Zip needed). Data files are
// copied unchanged (the browser parses the original formats, graphics included, itself); videos are converted with FFmpeg
// (tools/bin/ffmpeg(.exe) or ffmpeg on PATH or BI3_FFMPEG) from Indeo 3 / MS-RLE AVI to H.264 + AAC MP4.
import { join } from 'node:path';
import { importGameData } from './lib/importer.ts';

const ROOT = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name: string, def: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };

let last = '';
const r = await importGameData({
  cd1: opt('--cd1', join(ROOT, 'original', 'cd1')),
  cd2: opt('--cd2', join(ROOT, 'original', 'cd2')),
  out: opt('--out', join(ROOT, 'public', 'gamedata')),
  ffmpegDirs: [join(ROOT, 'tools', 'bin')],
  force: args.includes('--force'),
  noVideo: args.includes('--no-video'),
  jobs: Number(opt('--jobs', '0')) || undefined,
  onProgress: (p) => { if (p.message !== last && (p.stage !== 'videos' || p.current % 10 === 0 || p.current === p.total)) console.log(p.message); last = p.message; },
});
console.log(`fertig: ${r.files} Dateien, ${r.videos} Videos`);
