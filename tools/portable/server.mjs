// Web server of the packages (Windows portable and Docker): serves the game and sets itself up on first start.
// No dependencies, runs with the bundled node.exe (or node in the Docker image).
//
//   node server.mjs [CD1.iso CD2.iso] [--port 8765] [--lan] [--no-browser] [--strict-case]
//                   [--data <folder>] [--iso-dir <folder>] [--ffmpeg <path>] [--jobs <n>]
//
// First start: when the game data (gamedata/manifest.json) is missing, the two original CD images are imported
// automatically - converting the videos with FFmpeg - and the game starts afterwards. The images come from, in this order:
//   1. the paths on the command line (drag both .iso files onto BattleIsle3.bat), --cd1/--cd2 or BI3_CD1 / BI3_CD2
//   2. every .iso in --iso-dir / BI3_ISO_DIR, in the folder "iso" next to this file or in /iso (Docker)
//   3. the setup page (opens in the browser): enter the two paths there.
// Order of the images does not matter, they are recognised by their content.
//
//   --lan          listen on all network interfaces (play on a phone in the same Wi-Fi), default: this computer only
//   --strict-case  file names must match upper/lower case exactly, like on Linux (used for tests)
import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
// positional arguments = CD images / folders (everything that is not an option or the value of one)
const valueOptions = new Set(['--port', '--data', '--iso-dir', '--ffmpeg', '--jobs', '--cd1', '--cd2']);
const positional = args.filter((a, i) => !a.startsWith('--') && !valueOptions.has(args[i - 1] ?? ''));

const root = resolve(here, 'app');
const dataDir = resolve(opt('data', process.env.BI3_DATA ?? join(root, 'gamedata')));
const host = flag('lan') ? '0.0.0.0' : '127.0.0.1';
const strict = flag('strict-case');
const isReady = () => existsSync(join(dataDir, 'manifest.json'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.mid': 'audio/midi', '.wav': 'audio/wav',
};

// ------------------------------------------------------------------ first-start setup
const setup = { state: isReady() ? 'done' : 'idle', stage: '', current: 0, total: 0, message: '', error: '' };
let lastLogged = '';

async function importFrom(cd1, cd2) {
  if (setup.state === 'running') return;
  Object.assign(setup, { state: 'running', stage: 'start', current: 0, total: 0, message: 'Einrichtung wird gestartet …', error: '' });
  try {
    const lib = await import(pathToFileURL(join(here, 'import', 'importer.ts')).href);
    const ffmpegDirs = [join(here, 'ffmpeg'), here];
    const ffmpeg = opt('ffmpeg', '') || lib.findFfmpeg(ffmpegDirs);
    if (!ffmpeg) throw new Error('FFmpeg wurde nicht gefunden (wird für die Umwandlung der Videos benötigt).');
    console.log(`Einrichtung: CD 1 = ${cd1}\n             CD 2 = ${cd2}\n             Daten -> ${dataDir}`);
    const r = await lib.importGameData({
      cd1, cd2, out: dataDir, ffmpeg, jobs: Number(opt('jobs', '0')) || undefined,
      onProgress: (p) => {
        Object.assign(setup, { stage: p.stage, current: p.current, total: p.total, message: p.message });
        if (p.message !== lastLogged && (p.stage !== 'videos' || p.current % 10 === 0 || p.current === p.total)) console.log(`  ${p.message}`);
        lastLogged = p.message;
      },
    });
    setup.state = 'done';
    console.log(`Einrichtung abgeschlossen: ${r.files} Dateien, ${r.videos} Videos.`);
  } catch (e) {
    setup.state = 'error';
    setup.error = String(e?.message ?? e);
    console.error(`Einrichtung fehlgeschlagen: ${setup.error}`);
  }
}

/** Looks for the two images in the given paths (files or folders); null if they are not both there. */
async function locate(paths) {
  const lib = await import(pathToFileURL(join(here, 'import', 'importer.ts')).href);
  return lib.pickCds(paths.filter(Boolean).map((p) => resolve(p)));
}

async function autoSetup() {
  if (isReady()) return;
  const explicit = [...positional, opt('cd1', process.env.BI3_CD1 ?? ''), opt('cd2', process.env.BI3_CD2 ?? '')];
  const dirs = [opt('iso-dir', process.env.BI3_ISO_DIR ?? ''), join(here, 'iso'), '/iso'];
  for (const paths of [explicit, dirs]) {
    const found = paths.some(Boolean) ? await locate(paths).catch(() => null) : null;
    if (found) { void importFrom(found.cd1, found.cd2); return; }
  }
  if (explicit.some(Boolean)) { setup.state = 'error'; setup.error = 'Unter den angegebenen Pfaden wurden nicht beide Battle-Isle-3-CDs (CD 1 und CD 2) gefunden.'; }
  console.log('Spieldaten fehlen: bitte die beiden ISO-Dateien angeben (Einrichtungsseite im Browser oder BattleIsle3.bat mit CD1.iso CD2.iso starten).');
}

const SETUP_PAGE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Battle Isle 3 - Einrichtung</title><style>
body{margin:0;min-height:100vh;background:#0b190d;color:#c4e89c;font:16px/1.5 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
main{max-width:640px;width:100%;background:#1c3a22;border:2px solid;border-color:#a8cfa4 #0b1f0d #0b1f0d #a8cfa4;padding:22px}
h1{margin:0 0 6px;color:#ffe433;font-size:24px}p{margin:8px 0}small,.hint{color:#84a967}
label{display:block;margin:14px 0 4px;color:#ffe433}input{width:100%;box-sizing:border-box;min-height:44px;padding:0 10px;font-size:16px;background:#1d4154;color:#e7ffff;border:1px solid #6cb9b3}
button{margin-top:18px;min-height:48px;padding:0 24px;font-size:17px;color:#ffe433;background:#2f6b35;border:2px solid #ffe433;cursor:pointer}
button:disabled{opacity:.4;cursor:default}.bar{height:20px;background:#07141b;border:1px solid #6cb9b3;margin:14px 0 6px}.fill{height:100%;width:0;background:#4cc040;transition:width .3s}
.err{color:#ff7a60;white-space:pre-wrap}.hide{display:none}
</style></head><body><main>
<h1>Battle Isle 3 - Einrichtung</h1>
<p>Beim ersten Start werden die Spieldaten aus Ihren beiden <b>Original-CD-Images</b> übernommen und die Videos umgewandelt. Das dauert je nach Rechner ein bis fünf Minuten und ist nur einmal nötig.</p>
<form id="f"><label for="a">Pfad zum ersten ISO-Image</label><input id="a" placeholder="C:\\Spiele\\BattleIsle3\\CD1.iso" autocomplete="off">
<label for="b">Pfad zum zweiten ISO-Image</label><input id="b" placeholder="C:\\Spiele\\BattleIsle3\\CD2.iso" autocomplete="off">
<p class="hint">Die Reihenfolge ist egal. Statt der Pfade können Sie auch beide .iso-Dateien in den Ordner <b>iso</b> neben dieser Anwendung legen oder auf BattleIsle3.bat ziehen.</p>
<button id="go" type="submit">Einrichtung starten</button></form>
<div id="run" class="hide"><div class="bar"><div class="fill" id="fill"></div></div><p id="msg"></p></div>
<p id="err" class="err"></p>
<p><small>Die Spieldaten sind urheberrechtlich geschützt und bleiben auf diesem Rechner; es wird nichts hochgeladen.</small></p>
</main><script>
const $=(i)=>document.getElementById(i);let timer=0;
async function poll(){const s=await (await fetch('/__setup/status',{cache:'no-store'})).json();
 if(s.state==='done'){location.href='/';return}
 $('f').classList.toggle('hide',s.state==='running');$('run').classList.toggle('hide',s.state!=='running');
 $('fill').style.width=(s.total?Math.round(100*s.current/s.total):3)+'%';$('msg').textContent=s.message;
 if(s.state==='error')$('err').textContent=s.error;
 timer=setTimeout(poll,s.state==='running'?700:2000)}
$('f').addEventListener('submit',async(e)=>{e.preventDefault();$('err').textContent='';
 const r=await fetch('/__setup/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[$('a').value.trim().replace(/^"|"$/g,''),$('b').value.trim().replace(/^"|"$/g,'')]})});
 const j=await r.json().catch(()=>({}));if(!r.ok)$('err').textContent=j.error||'Fehler';clearTimeout(timer);poll()});
poll();
</script></body></html>`;

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function setupApi(req, res, path) {
  if (path === '/__setup/status') return json(res, 200, setup);
  if (path === '/__setup/start' && req.method === 'POST') {
    if (isReady() || setup.state === 'running') return json(res, 409, { error: 'Die Einrichtung läuft oder ist bereits abgeschlossen.' });
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 10000) return json(res, 413, { error: 'zu groß' }); }
    let paths = [];
    try { paths = JSON.parse(body).paths ?? []; } catch { return json(res, 400, { error: 'Ungültige Anfrage.' }); }
    const missing = paths.filter((p) => !p || !existsSync(resolve(p)));
    if (paths.length < 2 || missing.length) return json(res, 400, { error: `Datei nicht gefunden: ${missing.length ? missing.join(', ') : 'bitte beide Pfade angeben'}` });
    const found = await locate(paths).catch(() => null);
    if (!found) return json(res, 400, { error: 'Die angegebenen Dateien sind nicht die beiden Battle-Isle-3-CDs (CD 1 und CD 2 als .iso-Image oder entpackter Ordner).' });
    void importFrom(found.cd1, found.cd2);
    return json(res, 202, setup);
  }
  return json(res, 404, { error: 'unbekannt' });
}

// ------------------------------------------------------------------ static files
const listings = new Map();
/** Resolves `parts` below `base`; in strict mode every segment must exist with exactly this spelling. */
function below(base, parts) {
  if (parts.some((p) => p === '..' || p.includes('\\') || p.includes('\0'))) return null;
  let dir = base;
  for (const part of parts) {
    if (strict) {
      if (!listings.has(dir)) { try { listings.set(dir, new Set(readdirSync(dir))); } catch { return null; } }
      if (!listings.get(dir).has(part)) return null;
    }
    dir = dir + sep + part;
  }
  const full = resolve(dir);
  return full === base || full.startsWith(base + sep) ? full : null;
}

function locateFile(urlPath) {
  const parts = decodeURIComponent(urlPath).split('/').filter(Boolean);
  // the game data lives outside app/ (Docker volume): /gamedata/... is served from the data folder
  return parts[0] === 'gamedata' ? below(dataDir, parts.slice(1)) : below(root, parts);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/__setup/')) return setupApi(req, res, url.pathname);
  // without game data the entry page is the setup page
  if (!isReady() && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(SETUP_PAGE);
    return;
  }
  let file = null, st = null;
  try { file = locateFile(url.pathname === '/' ? '/index.html' : url.pathname); st = file ? statSync(file) : null; } catch { st = null; }
  if (st?.isDirectory()) { file += sep + 'index.html'; try { st = statSync(file); } catch { st = null; } }
  if (!file || !st || !st.isFile() || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
    return;
  }
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': url.pathname.startsWith('/gamedata/') || url.pathname.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    const end = Math.min(range[1] && range[2] ? Number(range[2]) : st.size - 1, st.size - 1);
    if (start < 0 || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).pipe(res);
});

function listen(port, tries) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries > 0) listen(port + 1, tries - 1);
    else { console.error(`Server konnte nicht gestartet werden: ${e.message}`); process.exit(1); }
  });
  server.listen(port, host, () => {
    const local = `http://localhost:${port}/`;
    console.log('Battle Isle 3 - Schatten des Imperators');
    console.log(`  Läuft unter: ${local}`);
    if (host === '0.0.0.0') {
      for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) console.log(`  Im Netzwerk (Handy): http://${a.address}:${port}/`);
    }
    console.log('  Zum Beenden dieses Fenster schließen oder Strg+C drücken.');
    if (!flag('no-browser')) {
      const [cmd, a] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', local]] : process.platform === 'darwin' ? ['open', [local]] : ['xdg-open', [local]];
      try { spawn(cmd, a, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* the address is printed above */ }
    }
    void autoSetup();
  });
}

listen(Number(opt('port', process.env.PORT ?? 8765)), 20);
