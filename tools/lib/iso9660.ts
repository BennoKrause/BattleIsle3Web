// Minimal ISO 9660 reader (plain 2048-byte sectors, level 1-3 names, no Joliet / Rock Ridge needed): lists directories
// and reads or extracts files of the original CD images without 7-Zip or any other program.
import { closeSync, mkdirSync, openSync, readSync, statSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const SECTOR = 2048;

export interface IsoEntry { name: string; isDir: boolean; size: number; extent: number }

export class Iso {
  readonly path: string;
  private fd: number;
  private root: IsoEntry;
  private cache = new Map<string, IsoEntry[]>();

  constructor(path: string) {
    this.path = path;
    this.fd = openSync(path, 'r');
    const pvd = this.read(16 * SECTOR, SECTOR);
    if (pvd[0] !== 1 || pvd.toString('latin1', 1, 6) !== 'CD001') throw new Error(`${path} is not an ISO 9660 image (cooked 2048-byte sectors expected)`);
    this.root = { name: '', isDir: true, extent: pvd.readUInt32LE(156 + 2), size: pvd.readUInt32LE(156 + 10) };
  }

  close() { closeSync(this.fd); }

  private read(offset: number, length: number): Buffer {
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const n = readSync(this.fd, buf, got, length - got, offset + got);
      if (n <= 0) break;
      got += n;
    }
    return got < length ? buf.subarray(0, got) : buf;
  }

  private entries(dir: IsoEntry): IsoEntry[] {
    const key = `${dir.extent}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const data = this.read(dir.extent * SECTOR, dir.size);
    const out: IsoEntry[] = [];
    let p = 0;
    while (p < data.length) {
      const len = data[p];
      if (len === 0) { p = (Math.floor(p / SECTOR) + 1) * SECTOR; continue; } // records never cross a sector border
      const nameLen = data[p + 32];
      const raw = data.toString('latin1', p + 33, p + 33 + nameLen);
      if (!(nameLen === 1 && (raw === '\0' || raw === '\x01'))) {
        out.push({
          name: raw.replace(/;\d+$/, '').replace(/\.$/, ''),
          isDir: (data[p + 25] & 2) !== 0,
          extent: data.readUInt32LE(p + 2),
          size: data.readUInt32LE(p + 10),
        });
      }
      p += len;
    }
    this.cache.set(key, out);
    return out;
  }

  /** Finds an entry by path (case-insensitive, "/" or "\\" separated); "" is the root. */
  find(path: string): IsoEntry | null {
    let cur = this.root;
    for (const part of path.split(/[\\/]/).filter(Boolean)) {
      if (!cur.isDir) return null;
      const next = this.entries(cur).find((e) => e.name.toLowerCase() === part.toLowerCase());
      if (!next) return null;
      cur = next;
    }
    return cur;
  }

  list(path: string): IsoEntry[] {
    const d = this.find(path);
    return d?.isDir ? this.entries(d) : [];
  }

  exists(path: string) { return this.find(path) !== null; }

  readFile(path: string): Buffer {
    const e = this.find(path);
    if (!e || e.isDir) throw new Error(`${path}: not a file in ${this.path}`);
    return this.read(e.extent * SECTOR, e.size);
  }

  /** Copies a file out of the image in chunks (videos are tens of MB). */
  extract(path: string, dest: string) {
    const e = this.find(path);
    if (!e || e.isDir) throw new Error(`${path}: not a file in ${this.path}`);
    mkdirSync(dirname(dest), { recursive: true });
    const out = openSync(dest, 'w');
    try {
      for (let done = 0; done < e.size; done += 1 << 20) {
        const chunk = this.read(e.extent * SECTOR + done, Math.min(1 << 20, e.size - done));
        writeSync(out, chunk);
      }
    } finally { closeSync(out); }
  }

  size() { return statSync(this.path).size; }
}
