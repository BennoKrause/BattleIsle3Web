// Builds the initial GameState of a mission from the original mission file.
// Follows BattleIsle2020 LoadMission&/CreateUnit& (units, buildings, cargo, AI points, start
// energy, action sorting); deviations are marked.
import type { GameData, LoadedMission } from '../data/gamedata.ts';
import { ActionType, splitCategory } from '../formats/actions.ts';
import { directionTo } from './hex.ts';
import { isCrystal, isPlane, isShip, TT_WATER } from './classes.ts';
import { Layer, NEUTRAL, type GameState, type QueuedAction, type UnitState } from './state.ts';

import { Difficulty, DIFFICULTY_FLAGS } from './rules.ts';
export { Difficulty };

export interface SetupOptions {
  setId: number;
  difficulty: number;
  /** Override computer control per player (single-map mode); default = mission AI mask. */
  computerPlayers?: boolean[];
  /** Override alliance masks (single-map mode). */
  allies?: number[];
  seed?: number;
}

export function createUnit(state: GameState, data: GameData, type: number, owner: number, x: number, y: number): UnitState {
  const c = data.unitClasses[type];
  const unit: UnitState = {
    id: state.units.length,
    type,
    owner: isCrystal(c) ? NEUTRAL : owner,
    alive: true,
    x, y,
    layer: isPlane(c) ? Layer.AIR : isShip(c) ? Layer.WATER : Layer.GROUND,
    dir: Math.round(directionTo(x, y, state.width >> 1, state.height >> 1)),
    group: Math.max(1, c.strength),
    fuel: c.fuel,
    ammo: c.weapons.map((w) => Math.max(0, w.ammo)),
    experience: 0, // new units start without experience (SDI_1C.EXE FUN_0043ff30)
    flags: 0,
    moved: 0,
    cargo: [],
    container: null,
    aiOrder: 0,
  };
  // Units on water without a bridge are floating (hovercraft, landing boats).
  if (unit.layer === Layer.GROUND && state.terrain.length) {
    const i = y * state.width + x;
    if ((data.terrain[state.terrain[i]]?.typeMask & TT_WATER) && state.overlay[i] < 0) unit.layer = Layer.WATER;
  }
  state.units.push(unit);
  return unit;
}

function toQueued(a: { category: number; turn: number; movement: number; playerMask: number; type: number; param: number; shop: number; newAlly: number }): QueuedAction {
  return { category: a.category, level: splitCategory(a.category).level, turn: a.turn, movement: a.movement, playerMask: a.playerMask, type: a.type, param: a.param, shop: a.shop, newAlly: a.newAlly };
}

export function createGame(data: GameData, lm: LoadedMission, opt: SetupOptions): GameState {
  const m = lm.mission;
  const n = m.width * m.height;
  const state: GameState = {
    version: 1,
    missionFileId: lm.fileId,
    setId: opt.setId,
    difficulty: opt.difficulty,
    ruleFlags: DIFFICULTY_FLAGS[opt.difficulty].rules,
    combatFlags: DIFFICULTY_FLAGS[opt.difficulty].combat,
    terrainTables: structuredClone(m.terrainTables),
    productionFlags: [...m.productionFlags],
    width: m.width,
    height: m.height,
    terrain: Array.from(m.terrain),
    overlay: Array.from(m.overlay),
    unitAt: new Array(n).fill(-1),
    shopAt: new Array(n).fill(-1),
    units: [],
    shops: [],
    players: [],
    explored: new Array(n).fill(0),
    vision: new Array(n).fill(0),
    turn: 0,
    movement: 0,
    activePlayer: 0,
    weather: 0,
    victoryConditions: [],
    defeatConditions: [],
    requiredVictoryConditions: Math.max(1, m.requiredVictoryConditions),
    actions: [],
    laterLevels: [],
    mapChanges: m.dfLayers.map((l) => l.map((c) => ({ ...c }))),
    turnLimit: -1,
    turnLimitIsVictory: false,
    outcome: null,
    rngState: opt.seed ?? (lm.fileId * 7919 + 17),
    events: [],
    eventSeq: 0,
    seenSequences: [],
  };

  // Units placed on the map
  for (const u of m.units) {
    const unit = createUnit(state, data, u.type, u.owner, u.x, u.y);
    state.unitAt[u.y * m.width + u.x] = unit.id;
  }

  // Buildings, transporter cargo and AI points
  for (const s of m.shops) {
    if (s.x >= m.width || s.y >= m.height) continue; // stray AI points outside the map (MISS103)
    const idx = s.y * m.width + s.x;
    if (s.kind === 1 && s.shopType > 0) {
      const shop = {
        id: state.shops.length, kind: 1, x: s.x, y: s.y, type: s.shopType, func: s.function & 0xff, owner: s.owner, nameIndex: s.nameIndex,
        energy: s.energy, material: s.material, energyPlus: s.energyPlus, materialPlus: s.materialPlus,
        units: [] as number[], production: s.production.filter((p) => p > 0), aiCommand: s.aiCommand,
      };
      state.shops.push(shop);
      state.shopAt[idx] = shop.id;
      for (const t of s.content) {
        if (t < 0) continue;
        const unit = createUnit(state, data, t, s.owner, s.x, s.y);
        unit.container = { kind: 'shop', id: shop.id };
        shop.units.push(unit.id);
      }
    } else if (s.kind === 1) {
      const carrierId = state.unitAt[idx];
      if (carrierId < 0) continue;
      const carrier = state.units[carrierId];
      for (const t of s.content.slice(0, 8)) {
        if (t < 0) continue;
        const unit = createUnit(state, data, t, carrier.owner, s.x, s.y);
        unit.container = { kind: 'unit', id: carrierId };
        carrier.cargo.push(unit.id);
      }
    } else if (s.kind === 2) {
      const unitId = state.unitAt[idx];
      if (unitId >= 0) state.units[unitId].aiOrder = s.aiCommand;
    }
  }

  // Players: present = owns units or buildings at start
  const present = new Set<number>();
  for (const u of state.units) if (u.owner < NEUTRAL) present.add(u.owner);
  for (const s of state.shops) if (s.owner < NEUTRAL) present.add(s.owner);
  for (let p = 0; p < 6; p++) {
    state.players.push({
      index: p,
      allies: (opt.allies?.[p] ?? m.allies[p]) | (1 << p),
      energy: state.shops.filter((s) => s.owner === p).reduce((e, s) => e + s.energy, 0),
      computer: opt.computerPlayers?.[p] ?? ((m.aiMask >> p) & 1) === 1,
      alive: present.has(p),
      killed: 0, lost: 0, produced: 0, captured: 0,
    });
  }

  // Actions: conditions, timed events, later action levels
  for (const a of m.actions.map(toQueued)) {
    const kind = splitCategory(a.category).kind;
    if (a.level > 0) state.laterLevels.push(a);
    else if (kind === 'normal') state.actions.push(a);
    else if (a.type === ActionType.VC_TURN_REACHED) {
      state.turnLimit = a.param;
      state.turnLimitIsVictory = kind === 'victory';
    } else if (kind === 'victory') state.victoryConditions.push(a);
    else state.defeatConditions.push(a);
  }
  state.actions.sort((a, b) => a.turn - b.turn || a.movement - b.movement);
  state.weather = m.weather;
  // only overlay kinds present at the start can be built (SDI_1C.EXE: 0x4c8aa0 = 0x10 | type bits of all overlays)
  state.buildMask = 0x10;
  for (const o of state.overlay) if (o >= 0) state.buildMask |= (data.terrain[o]?.typeMask ?? 0) & 0xf;
  return state;
}
