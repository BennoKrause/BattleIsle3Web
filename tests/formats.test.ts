import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeTpwm, isTpwm } from '../src/formats/tpwm.ts';
import { parseLib } from '../src/formats/lib.ts';
import { parseMission } from '../src/formats/mission.ts';
import { parseUnitClasses } from '../src/formats/unitdef.ts';
import { parseTerrainDefs } from '../src/formats/terraindef.ts';
import { parseCampaignSet } from '../src/formats/campaign.ts';
import { isInfoBitmap, parseInfoBitmap } from '../src/formats/bitmap.ts';
import { ALL_MISSIONS, hasGameData } from './helpers.ts';
import { GAMEDATA_DIR } from '../tools/lib/node-source.ts';

const file = (p: string) => new Uint8Array(readFileSync(join(GAMEDATA_DIR, p)));

describe('TPWM', () => {
  it('decodes literal runs and back references', () => {
    // header, length 6, flag byte 0b00010000 (4th item is a reference), "abc", ref len 3 dist 3
    const data = new Uint8Array([0x54, 0x50, 0x57, 0x4d, 6, 0, 0, 0, 0x10, 97, 98, 99, 0, 3]);
    expect(isTpwm(data)).toBe(true);
    expect(new TextDecoder().decode(decodeTpwm(data))).toBe('abcabc');
  });
});

describe.skipIf(!hasGameData)('original data', () => {
  it('decodes every TPWM file to its declared length', () => {
    let n = 0;
    for (const dir of ['GER', 'ENG', 'MIS']) {
      for (const f of readdirSync(join(GAMEDATA_DIR, dir))) {
        const d = file(`${dir}/${f}`);
        if (!isTpwm(d)) continue;
        const len = new DataView(d.buffer, d.byteOffset).getUint32(4, true);
        // files with an implausible length field are only XOR-obfuscated (BattleIsle2020 DecodeTPWM$)
        expect(decodeTpwm(d).length, f).toBe(len > d.length * 10 ? d.length - 4 : len);
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(15); // 15 TPWM files in GER, ENG, MIS (CD1)
  });

  it('parses every LIB archive and its INFO bitmaps', () => {
    for (const dir of ['LIB', 'UIA', 'FGT']) {
      for (const f of readdirSync(join(GAMEDATA_DIR, dir)).filter((x) => x.endsWith('.LIB'))) {
        const entries = parseLib(file(`${dir}/${f}`));
        expect(entries.length, f).toBeGreaterThan(0);
        for (const e of entries) {
          const d = decodeTpwm(e.data);
          if (isInfoBitmap(d)) {
            const b = parseInfoBitmap(d);
            expect(b.pixels.length).toBe(b.width * b.height);
          }
        }
      }
    }
  });

  it('has 64 unit classes and one terrain record per terrain sprite', () => {
    const units = parseUnitClasses(file('LIB/UNIT000.DAT'));
    expect(units).toHaveLength(64);
    const terrain = parseTerrainDefs(file('LIB/PART000.DAT'));
    expect(terrain).toHaveLength(parseLib(file('LIB/PART000.LIB')).length);
    // spot checks against the manual: Samurai 100mm cannon strength 560 range 1 (tutorial p. 11)
    expect(units[11].weapons[0].damage).toBe(560);
    expect(units[11].weapons[0].maxRange).toBe(1);
  });

  it.each(ALL_MISSIONS)('parses mission MISS%i', (id) => {
    const m = parseMission(file(`MIS/MISS${id}.DAT`));
    expect(m.width * m.height).toBe(m.terrain.length);
    expect(m.units.length).toBeGreaterThan(0);
    for (const s of m.shops) if (s.kind === 1) expect(s.x < m.width && s.y < m.height).toBe(true);
    for (const a of m.actions) expect([0, 48, 80, 208]).toContain(a.category);
    for (const a of m.actions) expect([2, 3, 4, 8, 9, 10]).toContain(a.type);
    expect(m.terrainTables.move).toHaveLength(32);
  });

  it('reads the campaign order from MCP000 and the mission files', () => {
    const set = parseCampaignSet(0, file('MIS/MCP000.DAT'), file('GER/MCP000.TXT'));
    expect(set.missions.map((m) => m.fileId)).toEqual(Array.from({ length: 20 }, (_, i) => 100 + i));
    for (const [i, cm] of set.missions.entries()) {
      const m = parseMission(file(`MIS/MISS${cm.fileId}.DAT`));
      if (i < 19) expect(m.nextMissionRaw - 1).toBe(i + 1);
      else expect(m.nextMissionRaw2).toBe(39);
    }
  });

  it('resolves every campaign video sequence to an existing video file', () => {
    const manifest = JSON.parse(readFileSync(join(GAMEDATA_DIR, 'manifest.json'), 'utf8'));
    for (const id of [0, 1, 2]) {
      const n = String(id).padStart(3, '0');
      const set = parseCampaignSet(id, file(`MIS/MCP${n}.DAT`), file(`GER/MCP${n}.TXT`));
      for (const v of set.videos) expect(manifest.videos[`API${String(v.file).padStart(3, '0')}.mp4`], `MCP${n} seq ${v.id}`).toBeTruthy();
      for (const m of set.missions) for (const seq of m.terminationSeqs.filter((x) => x >= 0)) {
        expect(set.videos.some((v) => v.id === seq), `MCP${n} mission ${m.fileId} seq ${seq}`).toBe(true);
      }
    }
  });
});
