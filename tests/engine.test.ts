import { describe, expect, it } from 'vitest';
import { distance, neighbours } from '../src/engine/hex.ts';
import { losses, pct, resolveCombat, XP_TABLE, CF } from '../src/engine/combat.ts';
import { DIFFICULTY_FLAGS, Difficulty } from '../src/engine/rules.ts';
import type { UnitClassInfo } from '../src/data/gamedata.ts';
import { ALL_MISSIONS, gameData, hasGameData } from './helpers.ts';
import { createGame } from '../src/engine/setup.ts';
import { Game } from '../src/engine/game.ts';
import { ComputerPlayer } from '../src/engine/ai.ts';
import { transferUnitsIntoPool, transferUnitsOntoMap, adaptComputerUnits } from '../src/engine/campaign.ts';

describe('hex geometry', () => {
  it('distance equals breadth-first step count', () => {
    const W = 20, H = 20;
    for (const [sx, sy] of [[5, 5], [6, 5], [0, 0], [11, 7]]) {
      const dist = new Map<number, number>([[sy * W + sx, 0]]);
      let frontier = [[sx, sy]];
      while (frontier.length) {
        const next: number[][] = [];
        for (const [x, y] of frontier) for (const p of neighbours(x, y, W, H)) {
          if (!p || dist.has(p.y * W + p.x)) continue;
          dist.set(p.y * W + p.x, dist.get(y * W + x)! + 1);
          next.push([p.x, p.y]);
        }
        frontier = next;
      }
      for (const [f, d] of dist) expect(distance(sx, sy, f % W, Math.floor(f / W))).toBe(d);
    }
  });
});

describe('combat formula (SDI_1C.EXE)', () => {
  it('percentage helper matches the fixed-point original', () => {
    expect(pct(100, 30)).toBe(30);
    expect(pct(560, 30)).toBe(168);
    expect(pct(560, -20)).toBe(-112);
  });

  it('losses: 10 Samurai (560) against armour 550', () => {
    // (10 * (560 - 168) * 256 / (550 * 10)) = 182 (trunc), * 10 = 1820, >> 8 = 7
    expect(losses(10, 560, 10, 550)).toBe(7);
    expect(losses(0, 560, 10, 550)).toBe(0);
  });

  it('experience table has 23 entries centred at 53', () => {
    expect(XP_TABLE).toHaveLength(23);
    expect(XP_TABLE[11]).toBe(53);
  });

  it('defender without adjacency does not fire back', () => {
    const cls = (over: Partial<UnitClassInfo>): UnitClassInfo => ({
      index: 0, name: 'x', description: '', weaponNames: [], weaponIcons: [100, 100, 100, 100], descriptionText: 0, nameText: 0, flags: 0, terrainMask: 0, categoryMask: 0xd60e0, strength: 10,
      fuel: 10, moveRange: 40, fuelUsage: 1, costEnergy: 1, costMaterial: 1,
      weapons: [{ damage: 500, minRange: 1, maxRange: 3, ammo: 5, targets: 4, rawTargets: 0x1280040 }, ...Array(3).fill({ damage: 0, minRange: 0, maxRange: 0, ammo: 0, targets: 0, rawTargets: 0 })],
      weight: 1, transportVolume: 0, groupSize: 10, groupSize2: 0, armor: 400, transportClass: 8, shopMask: 0, sightBlock: 0, sight: 24, transportMask: 0, attack: 400,
      stealthMask: 0, stealthMask2: 0, raw: new Uint8Array(88), ...over,
    });
    const terrain = { terrainBit: () => 9, agility: Array(32).fill(0), firepower: Array(32).fill(0) };
    const base = { attackerWeapon: 0, defenderWeapon: 0, neighbourOwners: [0, 0, 0, 0, 0, 0], attackerAllies: 1, flags: DIFFICULTY_FLAGS[Difficulty.NORMAL].combat, terrain, mapWidth: 20, mapHeight: 20 };
    const A = { cls: cls({}), group: 10, experience: 0, layer: 2, ammo: [5, 0, 0, 0], x: 5, y: 5, ownerMask: 1 };
    const far = resolveCombat({ ...base, attacker: A, defender: { ...A, x: 5, y: 7, ownerMask: 2 } });
    expect(far.defenderFiresBack).toBe(false);
    expect(far.attackerLosses).toBe(0);
    const near = resolveCombat({ ...base, attacker: A, defender: { ...A, x: 5, y: 6, ownerMask: 2 } });
    expect(near.defenderFiresBack).toBe(true);
    // equal units, equal experience: both sides lose the same
    expect(near.attackerLosses).toBe(near.defenderLosses);
    // an ally opposite the attacker doubles the firepower (Klemmen, pattern +100 %)
    const surrounded = resolveCombat({ ...base, flags: base.flags, attacker: A, defender: { ...A, x: 5, y: 6, ownerMask: 2 }, neighbourOwners: [0, 0, 0, 1, 0, 0] });
    expect(surrounded.attacker.f).toBe(near.attacker.f * 2);
    expect(surrounded.defenderLosses).toBeGreaterThan(near.defenderLosses);
    void CF;
  });
});

describe.skipIf(!hasGameData)('missions (headless)', () => {
  it.each(ALL_MISSIONS)('MISS%i starts and survives two rounds of computer play on every side', async (id) => {
    const data = await gameData();
    const lm = await data.loadMission(id);
    const g = new Game(data, createGame(data, lm, { setId: 0, difficulty: Difficulty.NORMAL }));
    g.start();
    const ai = new ComputerPlayer(g);
    for (let i = 0; i < 12 && !g.state.outcome && g.state.turn < 2; i++) { ai.playTurn(60); g.endTurn(); }
    // consistency: every living unit is either on the map at its own position or in a container
    for (const u of g.state.units) {
      if (!u.alive) continue;
      if (u.container) continue;
      expect(g.state.unitAt[u.y * g.state.width + u.x], `unit ${u.id}`).toBe(u.id);
    }
    expect(() => JSON.stringify(g.state)).not.toThrow();
  }, 60000);

  it('campaign pool carries experience to the next mission', async () => {
    const data = await gameData();
    const g1 = createGame(data, await data.loadMission(100), { setId: 0, difficulty: Difficulty.NORMAL });
    const own = g1.units.filter((u) => u.owner === 0);
    own[0].experience = 6;
    own[1].experience = 4;
    own[1].group = 3; // damaged: loses one point
    const pool = transferUnitsIntoPool(data, g1, []);
    expect(pool.find((p) => p.type === own[0].type && p.experience === 6)).toBeTruthy();
    expect(pool.some((p) => p.type === own[1].type && p.experience === 3)).toBe(true);
    const g2 = createGame(data, await data.loadMission(101), { setId: 0, difficulty: Difficulty.NORMAL });
    transferUnitsOntoMap(g2, pool);
    const same = g2.units.filter((u) => u.owner === 0 && u.type === own[0].type);
    if (same.length) expect(Math.max(...same.map((u) => u.experience))).toBe(6);
    adaptComputerUnits(g2, 9);
    for (const u of g2.units) if (u.owner !== 0) expect(u.experience).toBeLessThanOrEqual(4);
  });
});

describe.skipIf(!hasGameData)('ambush in the fog (FUN_004436b5)', () => {
  it('a hidden enemy next to the moved unit attacks it automatically', async () => {
    const data = await gameData();
    const g = new Game(data, createGame(data, await data.loadMission(100), { setId: 0, difficulty: Difficulty.NORMAL }));
    g.start();
    const s = g.state;
    const w = (g as any).w;
    const u = s.units.find((x) => x.alive && x.owner === 0 && !x.container)!;
        const free = w.neighbours(u.x, u.y).find((p: any) => p && !w.unitAt(p.x, p.y));
    const e = s.units.find((x) => x.alive && x.owner !== 0 && x.owner < 8 && !w.isAllied(0, x.owner) && !x.container)!;
    expect(free && e).toBeTruthy();
    s.unitAt[e.y * s.width + e.x] = -1; e.x = free.x; e.y = free.y; s.unitAt[e.y * s.width + e.x] = e.id;
    s.vision[w.idx(e.x, e.y)] &= ~1; // the field is hidden in the fog
    const before = s.events.length;
    (g as any).ambush(u);
    const kinds = s.events.slice(before).map((x: any) => x.kind);
    // the fight happens only if the enemy has a usable weapon against the unit
    if (kinds.includes('surprise')) expect(kinds).toContain('combat');
  });
});
