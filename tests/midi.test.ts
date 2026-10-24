import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseMidi } from '../src/audio/midi.ts';
import { GAMEDATA_DIR } from '../tools/lib/node-source.ts';
import { hasGameData } from './helpers.ts';

describe('MIDI parser', () => {
  it('applies the tempo to note times', () => {
    // format 0, 1 track, 96 ticks/quarter, tempo 500000 us; note on at tick 0, off at tick 96 (= 0.5 s)
    const track = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0, 0x90, 60, 100, 96, 0x80, 60, 0, 0, 0xff, 0x2f, 0];
    const bytes = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length, ...track]);
    const song = parseMidi(bytes);
    expect(song.events.map((e) => e.kind)).toEqual(['on', 'off']);
    expect(song.events[1].t).toBeCloseTo(0.5, 5);
  });

  it.skipIf(!hasGameData)('parses all original MIDI files with a plausible length', () => {
    const dir = join(GAMEDATA_DIR, 'MUS');
    const files = readdirSync(dir).filter((f) => f.endsWith('.MID'));
    expect(files.length).toBeGreaterThanOrEqual(40);
    for (const f of files) {
      const s = parseMidi(new Uint8Array(readFileSync(join(dir, f))));
      expect(s.events.length, f).toBeGreaterThan(10);
      if (!f.endsWith('999.MID')) expect(s.duration, f).toBeGreaterThan(20);
    }
  });
});
