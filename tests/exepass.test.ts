// Rules found in the complete pass through SDI_1C.EXE (decompiled/work/gaps.md): initial facing (FUN_0044c9ae), naming
// units (WU_EditUnitName), tyre tracks (MPW_AnimateMoveStep), mission goals that count for good (GA_CheckMissionGoals),
// players dropping out on multiplayer maps (MCP_CheckMultiPlayerGamePlayers), attacks on structures
// (ATT_AttackStructure) and captured units (GA_F0A_CaptureShop).
import { describe, expect, it } from 'vitest';
import { gameData, hasGameData } from './helpers.ts';
import { createGame, createUnit, initialFacing } from '../src/engine/setup.ts';
import { Game } from '../src/engine/game.ts';
import { NEUTRAL, UnitFlag } from '../src/engine/state.ts';
import { UCF } from '../src/engine/classes.ts';
import { trackColour } from '../src/render/roads.ts';

async function start(mission = 104, opts: { gameType?: number } = {}) {
  const data = await gameData();
  const state = createGame(data, await data.loadMission(mission), { setId: 0, difficulty: 1, ...opts });
  const g = new Game(data, state);
  g.start();
  state.activePlayer = 0;
  return { data, state, g };
}

describe('initial facing (FUN_0044c9ae)', () => {
  it('faces by thirds of the map and upper/lower half', () => {
    expect(initialFacing(0, 0, 30, 20)).toBe(2);
    expect(initialFacing(10, 19, 30, 20)).toBe(1);
    expect(initialFacing(11, 0, 30, 20)).toBe(3);
    expect(initialFacing(15, 10, 30, 20)).toBe(0);
    expect(initialFacing(20, 0, 30, 20)).toBe(4);
    expect(initialFacing(29, 19, 30, 20)).toBe(5);
  });
});

describe('tyre track colour', () => {
  it('takes the most frequent colour and shifts it along its ramp', () => {
    const px = new Uint8Array(24 * 24).fill(0);
    px.fill(13, 0, 300); // 13 = ramp 1, position 5 -> shade 9
    px.fill(40, 300, 350);
    expect(trackColour(px)).toBe(9);
  });
});

describe.skipIf(!hasGameData)('rules from the EXE pass', () => {
  it('own units and allied computer units can be named, enemies not (max 16 characters)', async () => {
    const { g, state } = await start();
    const own = g.unitsOf(0)[0];
    expect(g.renameUnit(own.id, 'Eine sehr lange Bezeichnung').ok).toBe(true);
    expect(own.name).toBe('Eine sehr lange');
    const enemy = state.units.find((u) => u.alive && u.owner !== 0 && u.owner < NEUTRAL && !g.w.isAllied(0, u.owner))!;
    expect(g.canRenameUnit(enemy.id)).toBe(false);
  });

  it('moves of human players leave tyre tracks on both fields of every step', async () => {
    const { g, state } = await start();
    const u = g.unitsOf(0).find((x) => !x.container && !(g.w.cls(x).flags & UCF.NO_TRAILS) && !(g.w.cls(x).flags & UCF.PLANE) && g.moveArea(x.id).targets.size > 0)!;
    const target = [...g.moveArea(u.id).targets.keys()].find((f) => state.unitAt[f] < 0 && state.shopAt[f] < 0)!;
    const from = g.w.idx(u.x, u.y);
    expect(g.moveUnit(u.id, target).ok).toBe(true);
    expect(state.tracks?.[from]).toBeGreaterThan(0);
    expect(state.tracks?.[target]).toBeGreaterThan(0);
  });

  it('a fulfilled victory condition keeps counting after it is undone', async () => {
    const { g, state } = await start();
    state.requiredVictoryConditions = 2;
    const cond = { type: 9, param: 0, shop: 0 } as never;
    const other = { type: 9, param: 0, shop: 1 } as never;
    state.victoryConditions = [cond, other];
    const s0 = g.shopByIndex(0)!, s1 = g.shopByIndex(1)!;
    s0.owner = 0; s1.owner = 1;
    g.checkConditions();
    expect(state.victoryMet).toBe(1);
    expect(state.outcome).toBeNull();
    s0.owner = 1; // the first building is lost again
    s1.owner = 0;
    g.checkConditions();
    expect(state.outcome?.result).toBe('victory');
  });

  it('on multiplayer maps players without units and production buildings drop out; the last one wins', async () => {
    const { g, state } = await start(104, { gameType: 2 });
    const alive = state.players.filter((p) => p.alive && p.index < NEUTRAL).map((p) => p.index);
    expect(alive.length).toBeGreaterThanOrEqual(2);
    for (const p of alive.slice(1)) {
      for (const u of state.units) if (u.owner === p) u.alive = false;
      for (const sh of state.shops) if (sh.owner === p) sh.owner = NEUTRAL;
    }
    const res = g.endTurn();
    expect(res.events.some((e) => e.kind === 'player-out')).toBe(true);
    expect(state.outcome?.result).toBe('victory');
    expect(state.outcome?.winner).toBe(alive[0]);
  });

  it('weapons with flag 0x200 destroy a road after 10 hit points', async () => {
    const { g, state, data } = await start();
    const type = data.unitClasses.findIndex((c) => c.weapons.some((w) => (w.rawTargets & 0x200) && w.damage > 0 && w.minRange <= 1 && !(w.rawTargets & 0xf)));
    expect(type).toBeGreaterThanOrEqual(0);
    const road = data.terrain.findIndex((t) => (t.raw[2] & 1) && (t.typeMask & 1));
    expect(road).toBeGreaterThanOrEqual(0);
    // an empty field next to a free field for the attacker
    let f = -1, at = -1;
    for (let i = 0; i < state.width * state.height && f < 0; i++) {
      const x = i % state.width, y = Math.trunc(i / state.width);
      if (!g.w.playable(x, y) || state.unitAt[i] >= 0 || state.shopAt[i] >= 0) continue;
      const n = g.w.neighbours(x, y).find((p) => p && g.w.playable(p.x, p.y) && state.unitAt[g.w.idx(p.x, p.y)] < 0 && state.shopAt[g.w.idx(p.x, p.y)] < 0);
      if (n) { f = i; at = g.w.idx(n.x, n.y); }
    }
    state.overlay[f] = road;
    const u = createUnit(state, data, type, 0, at % state.width, Math.trunc(at / state.width));
    state.unitAt[at] = u.id;
    state.vision[f] |= 1;
    u.experience = 0;
    const w = data.unitClasses[type].weapons.findIndex((x) => (x.rawTargets & 0x200) && x.damage > 0);
    const per = Math.max(1, -2) + Math.trunc(data.unitClasses[type].weapons[w].damage / 320);
    const hits = Math.ceil(10 / per);
    for (let k = 0; k < hits; k++) {
      expect(g.structureTargets(u.id).some((t) => t.field === f)).toBe(true);
      expect(g.attackStructure(u.id, f).ok).toBe(true);
      u.flags = 0; u.ammo[w] = 5;
    }
    expect(state.overlay[f]).toBe(-1);
  });

  it('units captured inside a building can act in the same turn', async () => {
    const { g, state, data } = await start();
    const shop = state.shops.find((s) => s.owner !== 0 && s.owner < NEUTRAL)!;
    const inside = createUnit(state, data, 0, shop.owner, shop.x, shop.y);
    inside.container = { kind: 'shop', id: shop.id };
    inside.flags |= UnitFlag.DONE | UnitFlag.ENTERED;
    shop.units.push(inside.id);
    const capturer = g.unitsOf(0).find((u) => !u.container)!;
    (g as unknown as { captureShop(id: number, by: typeof capturer): void }).captureShop(shop.id, capturer);
    expect(inside.owner).toBe(0);
    expect(inside.flags & (UnitFlag.DONE | UnitFlag.ENTERED)).toBe(0);
  });

  it('in hot-seat games every player keeps his own setup options (FUN_00435787)', async () => {
    const { g, state } = await start();
    state.playerRules = state.players.map((p) => ({ attackAllies: p.index === 1, autoRefuel: p.index === 1 }));
    g.applyPlayerRules(0);
    expect(g.options.attackAllies).toBe(false);
    const next = state.players.find((p) => p.index === 1 && p.alive);
    if (!next) return;
    for (let i = 0; i < 6 && state.activePlayer !== 1; i++) g.endTurn();
    expect(state.activePlayer).toBe(1);
    expect(g.options.attackAllies).toBe(true);
    expect(state.ruleFlags & 0x180).toBe(0x180);
  });
});

describe('cheats (w_sdi_cheat.c)', () => {
  it('"ewald" enables the cheat menu on F9, ESC disables it, "BAUER" is reported', async () => {
    const { CheatWatcher } = await import('../src/engine/cheats.ts');
    const w = new CheatWatcher();
    expect(w.key('F9')).toBeNull();
    for (const k of 'ewald') w.key(k);
    expect(w.key('F9')).toBe('menu');
    w.key('Escape');
    expect(w.key('F9')).toBeNull();
    let r = null;
    for (const k of 'BAUER') r = w.key(k);
    expect(r).toBe('bauer');
  });
});
