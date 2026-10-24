import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLib } from '../src/formats/lib.ts';
import { isModel3D, parseModel3D } from '../src/formats/model3d.ts';
import { parseIffPbm } from '../src/formats/iff.ts';
import { FightAssets, FightScene, Raster, VIEW_H, VIEW_W, environmentFor, shotSample, rigOf, posedVertices } from '../src/render/fight3d.ts';
import { NodeSource } from '../tools/lib/node-source.ts';
import { GAMEDATA_DIR } from '../tools/lib/node-source.ts';
import { hasGameData } from './helpers.ts';

describe('IFF PBM', () => {
  it('decodes ByteRun1 rows', () => {
    // 4x2 image: row 1 = run of 4x 7 (control -3), row 2 = literal 1,2,3,4 (control 3)
    const body = [0xfd, 7, 3, 1, 2, 3, 4];
    const f = (id: string, data: number[]) => [...id].map((c) => c.charCodeAt(0)).concat([0, 0, 0, data.length], data, data.length & 1 ? [0] : []);
    const bmhd = [0, 4, 0, 2, 0, 0, 0, 0, 8, 0, 1, 0, 0, 0, 1, 1, 0, 4, 0, 2];
    const inner = [...'PBM '].map((c) => c.charCodeAt(0)).concat(f('BMHD', bmhd), f('BODY', body));
    const file = new Uint8Array([...'FORM'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, inner.length], inner));
    const img = parseIffPbm(file);
    expect([img.width, img.height]).toEqual([4, 2]);
    expect(Array.from(img.pixels)).toEqual([7, 7, 7, 7, 1, 2, 3, 4]);
  });
});

describe.skipIf(!hasGameData)('3D fight data', () => {
  it('reads every 3DO2 model with valid vertex references', () => {
    let n = 0;
    for (const l of ['UN3D000', 'UN3D001', 'LAND000', 'LAYR000', 'SCHOSS']) {
      for (const e of parseLib(new Uint8Array(readFileSync(join(GAMEDATA_DIR, 'FGT', `${l}.LIB`))))) {
        if (!isModel3D(e.data)) continue;
        const m = parseModel3D(e.data);
        for (const f of m.faces) for (const i of f.vertices) expect(i >= 0 && i < m.vertices.length, `${l}/${e.name}`).toBe(true);
        n++;
      }
    }
    expect(n).toBe(460);
  });

  it('has a model for each of the 64 unit classes and the sample bank', async () => {
    const a = await FightAssets.load(new NodeSource());
    for (let t = 0; t < 64; t++) expect(a.unitModel(t), `UNIT${t}`).not.toBeNull();
    expect(a.wave('FGTSHOOT', 8)?.length).toBeGreaterThan(5000); // 08KAN01.WAV
    expect(a.wave('FGTEXPLO', 0)?.[0]).toBe(0x52); // "RIFF"
    expect(a.texture(7)?.width).toBe(256);
  });

  it('finds turret and barrel of the tank and moves them with the pose', async () => {
    const a = await FightAssets.load(new NodeSource());
    const m = a.unitModel(11)!;
    const rig = rigOf(m);
    expect(rig.barrel?.vertices.length).toBe(10);
    expect(rig.turret?.vertices.length).toBe(26);
    const tip = (pose?: Parameters<typeof posedVertices>[1]) => posedVertices(m, pose)[rig.muzzle];
    expect(tip()[2]).toBeLessThan(-300); // models face -z
    const turned = tip({ turretYaw: Math.PI / 2, barrelPitch: 0, recoil: 0 });
    expect(Math.abs(turned[0])).toBeGreaterThan(400); // the barrel points sideways
    expect(tip({ turretYaw: 0, barrelPitch: 0.5, recoil: 0 })[1]).toBeLessThan(tip()[1] - 100); // raised (y points down)
    expect(tip({ turretYaw: 0, barrelPitch: 0, recoil: 60 })[2]).toBeCloseTo(tip()[2] + 60, 5);
  });

  it('renders a deterministic fight with visible units, fire and explosions', async () => {
    const a = await FightAssets.load(new NodeSource());
    const mk = () => new FightScene(a, {
      attacker: { type: 11, count: 6, losses: 1, scheme: 0, weaponName: 'Kanone' },
      defender: { type: 0, count: 5, losses: 3, scheme: 5, weaponName: 'MG' },
      defenderFiresBack: true, attackerLeft: true, weather: 0, environment: 'grass',
    });
    const scene = mk(), r = new Raster(VIEW_W, VIEW_H);
    expect(scene.duration).toBeGreaterThan(5000); // two volleys
    const frame = (t: number) => { scene.render(t, r); return Uint32Array.from(r.color); };
    const early = frame(700), hit = frame(2500), again = frame(2500);
    expect(again).toEqual(hit); // deterministic
    // the explosion adds bright yellow/orange pixels that the establishing shot does not have
    const bright = (f: Uint32Array) => f.reduce((n, p) => n + ((p & 255) > 230 && ((p >> 8) & 255) > 150 ? 1 : 0), 0);
    expect(bright(hit)).toBeGreaterThan(bright(early) + 200);
    // units are drawn: some pixels differ from a frame without units (rendered at a time before any unit exists is impossible, so compare with the ground colour)
    const dark = early.reduce((n, p) => n + ((p & 255) < 90 && ((p >> 8) & 255) < 90 && ((p >> 16) & 255) < 90 ? 1 : 0), 0);
    expect(dark).toBeGreaterThan(300);
    // sound cues: one shot and one explosion per shooting unit
    expect(scene.sounds.filter((s) => s.lib === 'FGTSHOOT').length).toBe(6 + 2);
  });
});

describe('fight scene helpers', () => {
  it('maps terrain masks and weapon names', () => {
    expect(environmentFor(1 << 16)).toBe('water');
    expect(environmentFor(1 << 10)).toBe('forest');
    expect(environmentFor(1 << 7)).toBe('rock');
    expect(environmentFor(1 << 0)).toBe('road');
    expect(environmentFor(0)).toBe('grass');
    expect(shotSample('9mm-MG')).toBe(4);
    expect(shotSample('Panzerfaust')).toBe(8);
    expect(shotSample('Raketen')).toBe(16);
  });
});
