// Supply, repair, construction and height changes (src/engine/support.ts) with the original unit classes.
import { describe, expect, it } from 'vitest';
import { gameData, hasGameData } from './helpers.ts';
import { createGame, createUnit } from '../src/engine/setup.ts';
import { Game } from '../src/engine/game.ts';
import { Layer, UnitFlag } from '../src/engine/state.ts';
import { Build, fieldBuildOptions } from '../src/engine/support.ts';

const SINUS = 2, ALGOL = 18, PLANUM = 0, UHU = 31, NAUTILUS = 46, GOLEM = 14;

/**
 * Mission 100 with the given units placed for player 0 on a field and its neighbours (first field: next to the first
 * unit of player 0, or the first field matching `where`); units standing there are removed.
 */
async function arena(types: number[], where?: (g: Game, x: number, y: number) => boolean, mission = 100) {
  const data = await gameData();
  const state = createGame(data, await data.loadMission(mission), { setId: 0, difficulty: 1 });
  const g = new Game(data, state);
  g.start();
  let at = { x: 0, y: 0 };
  if (where) {
    outer: for (let y = 2; y < state.height - 2; y++) for (let x = 2; x < state.width - 2; x++) if (where(g, x, y)) { at = { x, y }; break outer; }
  } else {
    const own = state.units.find((u) => u.alive && u.owner === 0 && !u.container)!;
    at = g.w.neighbours(own.x, own.y).find((p) => p && g.w.playable(p.x, p.y))!;
  }
  const fields = [at, ...g.w.neighbours(at.x, at.y).filter((p) => p !== null)];
  for (const p of fields) {
    const id = state.unitAt[p.y * state.width + p.x];
    if (id >= 0) { state.units[id].alive = false; state.unitAt[p.y * state.width + p.x] = -1; }
  }
  const units = types.map((t, i) => {
    const p = fields[i];
    const u = createUnit(state, data, t, 0, p.x, p.y);
    state.unitAt[p.y * state.width + p.x] = u.id;
    return u;
  });
  state.activePlayer = 0;
  return { g, state, units, data };
}

describe.skipIf(!hasGameData)('field supply (FUN_0042522e / FUN_00424ea0)', () => {
  it('a tanker refuels a neighbour and pays 1 energy point per 100 fuel (at least 1)', async () => {
    const { g, units: [tanker, golem] } = await arena([ALGOL, GOLEM]);
    golem.fuel = 5;
    const stock = tanker.ammo[0];
    expect(g.supportTargets(tanker.id).refill).toContain(golem.id);
    expect(g.refillUnit(tanker.id, golem.id).ok).toBe(true);
    expect(golem.fuel).toBe(g.w.cls(golem).fuel);
    expect(tanker.ammo[0]).toBe(stock - 1);
    expect(tanker.flags & UnitFlag.ACTION_USED).toBeTruthy();
    expect(g.canMove(tanker)).toBe(false); // after an action the vehicle stays where it is
  });

  it('a repair vehicle repairs with one energy and one material per point and costs one experience point', async () => {
    const { g, units: [sinus, golem] } = await arena([SINUS, GOLEM]);
    golem.group = 3;
    golem.experience = 4;
    const max = g.w.maxGroup(g.w.cls(golem));
    const before = [...sinus.ammo];
    expect(g.supportTargets(sinus.id).repair).toContain(golem.id);
    g.repairUnit(sinus.id, golem.id);
    const n = max - 3;
    expect(golem.group).toBe(max);
    expect(golem.experience).toBe(3);
    expect(sinus.ammo[1]).toBe(before[1] - n); // material slot (raw 8)
    expect(sinus.ammo[2]).toBe(before[2] - n); // energy slot (raw 4)
  });

  it('nothing to do -> no target; enemies are never supplied', async () => {
    const { g, units: [tanker, golem] } = await arena([ALGOL, GOLEM]);
    expect(g.supportTargets(tanker.id).refill).toHaveLength(0);
    golem.fuel = 1;
    golem.owner = 1;
    expect(g.supportTargets(tanker.id).refill).toHaveLength(0);
  });
});

describe.skipIf(!hasGameData)('construction (FUN_00445b9b / FUN_00424c13)', () => {
  it('the PLANUM builds a road on a free neighbour field and uses one point of building material', async () => {
    const { g, state, units: [planum] } = await arena([PLANUM]);
    state.buildMask = 0x10 | 1 | 8; // mission 100 itself has only paths
    const targets = g.buildTargets(planum.id);
    const [field, opts] = [...targets].find(([, o]) => o & (1 << Build.ROAD)) ?? [];
    expect(field, 'a road can be built next to the vehicle').toBeDefined();
    const stock = planum.ammo[0];
    expect(g.build(planum.id, field!, Build.ROAD).ok).toBe(true);
    expect(g.data.terrain[state.overlay[field!]].typeMask & 1).toBe(1);
    expect(planum.ammo[0]).toBe(stock - 1);
    void opts;
    // the new road can be demolished again (next turn: one action per turn)
    expect(fieldBuildOptions(g.w, field! % state.width, Math.floor(field! / state.width)) & (1 << Build.DEMOLISH)).toBeTruthy();
  });

  it('only overlay kinds present on the map at the start can be built', async () => {
    const { g, state, units: [planum] } = await arena([PLANUM]);
    state.buildMask = 0x10;
    expect(g.buildTargets(planum.id).size).toBe(0);
  });
});

describe.skipIf(!hasGameData)('height (FUN_00444dd3 / FUN_00444ee9)', () => {
  it('a reconnaissance plane climbs to high altitude and descends again', async () => {
    const { g, units: [uhu] } = await arena([UHU]);
    expect(uhu.layer).toBe(Layer.AIR);
    expect(g.canChangeHeight(uhu.id, false)).toBe(false);
    g.changeHeight(uhu.id, true);
    expect(uhu.layer).toBe(Layer.HIGH_AIR);
    expect(g.canChangeHeight(uhu.id, true)).toBe(false);
    g.changeHeight(uhu.id, false);
    expect(uhu.layer).toBe(Layer.AIR);
  });

  it('a submarine dives and surfaces; a tank cannot', async () => {
    const water = (g: Game, x: number, y: number) => g.w.isOpenWater(x, y) && g.w.neighbours(x, y).every((p) => p && g.w.isOpenWater(p.x, p.y));
    const { g, units: [sub] } = await arena([NAUTILUS], water);
    const { g: g2, units: [golem] } = await arena([GOLEM]);
    sub.layer = Layer.WATER;
    expect(g.canChangeHeight(sub.id, true)).toBe(false);
    g.changeHeight(sub.id, false);
    expect(sub.layer).toBe(Layer.SUBMERGED);
    expect(g.canChangeHeight(sub.id, true)).toBe(true);
    expect(g2.canChangeHeight(golem.id, true) || g2.canChangeHeight(golem.id, false)).toBe(false);
  });
});

describe.skipIf(!hasGameData)('turn start (FUN_0040d4c4)', () => {
  it('aircraft of every player lose one point of fuel at every change of the active player', async () => {
    const { g, state, units: [uhu] } = await arena([UHU]);
    const fuel = uhu.fuel;
    const alive = state.players.filter((p) => p.alive).length;
    for (let i = 0; i < alive; i++) g.endTurn();
    expect(uhu.fuel).toBe(fuel - alive);
  });
});

describe.skipIf(!hasGameData)('campaign training points (FUN_004168e6 / FUN_00422b54)', () => {
  it('survivors earn points by experience, spent one point per experience level in a non-factory building', async () => {
    const { earnTrainingPoints } = await import('../src/engine/campaign.ts');
    const { g, state, units: [golem] } = await arena([GOLEM], undefined, 104);
    golem.experience = 7; // table: 2 points
    const before = earnTrainingPoints(g.data, state, [0, 0, 0]);
    golem.experience = 0;
    const without = earnTrainingPoints(g.data, state, [0, 0, 0]);
    expect(before[0] - without[0]).toBe(2);
    // put the unit into a building that is no factory / depot
    const shop = state.shops.find((sh) => sh.kind === 1 && !((sh.func ?? 0) & 0x18))!;
    shop.owner = 0;
    state.unitAt[golem.y * state.width + golem.x] = -1;
    golem.container = { kind: 'shop', id: shop.id };
    shop.units.push(golem.id);
    expect(g.canTrain(golem.id)).toBe(false); // no points yet
    state.players[0].trainingPoints = [2, 0, 0];
    g.train(golem.id); g.train(golem.id);
    expect(golem.experience).toBe(2);
    expect(state.players[0].trainingPoints).toEqual([0, 0, 0]);
    expect(g.canTrain(golem.id)).toBe(false);
  });
});

describe.skipIf(!hasGameData)('weather (FUN_0043a15f)', () => {
  it('a mission in weather 0 keeps its terrain; snow loads the snow records (other type bits, other movement)', async () => {
    const data = await gameData();
    const lm = await data.loadMission(100);
    const state = createGame(data, lm, { setId: 0, difficulty: 1 });
    const g = new Game(data, state);
    if (state.weather === 0) {
      g.start();
      expect(state.terrain).toEqual(Array.from(lm.mission.terrain));
    } else g.start();
    const before = [...state.terrain];
    g.applyWeather(4, false);
    const changed = state.terrain.filter((t, i) => t !== before[i]).length;
    expect(changed).toBeGreaterThan(0);
    const typeChanged = state.terrain.some((t, i) => data.terrain[t].typeMask !== data.terrain[before[i]].typeMask);
    expect(typeChanged, 'snow changes the terrain types, not only the pictures').toBe(true);
    // back to sun: the snow records switch back
    g.applyWeather(0, false);
    expect(state.terrain.filter((t, i) => t !== before[i]).length).toBeLessThan(changed);
  });
});

describe.skipIf(!hasGameData)('buildings (FUN_00445118 / FUN_00445319 / FUN_00442f96 / FUN_0042550b)', () => {
  it('a unit that entered a building this turn can be neither repaired, refuelled nor moved out; next turn it can', async () => {
    const { g, state, units: [golem] } = await arena([GOLEM], undefined, 104);
    const shop = state.shops.find((sh) => sh.kind === 1 && ((sh.func ?? 0) & 2))!;
    shop.owner = 0;
    state.players[0].energy = 100; shop.material = 100;
    // drive into the building
    state.unitAt[golem.y * state.width + golem.x] = -1;
    golem.x = shop.x; golem.y = shop.y;
    (g as any).enterShop(golem, shop.id);
    golem.group = 2; golem.fuel = 1;
    expect(g.repairInShop(golem.id).ok).toBe(false);
    expect(g.refuelInShop(golem.id).ok).toBe(false);
    expect(g.canMove(golem)).toBe(false);
    // next turn of player 0
    const alive = state.players.filter((p) => p.alive).length;
    for (let i = 0; i < alive; i++) g.endTurn();
    expect(state.activePlayer).toBe(0);
    expect(g.repairInShop(golem.id).ok).toBe(true);
    expect(g.refuelInShop(golem.id).ok).toBe(true);
    expect(golem.fuel).toBe(g.w.cls(golem).fuel);
    expect(g.canMove(golem)).toBe(true); // repairing and refuelling do not keep it inside
  });

  it('only buildings with the production function produce; new units get one experience point per training camp (max 4)', async () => {
    const { g, state } = await arena([GOLEM], undefined, 104);
    const depot = state.shops.find((sh) => sh.kind === 1 && !((sh.func ?? 0) & 2));
    if (depot) { depot.owner = 0; depot.production = [GOLEM, 0, 0, 0]; expect(g.producible(depot.id)).toEqual([]); }
    const fac = state.shops.find((sh) => sh.kind === 1 && ((sh.func ?? 0) & 2))!;
    fac.owner = 0; fac.production = [GOLEM, 0, 0, 0]; fac.material = 999; state.players[0].energy = 999; fac.units = [];
    for (const sh of state.shops) if (sh !== fac) { sh.func = 8; sh.owner = 0; }
    const res = g.produce(fac.id, GOLEM);
    expect(res.ok).toBe(true);
    const u = state.units[fac.units[fac.units.length - 1]];
    expect(u.experience).toBe(Math.min(4, state.shops.length - 1));
    expect(g.canMove(u)).toBe(false);
  });
});
