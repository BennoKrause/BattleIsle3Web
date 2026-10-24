// Sound effects of the fights: the WAV files of FGT/FGTSHOOT.LIB (weapons) and FGT/FGTEXPLO.LIB (explosions).
// Setup menu "Kampflautstärke" 0..7 (manual p. 42).

export class FxPlayer {
  /** 0..1 */
  volume = 1;
  private ctx: AudioContext | null = null;
  private cache = new WeakMap<Uint8Array, Promise<AudioBuffer | null>>();
  /** Number of samples started (exposed for tests). */
  played = 0;

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    } catch { return null; }
    return this.ctx;
  }

  unlock() { void this.ctx?.resume(); }

  async play(wav: Uint8Array | null) {
    if (!wav || this.volume <= 0) return;
    const ctx = this.context();
    if (!ctx) return;
    void ctx.resume();
    let p = this.cache.get(wav);
    if (!p) {
      p = ctx.decodeAudioData(wav.slice().buffer).catch(() => null);
      this.cache.set(wav, p);
    }
    const buf = await p;
    if (!buf || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = this.volume;
    src.connect(g).connect(ctx.destination);
    src.start();
    this.played++;
  }
}
