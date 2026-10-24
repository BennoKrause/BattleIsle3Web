// Imports the game data of the two original CDs for the browser build. Used by tools/import-cd.ts (command line) and by the
// first-start setup of the Docker and Windows packages (tools/portable/server.mjs).
//
// - the data files (LIB, MIS, GER, ENG, UIA, FGT, MUS) are copied unchanged: the browser reads the original formats itself,
//   including all graphics, palettes, 3D models and sounds, so no graphics conversion is needed;
// - the videos (Indeo 3 / MS-RLE AVI) are converted with FFmpeg to H.264 + AAC MP4, which every current browser plays.
//
// Sources can be .iso images (read directly, no 7-Zip needed) or already extracted folders. Nothing leaves the computer.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { basename, dirname, extname, join } from 'node:path';
import { cpus, tmpdir } from 'node:os';
import { Iso } from './iso9660.ts';

export interface CdSource {
  label: string;
  exists(path: string): boolean;
  /** Names (not paths) in a directory. */
  list(dir: string): string[];
  read(path: string): Buffer;
  copyTo(path: string, dest: string): void;
  close(): void;
}

export function openCd(path: string): CdSource {
  if (statSync(path).isDirectory()) {
    const real = (p: string) => join(path, ...p.split(/[\\/]/).filter(Boolean));
    const find = (p: string): string | null => {
      let cur = path;
      for (const part of p.split(/[\\/]/).filter(Boolean)) {
        const hit = existsSync(cur) && statSync(cur).isDirectory() ? readdirSync(cur).find((f) => f.toLowerCase() === part.toLowerCase()) : undefined;
        if (!hit) return null;
        cur = join(cur, hit);
      }
      return cur;
    };
    return {
      label: path,
      exists: (p) => find(p) !== null,
      list: (d) => { const f = find(d); return f && statSync(f).isDirectory() ? readdirSync(f) : []; },
      read: (p) => readFileSync(find(p) ?? real(p)),
      copyTo: (p, dest) => { mkdirSync(dirname(dest), { recursive: true }); copyFileSync(find(p) ?? real(p), dest); },
      close: () => {},
    };
  }
  if (extname(path).toLowerCase() !== '.iso') throw new Error(`${path}: weder ein Ordner noch eine .iso-Datei`);
  const iso = new Iso(path);
  return {
    label: path,
    exists: (p) => iso.exists(p),
    list: (d) => iso.list(d).map((e) => e.name),
    read: (p) => iso.readFile(p),
    copyTo: (p, dest) => iso.extract(p, dest),
    close: () => iso.close(),
  };
}

/** 1 or 2 for the first / second Battle Isle 3 CD (marker files CD1.ID / CD2.ID in the root), null for anything else. */
export function identifyCd(path: string): 1 | 2 | null {
  let cd: CdSource | null = null;
  try {
    cd = openCd(path);
    return cd.exists('CD1.ID') ? 1 : cd.exists('CD2.ID') ? 2 : null;
  } catch { return null; } finally { cd?.close(); }
}

/** Finds the two CDs among the given paths / folders (order does not matter); folders are searched for .iso files. */
export function pickCds(paths: string[]): { cd1: string; cd2: string } | null {
  const candidates: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory() && !existsSync(join(p, 'CD1.ID')) && !existsSync(join(p, 'CD2.ID'))) {
      for (const f of readdirSync(p)) if (/\.iso$/i.test(f)) candidates.push(join(p, f));
    } else candidates.push(p);
  }
  let cd1 = '', cd2 = '';
  for (const c of candidates) {
    const id = identifyCd(c);
    if (id === 1 && !cd1) cd1 = c;
    if (id === 2 && !cd2) cd2 = c;
  }
  return cd1 && cd2 ? { cd1, cd2 } : null;
}

export function findFfmpeg(extra: string[] = []): string | null {
  const names = process.platform === 'win32' ? ['ffmpeg.exe'] : ['ffmpeg'];
  const fromEnv = process.env.BI3_FFMPEG;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const dir of extra) for (const n of names) if (existsSync(join(dir, n))) return join(dir, n);
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg']);
  return r.status === 0 ? r.stdout.toString().split(/\r?\n/)[0].trim() || null : null;
}

export interface Progress {
  stage: 'start' | 'files' | 'videos' | 'done';
  current: number;
  total: number;
  message: string;
}

export interface ImportOptions {
  cd1: string;
  cd2: string;
  /** Target folder (becomes /gamedata of the web app). */
  out: string;
  ffmpeg?: string | null;
  /** Folders searched for ffmpeg(.exe) before PATH. */
  ffmpegDirs?: string[];
  force?: boolean;
  noVideo?: boolean;
  /** Parallel FFmpeg processes (default: number of CPUs, at most 6). */
  jobs?: number;
  onProgress?: (p: Progress) => void;
}

interface Manifest {
  version: 1;
  files: Record<string, { size: number; sha1: string }>;
  videos: Record<string, { source: string; cd: number; duration: number; width: number; height: number }>;
}

function run(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-10000); });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? -1, stderr }));
  });
}

/** Duration and size of a video from the output of `ffmpeg -i` (no ffprobe needed). */
async function probe(ffmpeg: string, file: string) {
  const { stderr } = await run(ffmpeg, ['-hide_banner', '-i', file]);
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const v = /Video:.*?,\s*(\d{2,5})x(\d{2,5})/.exec(stderr);
  if (!d || !v) throw new Error(`${basename(file)}: Videoinformationen nicht lesbar`);
  return { duration: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]), width: Number(v[1]), height: Number(v[2]) };
}

export async function importGameData(opt: ImportOptions): Promise<{ files: number; videos: number }> {
  const say = (p: Progress) => opt.onProgress?.(p);
  const cd1 = openCd(opt.cd1), cd2 = openCd(opt.cd2);
  const tmp = mkdtempSync(join(tmpdir(), 'bi3-import-'));
  try {
    for (const [cd, id] of [[cd1, 'CD1.ID'], [cd2, 'CD2.ID']] as const) {
      if (!cd.exists(id)) throw new Error(`${cd.label} ist nicht die Battle-Isle-3-${id.slice(0, 3)} (${id} fehlt)`);
    }
    const manifest: Manifest = { version: 1, files: {}, videos: {} };
    mkdirSync(opt.out, { recursive: true });
    // an interrupted import leaves no manifest: the app then shows the setup again and the next run continues
    rmSync(join(opt.out, 'manifest.json'), { force: true });

    // ---- data files
    say({ stage: 'files', current: 0, total: 0, message: 'Spieldateien werden kopiert …' });
    const jobs: { cd: CdSource; dir: string; name: string }[] = [];
    for (const dir of ['LIB', 'MIS', 'GER', 'ENG', 'UIA', 'FGT', 'MUS']) for (const name of cd1.list(dir)) jobs.push({ cd: cd1, dir, name });
    // a few music files exist only on CD 2
    const onCd1 = new Set(cd1.list('MUS').map((n) => n.toUpperCase()));
    for (const name of cd2.list('MUS')) if (!onCd1.has(name.toUpperCase())) jobs.push({ cd: cd2, dir: 'MUS', name });
    let n = 0;
    for (const { cd, dir, name } of jobs) {
      const to = join(opt.out, dir, name.toUpperCase());
      const data = cd.read(`${dir}/${name}`);
      mkdirSync(join(opt.out, dir), { recursive: true });
      if (opt.force || !existsSync(to) || statSync(to).size !== data.length) writeFileSync(to, data);
      manifest.files[`${dir}/${name.toUpperCase()}`] = { size: data.length, sha1: createHash('sha1').update(data).digest('hex') };
      if (++n % 25 === 0) say({ stage: 'files', current: n, total: jobs.length, message: `Spieldateien: ${n} von ${jobs.length}` });
    }
    say({ stage: 'files', current: jobs.length, total: jobs.length, message: `${jobs.length} Spieldateien kopiert` });

    // ---- videos
    let videos = 0;
    if (!opt.noVideo) {
      const ffmpeg = opt.ffmpeg ?? findFfmpeg(opt.ffmpegDirs);
      if (!ffmpeg) throw new Error('FFmpeg nicht gefunden (wird für die Umwandlung der Videos benötigt)');
      const videoOut = join(opt.out, 'video');
      mkdirSync(videoOut, { recursive: true });
      const sources = new Map<string, { cd: CdSource; path: string; n: number }>();
      for (const [cd, num] of [[cd1, 1], [cd2, 2]] as const) {
        for (const f of cd.list('AVI')) if (/\.avi$/i.test(f) && !sources.has(f.toUpperCase())) sources.set(f.toUpperCase(), { cd, path: `AVI/${f}`, n: num });
      }
      if (cd1.exists('SHOW/SHADOW.AVI')) sources.set('SHADOW.AVI', { cd: cd1, path: 'SHOW/SHADOW.AVI', n: 1 });
      const list = [...sources].sort((a, b) => a[0].localeCompare(b[0]));
      let done = 0;
      const convert = async ([name, src]: (typeof list)[number]) => {
        const target = join(videoOut, `${basename(name, '.AVI')}.mp4`);
        if (opt.force || !existsSync(target)) {
          const input = join(tmp, name);
          src.cd.copyTo(src.path, input);
          // yuv420p needs even dimensions (all sources are 320x240 or 640x480); the 1 fps slide shows keep their timing
          const partial = `${target}.part.mp4`;
          const r = await run(ffmpeg, ['-v', 'error', '-y', '-i', input, '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p',
            '-tune', 'animation', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-movflags', '+faststart', partial]);
          rmSync(input, { force: true });
          if (r.code !== 0) throw new Error(`FFmpeg konnte ${name} nicht umwandeln: ${r.stderr.trim().slice(-300)}`);
          rmSync(target, { force: true });
          copyFileSync(partial, target);
          rmSync(partial, { force: true });
        }
        const info = await probe(ffmpeg, target);
        manifest.videos[basename(target)] = { source: name, cd: src.n, ...info };
        say({ stage: 'videos', current: ++done, total: list.length, message: `Video ${done} von ${list.length}: ${name}` });
      };
      say({ stage: 'videos', current: 0, total: list.length, message: 'Videos werden umgewandelt …' });
      let next = 0;
      const workers = Array.from({ length: Math.max(1, Math.min(opt.jobs ?? cpus().length, 6)) }, async () => {
        while (next < list.length) await convert(list[next++]);
      });
      await Promise.all(workers);
      videos = list.length;
    }

    writeFileSync(join(opt.out, 'manifest.json'), JSON.stringify(manifest, null, 1));
    say({ stage: 'done', current: 1, total: 1, message: 'Fertig' });
    return { files: jobs.length, videos };
  } finally {
    cd1.close(); cd2.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
