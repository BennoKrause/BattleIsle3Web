// Builds distributable packages into dist/:
//   dist/docker/            Dockerfile + docker-compose.yml (Node server, FFmpeg, importer, built game)
//   dist/windows-portable/  BattleIsle3.bat + node.exe + ffmpeg.exe + server.mjs + importer + the built game
//
//   node tools/build-dist.ts [--target docker|portable|all] [--zip] [--ffmpeg <path to ffmpeg.exe>] [--node-exe <path to node.exe>] [--with-data]
//
// The packages contain NO game data (it is copyrighted). On the first start the two original CD images are handed over
// (see README.txt of each package) and the set-up imports the data and converts the videos automatically (tools/lib/importer.ts).
// --with-data additionally packs an already imported public/gamedata (for your own tests; do not pass such packages on).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (n: string, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const target = opt('target', 'all');
const withData = args.includes('--with-data');
const zip = args.includes('--zip');
const dist = join(root, 'dist');
const web = join(dist, '.web');
const log = (m: string) => console.log(`\n== ${m}`);

if (!['docker', 'portable', 'all'].includes(target)) throw new Error(`unknown --target ${target} (docker | portable | all)`);

function run(cmd: string, a: string[], env: Record<string, string> = {}) {
  const r = spawnSync(cmd, a, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(' ')} failed (${r.status})`);
}

const size = (p: string): number => {
  const st = statSync(p);
  return st.isDirectory() ? readdirSync(p).reduce((n, f) => n + size(join(p, f)), 0) : st.size;
};
const mb = (p: string) => `${(size(p) / 1048576).toFixed(1)} MB`;
const crlf = (lines: string[]) => lines.join('\r\n') + '\r\n';

// ------------------------------------------------------------------ 1. build the web app (without gamedata)
log('Typecheck');
run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
log('Vite build');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', web, '--emptyOutDir'], { BI3_NO_PUBLIC: '1' });
if (!existsSync(join(web, 'index.html'))) throw new Error('vite build produced no index.html');

const gamedata = join(root, 'public', 'gamedata');
if (withData && !existsSync(join(gamedata, 'manifest.json'))) throw new Error('--with-data: public/gamedata fehlt (npm run import-cd)');

/** Server, importer and the built game: the part both packages share. */
function copyCommon(out: string) {
  cpSync(web, join(out, 'app'), { recursive: true });
  cpSync(join(root, 'tools/portable/server.mjs'), join(out, 'server.mjs'));
  // the importer is plain TypeScript without dependencies; Node runs it directly (type stripping)
  mkdirSync(join(out, 'import'), { recursive: true });
  for (const f of ['importer.ts', 'iso9660.ts']) cpSync(join(root, 'tools/lib', f), join(out, 'import', f));
}

// ------------------------------------------------------------------ 2. docker
function buildDocker() {
  log('Docker package');
  const out = join(dist, 'docker');
  mkdirSync(out, { recursive: true });
  copyCommon(out);
  mkdirSync(join(out, 'iso'), { recursive: true });
  writeFileSync(join(out, 'iso', 'HIER_DIE_BEIDEN_ISO_DATEIEN_ABLEGEN.txt'), crlf(['Die beiden Original-CD-Images (.iso) von Battle Isle 3 in diesen Ordner legen (Dateinamen egal, Reihenfolge egal).']));
  if (withData) cpSync(gamedata, join(out, 'gamedata'), { recursive: true });
  else mkdirSync(join(out, 'gamedata'), { recursive: true });
  writeFileSync(join(out, 'Dockerfile'), [
    'FROM node:24-alpine',
    '# FFmpeg converts the videos of the original CDs during the first start',
    'RUN apk add --no-cache ffmpeg',
    'WORKDIR /srv',
    'COPY server.mjs ./',
    'COPY import/ ./import/',
    'COPY app/ ./app/',
    'ENV BI3_DATA=/data BI3_ISO_DIR=/iso',
    'EXPOSE 8080',
    '# without game data in /data the server imports the .iso images found in /iso, then serves the game',
    'CMD ["node", "server.mjs", "--lan", "--no-browser", "--port", "8080"]',
    '',
  ].join('\n'));
  writeFileSync(join(out, 'docker-compose.yml'), [
    'services:',
    '  battleisle3:',
    '    build: .',
    '    image: battleisle3:latest',
    '    container_name: battleisle3',
    '    ports:',
    '      - "${BI3_PORT:-8080}:8080"',
    '    volumes:',
    '      # imported game data (created by the first start, survives container updates)',
    '      - ./gamedata:/data',
    '      # the two original CD images (.iso); only read during the first start',
    '      - ${BI3_ISO_DIR:-./iso}:/iso:ro',
    '    restart: unless-stopped',
    '',
  ].join('\n'));
  writeFileSync(join(out, '.dockerignore'), 'gamedata\niso\n');
  writeFileSync(join(out, 'README.txt'), crlf([
    'Battle Isle 3 - Schatten des Imperators (Docker)',
    '',
    'Erster Start:',
    '  1. Die beiden Original-CD-Images (.iso) in den Ordner "iso" legen',
    '     (oder einen anderen Ordner mit den Images angeben:  BI3_ISO_DIR=/pfad/zu/den/isos docker compose up -d --build).',
    '  2. docker compose up -d --build',
    '  3. http://localhost:8080 öffnen. Dort läuft die automatische Einrichtung (Fortschrittsanzeige): Die Spieldaten werden',
    '     übernommen und die Videos umgewandelt, ca. 1-5 Minuten. Danach startet das Spiel.',
    '',
    'Weitere Starts: docker compose up -d   (die Images werden nicht mehr gebraucht, die Daten liegen im Ordner "gamedata").',
    'Beenden: docker compose down. Anderer Port: BI3_PORT=9000 docker compose up -d',
    'Neu einrichten: Ordner "gamedata" leeren und den Container neu starten.',
    '',
    'Die Spieldaten stammen aus Ihren eigenen Original-CDs und sind urheberrechtlich geschützt: Ordner "gamedata" nicht weitergeben.',
    'Auf dem Handy: http://<IP des Rechners>:8080 im selben WLAN öffnen (die Handy-Oberfläche wird automatisch gewählt).',
  ]));
  console.log(`  dist/docker  (${mb(out)})`);
}

// ------------------------------------------------------------------ 3. windows portable
function buildPortable() {
  log('Windows portable package');
  const out = join(dist, 'windows-portable');
  mkdirSync(out, { recursive: true });
  copyCommon(out);
  if (withData) cpSync(gamedata, join(out, 'app', 'gamedata'), { recursive: true });
  // runtimes travel with the package: no installation, no PATH, no admin rights
  const nodeExe = opt('node-exe') || (process.platform === 'win32' ? process.execPath : '');
  if (!nodeExe || !existsSync(nodeExe)) throw new Error('node.exe nicht gefunden: unter Windows bauen oder --node-exe <Pfad> angeben');
  cpSync(nodeExe, join(out, 'node.exe'));
  const ffmpeg = opt('ffmpeg') || join(root, 'tools', 'bin', 'ffmpeg.exe');
  if (!existsSync(ffmpeg)) throw new Error(`ffmpeg.exe nicht gefunden (${ffmpeg}): --ffmpeg <Pfad> angeben (Windows-Build von ffmpeg.org mit libx264)`);
  mkdirSync(join(out, 'ffmpeg'), { recursive: true });
  cpSync(ffmpeg, join(out, 'ffmpeg', 'ffmpeg.exe'));
  mkdirSync(join(out, 'iso'), { recursive: true });
  writeFileSync(join(out, 'iso', 'HIER_DIE_BEIDEN_ISO_DATEIEN_ABLEGEN.txt'), crlf(['Die beiden Original-CD-Images (.iso) von Battle Isle 3 in diesen Ordner legen (optional, Dateinamen und Reihenfolge egal).']));
  const bat = (extra: string, title: string) => crlf(['@echo off', 'chcp 65001 >nul', `title ${title}`, 'cd /d "%~dp0"', `"%~dp0node.exe" "%~dp0server.mjs" ${extra}%*`, 'if errorlevel 1 pause']);
  writeFileSync(join(out, 'BattleIsle3.bat'), bat('', 'Battle Isle 3'));
  writeFileSync(join(out, 'BattleIsle3-Netzwerk.bat'), bat('--lan ', 'Battle Isle 3 (Netzwerk)'));
  writeFileSync(join(out, 'README.txt'), crlf([
    'Battle Isle 3 - Schatten des Imperators (portable, Windows)',
    '',
    'Erster Start (einmalig, ca. 1-5 Minuten):',
    '  Die beiden Original-CD-Images (.iso) auf BattleIsle3.bat ZIEHEN (beide zusammen markieren und auf die Datei fallen lassen).',
    '  Alternativ: die beiden .iso-Dateien in den Ordner "iso" legen und BattleIsle3.bat doppelklicken,',
    '  oder BattleIsle3.bat doppelklicken und die beiden Pfade auf der Einrichtungsseite im Browser eintragen.',
    '  Die Spieldaten werden übernommen und alle Videos automatisch umgewandelt (Fortschrittsanzeige im Browser). Danach startet das Spiel.',
    '',
    'Weitere Starts: BattleIsle3.bat doppelklicken. Der Browser öffnet sich mit dem Spiel (http://localhost:8765).',
    'Beenden:  das schwarze Konsolenfenster schließen.',
    'Handy:    BattleIsle3-Netzwerk.bat starten; die angezeigte Adresse (http://<IP>:8765) im Handy-Browser im selben WLAN öffnen.',
    '          Windows fragt dabei einmalig nach der Firewall-Freigabe.',
    '',
    'Es muss nichts installiert werden: node.exe (Laufzeit) und ffmpeg\\ffmpeg.exe (Videoumwandlung) liegen in diesem Ordner.',
    'Der Ordner kann verschoben oder auf einen USB-Stick kopiert werden. Gespeichert wird im Browser (Einstellungen, Spielstände).',
    'Neu einrichten: Ordner app\\gamedata löschen und BattleIsle3.bat erneut mit den ISO-Images starten.',
    'Die Spieldaten (app\\gamedata) stammen aus Ihren eigenen Original-CDs und sind urheberrechtlich geschützt: nicht weitergeben.',
    'FFmpeg ist freie Software (GPL, https://ffmpeg.org); der Quelltext ist dort erhältlich.',
  ]));
  console.log(`  dist/windows-portable  (${mb(out)})`);
  if (zip) {
    log('Zip');
    const zipFile = join(dist, 'BattleIsle3-windows-portable.zip');
    // Windows ships bsdtar (can write zip); a GNU tar earlier in PATH (Git for Windows) cannot
    const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const r = spawnSync(tar, ['-a', '-c', '-f', zipFile, '-C', dist, 'windows-portable'], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('zip (tar) failed');
    console.log(`  ${zipFile}  (${mb(zipFile)})`);
  }
}

if (target === 'docker' || target === 'all') buildDocker();
if (target === 'portable' || target === 'all') buildPortable();
rmSync(web, { recursive: true, force: true });
console.log(`\nFertig: ${dist}${withData ? '  (MIT Spieldaten: nicht weitergeben)' : '  (ohne Spieldaten)'}`);
