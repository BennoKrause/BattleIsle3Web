// Standard MIDI File parser (format 0/1). Produces one time-ordered event list with absolute
// times in seconds (tempo changes applied). The original played the files via the Windows MCI
// sequencer (SDI_1C.EXE w_music.c: MUS_OpenMIDIFile).

export type MidiEvent =
  | { t: number; kind: 'on'; ch: number; note: number; vel: number }
  | { t: number; kind: 'off'; ch: number; note: number }
  | { t: number; kind: 'program'; ch: number; value: number }
  | { t: number; kind: 'cc'; ch: number; controller: number; value: number }
  | { t: number; kind: 'bend'; ch: number; value: number };

export interface MidiSong {
  events: MidiEvent[];
  duration: number;
}

interface RawEvent { tick: number; order: number; ev: MidiEvent | { tempo: number } }

export function parseMidi(data: Uint8Array): MidiSong {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (p: number) => String.fromCharCode(data[p], data[p + 1], data[p + 2], data[p + 3]);
  if (tag(0) !== 'MThd') throw new Error('not a MIDI file');
  const headerLen = v.getUint32(4);
  const nTracks = v.getUint16(10);
  const division = v.getUint16(12);
  if (division & 0x8000) throw new Error('SMPTE time division not supported');
  const raw: RawEvent[] = [];
  let pos = 8 + headerLen;
  let order = 0;
  for (let tr = 0; tr < nTracks && pos + 8 <= data.length; tr++) {
    const len = v.getUint32(pos + 4);
    if (tag(pos) !== 'MTrk') { pos += 8 + len; continue; }
    let p = pos + 8;
    const end = Math.min(data.length, p + len);
    let tick = 0, running = 0;
    const varLen = () => { let n = 0, b: number; do { b = data[p++]; n = (n << 7) | (b & 0x7f); } while (b & 0x80 && p < end); return n; };
    while (p < end) {
      tick += varLen();
      let status = data[p];
      if (status < 0x80) status = running; else { p++; if (status < 0xf0) running = status; }
      if (status === 0xff) {
        const type = data[p++];
        const n = varLen();
        if (type === 0x51 && n === 3) raw.push({ tick, order: order++, ev: { tempo: (data[p] << 16) | (data[p + 1] << 8) | data[p + 2] } });
        p += n;
        if (type === 0x2f) break;
      } else if (status === 0xf0 || status === 0xf7) {
        p += varLen();
      } else {
        const ch = status & 15, hi = status & 0xf0;
        const a = data[p++];
        const b = hi === 0xc0 || hi === 0xd0 ? 0 : data[p++];
        const t = 0;
        if (hi === 0x90 && b > 0) raw.push({ tick, order: order++, ev: { t, kind: 'on', ch, note: a, vel: b } });
        else if (hi === 0x80 || hi === 0x90) raw.push({ tick, order: order++, ev: { t, kind: 'off', ch, note: a } });
        else if (hi === 0xc0) raw.push({ tick, order: order++, ev: { t, kind: 'program', ch, value: a } });
        else if (hi === 0xb0) raw.push({ tick, order: order++, ev: { t, kind: 'cc', ch, controller: a, value: b } });
        else if (hi === 0xe0) raw.push({ tick, order: order++, ev: { t, kind: 'bend', ch, value: ((b << 7) | a) - 8192 } });
      }
    }
    pos += 8 + len;
  }
  raw.sort((x, y) => x.tick - y.tick || x.order - y.order);
  const events: MidiEvent[] = [];
  let tempo = 500000, lastTick = 0, time = 0;
  for (const r of raw) {
    time += ((r.tick - lastTick) * tempo) / division / 1e6;
    lastTick = r.tick;
    if ('tempo' in r.ev) tempo = r.ev.tempo;
    else events.push({ ...r.ev, t: time });
  }
  return { events, duration: events.length ? events[events.length - 1].t : 0 };
}
