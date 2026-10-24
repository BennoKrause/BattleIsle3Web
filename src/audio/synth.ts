// Sequencer + small built-in Web Audio synthesizer for General MIDI files. No sound font is
// shipped, so timbres are approximations by instrument family (the original used the sound card's
// or Windows' own synthesizer). The song is restarted when it ends, like the original MUS_Handler.
import type { MidiEvent, MidiSong } from './midi.ts';

interface Timbre { wave: OscillatorType; attack: number; decay: number; sustain: number; release: number; detune?: number; lowpass?: number; gain: number }

/** One timbre per GM instrument family (program >> 3). */
const FAMILIES: Timbre[] = [
  { wave: 'triangle', attack: 0.005, decay: 0.4, sustain: 0.3, release: 0.25, gain: 0.9 }, // piano
  { wave: 'sine', attack: 0.002, decay: 0.5, sustain: 0.1, release: 0.4, gain: 0.9 }, // chromatic percussion
  { wave: 'square', attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.1, lowpass: 2500, gain: 0.5 }, // organ
  { wave: 'triangle', attack: 0.003, decay: 0.3, sustain: 0.2, release: 0.15, gain: 0.9 }, // guitar
  { wave: 'sawtooth', attack: 0.005, decay: 0.15, sustain: 0.6, release: 0.1, lowpass: 900, gain: 0.7 }, // bass
  { wave: 'sawtooth', attack: 0.08, decay: 0.2, sustain: 0.8, release: 0.3, detune: 6, lowpass: 3000, gain: 0.45 }, // strings
  { wave: 'sawtooth', attack: 0.06, decay: 0.2, sustain: 0.8, release: 0.25, detune: 8, lowpass: 2200, gain: 0.45 }, // ensemble
  { wave: 'sawtooth', attack: 0.03, decay: 0.15, sustain: 0.7, release: 0.12, lowpass: 2600, gain: 0.5 }, // brass
  { wave: 'square', attack: 0.04, decay: 0.1, sustain: 0.7, release: 0.12, lowpass: 2200, gain: 0.4 }, // reed
  { wave: 'sine', attack: 0.05, decay: 0.1, sustain: 0.8, release: 0.12, gain: 0.9 }, // pipe
  { wave: 'square', attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.1, lowpass: 3500, gain: 0.4 }, // synth lead
  { wave: 'sawtooth', attack: 0.3, decay: 0.3, sustain: 0.8, release: 0.6, detune: 10, lowpass: 1800, gain: 0.4 }, // synth pad
  { wave: 'triangle', attack: 0.2, decay: 0.3, sustain: 0.6, release: 0.5, gain: 0.7 }, // synth fx
  { wave: 'triangle', attack: 0.005, decay: 0.3, sustain: 0.2, release: 0.2, gain: 0.8 }, // ethnic
  { wave: 'sine', attack: 0.002, decay: 0.15, sustain: 0.0, release: 0.1, gain: 0.9 }, // percussive
  { wave: 'sawtooth', attack: 0.1, decay: 0.5, sustain: 0.5, release: 0.5, lowpass: 800, gain: 0.5 }, // sound effects
];

interface Voice { stop: (when: number) => void; note: number; released: boolean }
interface ChannelState { program: number; volume: number; expression: number; pan: number; bend: number; sustain: boolean; held: Voice[] }

export class MidiPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private noise: AudioBuffer | null = null;
  private song: MidiSong | null = null;
  private timer = 0;
  private startTime = 0;
  private cursor = 0;
  private channels: ChannelState[] = [];
  private active = new Set<Voice>();
  private _volume = 0.5;
  playing = false;
  /** Number of notes started (exposed for tests). */
  notesStarted = 0;
  /** Number of times the song restarted after reaching its end. */
  loops = 0;

  get volume() { return this._volume; }
  set volume(v: number) {
    this._volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** Peak sample amplitude (0..1) of the current output block (for tests: proves the synth is not silent). */
  peak(): number {
    if (!this.analyser) return 0;
    const d = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(d);
    let m = 0;
    for (const x of d) m = Math.max(m, Math.abs(x));
    return m;
  }

  get contextState(): string { return this.ctx?.state ?? 'none'; }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    } catch { return null; }
    this.master = this.ctx.createGain();
    this.master.gain.value = this._volume;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    comp.connect(this.analyser);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return this.ctx;
  }

  /** Starts a song from the beginning (the browser keeps the context suspended until a user gesture). */
  play(song: MidiSong) {
    this.stop();
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.song = song;
    this.playing = true;
    this.reset();
    void ctx.resume();
    this.startTime = ctx.currentTime + 0.1;
    this.cursor = 0;
    this.timer = window.setInterval(() => this.pump(), 30);
  }

  stop() {
    window.clearInterval(this.timer);
    this.playing = false;
    this.song = null;
    const ctx = this.ctx;
    if (ctx) for (const v of [...this.active]) v.stop(ctx.currentTime + 0.05);
    this.active.clear();
  }

  /** Resumes a suspended context (call from a user gesture handler). */
  unlock() { void this.ctx?.resume(); }

  private reset() {
    this.channels = Array.from({ length: 16 }, () => ({ program: 0, volume: 100, expression: 127, pan: 64, bend: 0, sustain: false, held: [] }));
  }

  private pump() {
    const ctx = this.ctx, song = this.song;
    if (!ctx || !song) return;
    if (ctx.state !== 'running') {
      // keep the song position while the browser blocks audio
      this.startTime = ctx.currentTime + 0.1 - (this.cursor ? song.events[this.cursor - 1].t : 0);
      return;
    }
    const horizon = ctx.currentTime + 0.25 - this.startTime;
    while (this.cursor < song.events.length && song.events[this.cursor].t <= horizon) {
      const e = song.events[this.cursor++];
      this.handle(e, this.startTime + e.t);
    }
    if (this.cursor >= song.events.length && ctx.currentTime > this.startTime + song.duration + 1.5) {
      // song finished: restart it (the original MUS_Handler reopens the file once it has stopped)
      for (const v of [...this.active]) v.stop(ctx.currentTime);
      this.active.clear();
      this.reset();
      this.cursor = 0;
      this.loops++;
      this.startTime = ctx.currentTime + 0.25;
    }
  }

  private handle(e: MidiEvent, when: number) {
    const ch = this.channels[e.ch];
    switch (e.kind) {
      case 'program': ch.program = e.value; break;
      case 'cc':
        if (e.controller === 7) ch.volume = e.value;
        else if (e.controller === 11) ch.expression = e.value;
        else if (e.controller === 10) ch.pan = e.value;
        else if (e.controller === 64) {
          ch.sustain = e.value >= 64;
          if (!ch.sustain) {
            for (const v of ch.held) if (v.released) v.stop(when);
            ch.held = ch.held.filter((v) => !v.released);
          }
        } else if (e.controller === 120 || e.controller === 123) {
          for (const v of ch.held) v.stop(when);
          ch.held = [];
        }
        break;
      case 'bend': ch.bend = e.value; break;
      case 'on': this.noteOn(e.ch, e.note, e.vel, when); break;
      case 'off': {
        const v = ch.held.find((x) => x.note === e.note && !x.released);
        if (!v) break;
        v.released = true;
        if (!ch.sustain) { v.stop(when); ch.held = ch.held.filter((x) => x !== v); }
        break;
      }
    }
  }

  private noteOn(chIdx: number, note: number, vel: number, when: number) {
    const ctx = this.ctx!, master = this.master!;
    if (this.active.size > 56) return;
    const ch = this.channels[chIdx];
    const level = (vel / 127) * (ch.volume / 127) * (ch.expression / 127) * 0.35;
    const out = ctx.createGain();
    out.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (ch.pan - 64) / 64;
    out.connect(pan).connect(master);
    this.notesStarted++;
    let nodes: AudioScheduledSourceNode[] = [];
    let release = 0.1;
    if (chIdx === 9) {
      nodes = this.drum(note, out, level, when);
      release = 0.05;
    } else {
      const t = FAMILIES[ch.program >> 3];
      release = t.release;
      const freq = 440 * Math.pow(2, (note - 69 + (ch.bend / 8192) * 2) / 12);
      let dest: AudioNode = out;
      if (t.lowpass) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = Math.max(t.lowpass, freq * 2);
        f.connect(out); dest = f;
      }
      for (const det of t.detune ? [-t.detune, t.detune] : [0]) {
        const o = ctx.createOscillator();
        o.type = t.wave; o.frequency.value = freq; o.detune.value = det;
        o.connect(dest); o.start(when);
        nodes.push(o);
      }
      const peak = (level * t.gain) / nodes.length;
      out.gain.setValueAtTime(0, when);
      out.gain.linearRampToValueAtTime(peak, when + t.attack);
      out.gain.setTargetAtTime(peak * t.sustain, when + t.attack, t.decay / 3);
    }
    const voice: Voice = {
      note, released: false,
      stop: (at) => {
        out.gain.cancelScheduledValues(at);
        out.gain.setTargetAtTime(0, at, release / 3);
        for (const n of nodes) { try { n.stop(at + release * 2); } catch { /* already stopped */ } }
        window.setTimeout(() => { this.active.delete(voice); out.disconnect(); }, Math.max(0, at - ctx.currentTime + release * 2 + 0.2) * 1000);
      },
    };
    this.active.add(voice);
    if (chIdx === 9) voice.stop(when + 0.25);
    else ch.held.push(voice);
  }

  /** Simple GM drum kit: kick, snare, hats, toms, cymbals from sine sweeps and filtered noise. */
  private drum(note: number, out: GainNode, level: number, when: number): AudioScheduledSourceNode[] {
    const ctx = this.ctx!;
    const nodes: AudioScheduledSourceNode[] = [];
    const tone = (f0: number, f1: number, dur: number, g: number) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(f1, when + dur);
      const e = ctx.createGain();
      e.gain.setValueAtTime(g, when); e.gain.exponentialRampToValueAtTime(0.001, when + dur);
      o.connect(e).connect(out); o.start(when); nodes.push(o);
    };
    const hiss = (type: BiquadFilterType, freq: number, dur: number, g: number) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq;
      const e = ctx.createGain();
      e.gain.setValueAtTime(g, when); e.gain.exponentialRampToValueAtTime(0.001, when + dur);
      s.connect(f).connect(e).connect(out); s.start(when); nodes.push(s);
    };
    out.gain.setValueAtTime(level * 2.2, when);
    if (note === 35 || note === 36) tone(150, 45, 0.25, 1);
    else if (note === 38 || note === 40) { tone(220, 120, 0.12, 0.5); hiss('highpass', 1500, 0.18, 0.8); }
    else if (note === 37 || note === 39) hiss('bandpass', 1800, 0.08, 1);
    else if (note === 42 || note === 44) hiss('highpass', 7000, 0.05, 0.6);
    else if (note === 46) hiss('highpass', 7000, 0.3, 0.6);
    else if (note >= 41 && note <= 50 && note !== 42 && note !== 44 && note !== 46 && note !== 49) tone(70 + (note - 41) * 22, 40 + (note - 41) * 8, 0.3, 0.9);
    else if (note === 49 || note === 51 || note === 52 || note === 55 || note === 57 || note === 59) hiss('highpass', 5000, 0.9, 0.5);
    else hiss('bandpass', 3000 + (note % 8) * 400, 0.06, 0.5);
    return nodes;
  }
}
