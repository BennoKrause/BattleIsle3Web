// Access to the imported original game files (public/gamedata/...). The browser fetches them,
// tests and tools read them from disk; both go through this interface.

export interface FileSource {
  read(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}

export class FetchSource implements FileSource {
  private cache = new Map<string, Promise<Uint8Array>>();
  private base: string;
  constructor(base: string) {
    this.base = base;
  }

  read(path: string): Promise<Uint8Array> {
    const key = path.toUpperCase();
    let p = this.cache.get(key);
    if (!p) {
      p = fetch(`${this.base}/${key}`).then(async (r) => {
        if (!r.ok) throw new Error(`cannot load ${key}: HTTP ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      });
      this.cache.set(key, p);
      p.catch(() => this.cache.delete(key));
    }
    return p;
  }

  async exists(path: string): Promise<boolean> {
    const r = await fetch(`${this.base}/${path.toUpperCase()}`, { method: 'HEAD' });
    return r.ok;
  }
}
