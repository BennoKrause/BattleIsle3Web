// Save games on the server: one JSON file per slot in a folder (shared by server.mjs and the Vite dev server).
//
//   GET    /__saves          [{label, savedAt, mode, setId, fileId} | null, ...] for all slots
//   GET    /__saves/<slot>   the complete save game
//   PUT    /__saves/<slot>   stores a save game (JSON body)
//   DELETE /__saves/<slot>   removes it
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SAVE_SLOTS = 10;
const MAX_SIZE = 50 * 1024 * 1024;

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const file = (dir, slot) => join(dir, `slot-${slot}.json`);

function read(dir, slot) {
  try { return readFileSync(file(dir, slot), 'utf8'); } catch { return null; }
}

/** Handles a request below /__saves; `path` is the URL path. */
export async function savesApi(dir, req, res, path) {
  const m = /^\/__saves(?:\/(\d+))?\/?$/.exec(path);
  if (!m) return send(res, 404, { error: 'unbekannt' });
  if (m[1] === undefined) {
    if (req.method !== 'GET') return send(res, 405, { error: 'nicht erlaubt' });
    const list = Array.from({ length: SAVE_SLOTS }, (_, i) => {
      const raw = read(dir, i);
      if (!raw) return null;
      try {
        const s = JSON.parse(raw);
        return { label: s.label, savedAt: s.savedAt, mode: s.mode, setId: s.setId, fileId: s.fileId };
      } catch { return null; }
    });
    return send(res, 200, list);
  }
  const slot = Number(m[1]);
  if (slot >= SAVE_SLOTS) return send(res, 404, { error: 'unbekannter Platz' });
  if (req.method === 'GET') {
    const raw = read(dir, slot);
    return raw ? send(res, 200, raw) : send(res, 404, { error: 'leer' });
  }
  if (req.method === 'DELETE') {
    rmSync(file(dir, slot), { force: true });
    return send(res, 200, { ok: true });
  }
  if (req.method === 'PUT') {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_SIZE) return send(res, 413, { error: 'zu groß' });
      chunks.push(c);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    try {
      const s = JSON.parse(body);
      if (s?.version !== 1 || !s.state) throw new Error('kein Spielstand');
    } catch { return send(res, 400, { error: 'Ungültiger Spielstand.' }); }
    try {
      mkdirSync(dir, { recursive: true });
      // write and rename: a crash never leaves a half-written save behind
      const tmp = `${file(dir, slot)}.tmp`;
      writeFileSync(tmp, body);
      renameSync(tmp, file(dir, slot));
    } catch (e) { return send(res, 500, { error: String(e?.message ?? e) }); }
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { error: 'nicht erlaubt' });
}
