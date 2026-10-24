// Game flow: turns, unit commands, scripted events and mission conditions.
// Reconstructed from SDI_1C.EXE (see docs/research/GAME_RULES.md); parts marked PROVISIONAL are
// not yet verified against the original program.
import type { GameData } from '../data/gamedata.ts';
import { World } from './world.ts';
import { RF } from './rules.ts';
import { UCF } from './classes.ts';
import { computeMoveArea, pathTo, shopEntrySlot, canLoad, type MoveArea } from './movement.ts';
import { updateVision, updateVisionAll, unitVisibleTo } from './vision.ts';
import { resolveCombat, usableWeapons, bestWeapon, type CombatResult } from './combat.ts';
import { toCombatant } from './combatant.ts';
import { distance, directionTo } from './hex.ts';
import { nextRandom } from './rng.ts';
import { createUnit } from './setup.ts';
import { ActionType } from '../formats/actions.ts';
import { Layer, MAX_EXPERIENCE, NEUTRAL, UnitFlag, type GameEvent, type GameState, type QueuedAction, type UnitState } from './state.ts';

export const MAX_XP = MAX_EXPERIENCE - 1; // experience 0..11 (FUN_004408ca)

export interface AttackTarget { unitId: number; weapons: number }

/** Result of a command; `events` are the events appended by it (for animation / messages). */
export interface CommandResult { ok: boolean; reason?: string; events: GameEvent[]; combat?: CombatResult[] }

/** Unit classes counted for "player defeated": class flag bit 29 not set (FUN_00441a9d). */
const NOT_COMBAT_RELEVANT = 0x20000000;
/** Class flag bit 27: artillery type, cannot fire back (FUN_0042342f). */
const COOLDOWN = UCF.COOLDOWN;
const RETREAT = UCF.RETREAT;

export interface GameOptions {
  /** Setup menu "Alliierte angreifen". */
  attackAllies: boolean;
}

export class Game {
  readonly w: World;
  options: GameOptions = { attackAllies: false };
  readonly data: GameData;
  readonly state: GameState;
  constructor(data: GameData, state: GameState) {
    this.data = data;
    this.state = state;
    this.w = new World(data, state);
  }
  get s() { return this.state; }

  // ------------------------------------------------------------------ events
  private emit(kind: GameEvent['kind'], data: Record<string, unknown>, player?: number): GameEvent {
    const e: GameEvent = { seq: this.s.eventSeq++, kind, turn: this.s.turn, player, data };
    this.s.events.push(e);
    if (this.s.events.length > 2000) this.s.events.splice(0, this.s.events.length - 2000);
    return e;
  }
  private collect<T>(fn: () => T): { value: T; events: GameEvent[] } {
    const start = this.s.eventSeq;
    const value = fn();
    return { value, events: this.s.events.filter((e) => e.seq >= start) };
  }

  // ------------------------------------------------------------------ start
  /** First initialisation after createGame: weather sprites, vision, first player, due events. */
  start() {
    this.applyWeather(this.s.weather, true);
    updateVisionAll(this.w);
    this.s.turn = 0;
    this.s.activePlayer = this.firstAlivePlayer(0);
    this.s.movement = 1;
    this.processEvents();
  }

  firstAlivePlayer(from: number): number {
    for (let i = 0; i < 6; i++) {
      const p = (from + i) % 6;
      if (this.s.players[p].alive) return p;
    }
    return 0;
  }
  get activePlayer() { return this.s.players[this.s.activePlayer]; }
  isHumanTurn() { return !this.activePlayer.computer; }

  // ------------------------------------------------------------------ queries
  moveArea(unitId: number): MoveArea {
    const u = this.s.units[unitId];
    if (!this.canMove(u)) return { targets: new Map(), parent: new Map(), budget: 0 };
    return computeMoveArea(this.w, u, { retreat: (u.flags & UnitFlag.ATTACKED) !== 0 });
  }

  canMove(u: UnitState): boolean {
    if (!u.alive || u.owner !== this.s.activePlayer || this.s.outcome) return false;
    if (u.flags & UnitFlag.DONE) return false;
    if ((u.flags & UnitFlag.MOVED) && !(u.flags & UnitFlag.ATTACKED)) return false;
    if (u.flags & UnitFlag.ATTACKED) return this.canRetreat(u);
    if (u.container?.kind === 'unit') {
      const carrier = this.s.units[u.container.id];
      if (carrier.layer === Layer.SUBMERGED || carrier.layer === Layer.HIGH_AIR) return false;
    }
    return this.w.cls(u).moveRange > 0;
  }

  /** Second move after an attack (class flag 0x40000, at least 2 fields left; FUN_00444334). */
  canRetreat(u: UnitState): boolean {
    const c = this.w.cls(u);
    if (!(c.flags & RETREAT) || u.group < 1) return false;
    const byFuel = c.fuelUsage < 1 ? u.fuel : Math.trunc(u.fuel / c.fuelUsage);
    return Math.min(c.moveRange >> 3, byFuel) - u.moved >= 2;
  }

  /** Attack targets of a unit at its current position. */
  attackTargets(unitId: number): AttackTarget[] {
    const u = this.s.units[unitId];
    if (!u.alive || u.container || u.owner !== this.s.activePlayer || this.s.outcome) return [];
    if (u.flags & (UnitFlag.ATTACKED | UnitFlag.DONE)) return [];
    const c = this.w.cls(u);
    if ((u.flags & UnitFlag.MOVED) && (c.flags & COOLDOWN)) return []; // PROVISIONAL: artillery cannot attack after moving (manual p. 48)
    const me = toCombatant(this.w, u);
    const out: AttackTarget[] = [];
    for (const t of this.w.unitsOnMap()) {
      if (t.owner === u.owner || t.owner >= NEUTRAL && !(this.w.cls(t).flags & UCF.CRYSTAL)) continue;
      // allies only with the setup option "Alliierte angreifen" (manual p. 43)
      if (this.w.isAllied(u.owner, t.owner) && !this.options.attackAllies) continue;
      if (!unitVisibleTo(this.w, u.owner, t.id)) continue;
      const d = distance(u.x, u.y, t.x, t.y);
      let mask = usableWeapons(me, toCombatant(this.w, t));
      c.weapons.forEach((wp, i) => { if (d < Math.max(1, wp.minRange) || d > wp.maxRange) mask &= ~(1 << i); });
      if (mask) out.push({ unitId: t.id, weapons: mask });
    }
    return out;
  }

  // ------------------------------------------------------------------ commands
  moveUnit(unitId: number, target: number): CommandResult {
    const u = this.s.units[unitId];
    const area = this.moveArea(unitId);
    if (!area.targets.has(target)) return { ok: false, reason: 'target not reachable', events: [] };
    const path = pathTo(area, this.w, u, target);
    const { events } = this.collect(() => this.performMove(u, target, path));
    return { ok: true, events };
  }

  private performMove(u: UnitState, target: number, path: number[]) {
    const s = this.s, w = this.w;
    const c = w.cls(u);
    const fromX = u.x, fromY = u.y;
    const tx = target % s.width, ty = Math.trunc(target / s.width);
    const retreating = (u.flags & UnitFlag.ATTACKED) !== 0;
    // leave the old place
    this.detach(u);
    u.dir = directionTo(path.length > 1 ? path[path.length - 2] % s.width : fromX, path.length > 1 ? Math.trunc(path[path.length - 2] / s.width) : fromY, tx, ty);
    u.x = tx; u.y = ty;
    for (const id of u.cargo) { s.units[id].x = tx; s.units[id].y = ty; }
    // fuel: straight-line distance times consumption (FUN_004436b5)
    const steps = distance(fromX, fromY, tx, ty);
    if (!(s.ruleFlags & RF.NO_FUEL_USE)) u.fuel = Math.max(0, u.fuel - steps * c.fuelUsage);
    u.moved += path.length - 1;
    u.flags |= UnitFlag.MOVED;
    this.emit('message', { type: 'move', unitId: u.id, path }, u.owner);

    // destination: building, transporter, pick-up or empty field
    const shopId = s.shopAt[target];
    const other = s.unitAt[target] >= 0 ? s.units[s.unitAt[target]] : null;
    if (shopId >= 0) {
      const shop = s.shops[shopId];
      if (shop.owner !== u.owner) this.captureShop(shop.id, u);
      if (u.alive) this.enterShop(u, shop.id);
    } else if (other && canLoad(w, other, u)) {
      other.cargo.push(u.id);
      u.container = { kind: 'unit', id: other.id };
    } else if (other && canLoad(w, u, other)) {
      // picks up a crystal or mine
      s.unitAt[target] = u.id;
      other.container = { kind: 'unit', id: u.id };
      if (other.owner === NEUTRAL || other.owner !== u.owner) other.owner = u.owner;
      u.cargo.push(other.id);
    } else {
      s.unitAt[target] = u.id;
      if (u.layer === Layer.GROUND || u.layer === Layer.WATER) u.layer = w.isOpenWater(tx, ty) ? Layer.WATER : Layer.GROUND;
    }
    updateVision(w, u.owner);
    // ambush by hidden neighbours (FUN_004436b5)
    if (!u.container) this.ambush(u);
    if (u.alive && (u.container || retreating || !this.hasAttackTargets(u))) this.unitDone(u);
    updateVisionAll(w);
    this.afterAction();
  }

  private hasAttackTargets(u: UnitState) { return this.attackTargets(u.id).length > 0; }

  private detach(u: UnitState) {
    const s = this.s;
    if (u.container?.kind === 'shop') {
      const shop = s.shops[u.container.id];
      shop.units = shop.units.filter((id) => id !== u.id);
      u.flags |= UnitFlag.MOVED_FROM_CONTAINER;
    } else if (u.container?.kind === 'unit') {
      const carrier = s.units[u.container.id];
      carrier.cargo = carrier.cargo.filter((id) => id !== u.id);
      u.flags |= UnitFlag.MOVED_FROM_CONTAINER;
    } else if (s.unitAt[this.w.idx(u.x, u.y)] === u.id) {
      s.unitAt[this.w.idx(u.x, u.y)] = -1;
    }
    u.container = null;
  }

  private enterShop(u: UnitState, shopId: number) {
    const shop = this.s.shops[shopId];
    const c = this.w.cls(u);
    if (c.flags & UCF.CRYSTAL) { // PROVISIONAL (manual p. 69): crystals turn into material
      shop.material += 4 * u.group;
      this.destroyUnit(u, -1, 'consumed');
      return;
    }
    u.container = { kind: 'shop', id: shopId };
    shop.units.push(u.id);
    for (const id of [...u.cargo]) {
      const cargo = this.s.units[id];
      if (this.w.cls(cargo).flags & UCF.CRYSTAL) { shop.material += 4 * cargo.group; this.destroyUnit(cargo, -1, 'consumed'); }
    }
    u.cargo = u.cargo.filter((id) => this.s.units[id].alive);
  }

  private captureShop(shopId: number, by: UnitState) {
    const s = this.s, shop = s.shops[shopId];
    const prev = shop.owner;
    // capturing a building of an ally ends the alliance on both sides (FUN_004436b5)
    if (prev < NEUTRAL && this.w.isAllied(by.owner, prev) && prev !== by.owner) this.breakAlliance(by.owner, prev);
    if (prev === NEUTRAL) s.players[by.owner].energy += shop.energy; // PROVISIONAL: energy of neutral buildings is taken over
    shop.owner = by.owner;
    for (const id of shop.units) {
      const cu = s.units[id];
      if (cu.owner !== by.owner) {
        if (prev < NEUTRAL) s.players[prev].lost++;
        s.players[by.owner].captured++;
        cu.owner = by.owner;
      }
    }
    this.emit('building-captured', { shopId, from: prev, to: by.owner, sequence: 0 }, by.owner);
  }

  private breakAlliance(a: number, b: number) {
    this.s.players[a].allies &= ~(1 << b);
    this.s.players[b].allies &= ~(1 << a);
    this.emit('alliance', { broken: [a, b] });
  }

  /** Hidden enemies next to the moved unit attack it (FUN_004436b5). */
  private ambush(u: UnitState) {
    const w = this.w, s = this.s;
    for (const p of w.neighbours(u.x, u.y)) {
      if (!u.alive) break;
      if (!p) continue;
      const i = w.idx(p.x, p.y);
      if (s.vision[i] & (1 << u.owner)) continue;
      const e = w.unitAt(p.x, p.y);
      if (!e || e.owner === u.owner || w.isAllied(u.owner, e.owner) || e.owner >= NEUTRAL) continue;
      const mask = usableWeapons(toCombatant(w, e), toCombatant(w, u));
      if (!mask) continue;
      this.emit('surprise', { attacker: e.id, defender: u.id }, u.owner);
      this.fight(e, bestWeapon(w.cls(e), mask), u);
      if (s.ruleFlags & RF.SINGLE_AMBUSH) break;
    }
  }

  attack(unitId: number, targetId: number, weapon?: number): CommandResult {
    const u = this.s.units[unitId];
    const t = this.attackTargets(unitId).find((x) => x.unitId === targetId);
    if (!t) return { ok: false, reason: 'not a valid target', events: [] };
    const wpn = weapon !== undefined && (t.weapons & (1 << weapon)) ? weapon : bestWeapon(this.w.cls(u), t.weapons);
    const results: CombatResult[] = [];
    const { events } = this.collect(() => {
      const target = this.s.units[targetId];
      if (this.w.isAllied(u.owner, target.owner) && target.owner < NEUTRAL) this.breakAlliance(u.owner, target.owner);
      results.push(this.fight(u, wpn, target));
      u.flags |= UnitFlag.ATTACKED;
      if (!u.alive || !this.canRetreat(u)) this.unitDone(u);
      updateVisionAll(this.w);
      this.afterAction();
    });
    return { ok: true, events, combat: results };
  }

  /** Combat outcome without side effects (AI evaluation, preview); attacker may be placed at (x, y). */
  previewCombat(a: UnitState, weapon: number, d: UnitState, at?: { x: number; y: number }): CombatResult {
    const w = this.w;
    const ac = toCombatant(w, a);
    if (at) { ac.x = at.x; ac.y = at.y; }
    const dMask = usableWeapons(toCombatant(w, d), ac);
    const neighbourOwners = w.neighbours(d.x, d.y).map((p) => {
      if (!p || (p.x === ac.x && p.y === ac.y)) return 0;
      const o = w.unitAt(p.x, p.y);
      return o && o.id !== a.id ? w.ownerMask(o.owner) : 0;
    });
    return resolveCombat({
      attacker: ac, attackerWeapon: weapon, defender: toCombatant(w, d), defenderWeapon: bestWeapon(w.cls(d), dMask),
      neighbourOwners, attackerAllies: w.allies(a.owner), flags: this.s.combatFlags,
      terrain: { terrainBit: (x, y) => w.combatTerrainBit(x, y), agility: this.s.terrainTables.agility, firepower: this.s.terrainTables.firepower },
      mapWidth: this.s.width, mapHeight: this.s.height,
    });
  }

  /** One combat between attacker (with weapon) and defender (FUN_0042342f). */
  private fight(a: UnitState, weapon: number, d: UnitState): CombatResult {
    const w = this.w, s = this.s;
    const dMask = usableWeapons(toCombatant(w, d), toCombatant(w, a));
    const dWeapon = bestWeapon(w.cls(d), dMask);
    const neighbourOwners = w.neighbours(d.x, d.y).map((p) => {
      const o = p && w.unitAt(p.x, p.y);
      return o && o.id !== a.id ? w.ownerMask(o.owner) : 0;
    });
    const r = resolveCombat({
      attacker: toCombatant(w, a), attackerWeapon: weapon,
      defender: toCombatant(w, d), defenderWeapon: dWeapon,
      neighbourOwners, attackerAllies: w.allies(a.owner),
      flags: s.combatFlags,
      terrain: { terrainBit: (x, y) => w.combatTerrainBit(x, y), agility: s.terrainTables.agility, firepower: s.terrainTables.firepower },
      mapWidth: s.width, mapHeight: s.height,
      random: () => {
        const v = Math.floor(nextRandom(s) * 32768);
        return nextRandom(s) < 0.5 ? -v : v;
      },
    });
    // experience (FUN_0042342f): before the damage is applied
    const killed = r.defenderLosses >= d.group;
    const xpBefore = { attacker: a.experience, defender: d.experience };
    if (r.defenderLosses > 0) a.experience = Math.min(MAX_XP, a.experience + 1);
    if (killed) a.experience = Math.min(MAX_XP, a.experience + 1);
    if (r.attackerLosses > 0) d.experience = Math.min(MAX_XP, d.experience + 1);
    // inputs of the fight window (MS_FIGTR.DLL FGT_Fight): experience before/after and the agility value
    // (100 + mission table C) of the field each side stands on
    const field = (u: UnitState) => 100 + (s.terrainTables.agility[w.combatTerrainBit(u.x, u.y)] ?? 0);
    this.emit('combat', {
      attacker: a.id, defender: d.id, weapon, defenderWeapon: r.defenderFiresBack ? dWeapon : -1, result: r,
      xp: { ...xpBefore, attackerAfter: a.experience, defenderAfter: d.experience },
      field: { attacker: field(a), defender: field(d) },
    }, a.owner);
    // ammunition
    if (!(s.ruleFlags & RF.NO_AMMO_USE)) {
      a.ammo[weapon] = Math.max(0, a.ammo[weapon] - 1);
      if (r.defenderFiresBack && dWeapon >= 0) d.ammo[dWeapon] = Math.max(0, d.ammo[dWeapon] - 1);
    }
    this.damage(d, r.defenderLosses, a.owner);
    this.damage(a, r.attackerLosses, d.owner);
    return r;
  }

  private damage(u: UnitState, losses: number, by: number) {
    if (losses <= 0 || !u.alive) return;
    u.group -= losses;
    if (u.group < 1) this.destroyUnit(u, by, 'damage');
  }

  destroyUnit(u: UnitState, by: number, reason: string) {
    const s = this.s;
    if (!u.alive) return;
    u.alive = false;
    u.group = 0;
    for (const id of u.cargo) this.destroyUnit(s.units[id], by, reason);
    u.cargo = [];
    this.detach(u);
    if (!(this.w.cls(u).flags & UCF.CRYSTAL)) {
      if (u.owner < NEUTRAL) s.players[u.owner].lost++;
      if (by >= 0 && by < NEUTRAL) s.players[by].killed++;
    }
    this.emit('unit-destroyed', { unitId: u.id, type: u.type, owner: u.owner, x: u.x, y: u.y, reason }, by >= 0 ? by : undefined);
  }

  unitDone(u: UnitState) {
    if (u.flags & UnitFlag.DONE) return;
    u.flags |= UnitFlag.DONE;
  }

  /** Marks a unit as finished without action (player clicks it away). */
  skipUnit(unitId: number): CommandResult {
    const u = this.s.units[unitId];
    if (u.owner !== this.s.activePlayer) return { ok: false, reason: 'not your unit', events: [] };
    const { events } = this.collect(() => { this.unitDone(u); this.afterAction(); });
    return { ok: true, events };
  }

  // ------------------------------------------------------------------ action counter & events
  /** FUN_0041e1f3: every completed action advances the action counter and processes due events. */
  private afterAction() {
    this.s.movement++;
    this.processEvents();
    this.checkConditions();
  }

  /** Executes due timed events (FUN_0041e21e / FUN_0042ab2b), highest priority first. */
  processEvents() {
    const s = this.s;
    for (;;) {
      const due = s.actions
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => a.turn <= s.turn && a.movement <= s.movement && (a.playerMask === 0 || lowestBitIndex(a.playerMask) === s.activePlayer));
      if (!due.length) break;
      due.sort((x, y) => priority(y.a.type) - priority(x.a.type) || x.i - y.i);
      const { a, i } = due[0];
      s.actions.splice(i, 1);
      this.executeAction(a);
    }
  }

  private executeAction(a: QueuedAction) {
    switch (a.type) {
      case ActionType.WEATHER:
        this.applyWeather(a.param, false);
        break;
      case ActionType.MESSAGE:
        if (a.param >= 100) {
          if (!this.s.seenSequences.includes(a.param)) this.s.seenSequences.push(a.param);
          this.emit('video', { sequence: a.param }, lowestBitIndex(a.playerMask));
        } else this.emit('message', { type: 'text', message: a.param }, lowestBitIndex(a.playerMask));
        break;
      case ActionType.DF_LAYER:
        this.activateMapChange(a.param);
        break;
      case ActionType.ALLIANCE: { // type 7: [0] player, [1] ally to add, [2] ally to remove (FUN_0042ab2b)
        const p = this.s.players[a.param];
        if (p) {
          p.allies &= ~(1 << a.newAlly);
          p.allies |= 1 << a.shop;
          this.emit('alliance', { player: a.param, add: a.shop, remove: a.newAlly });
          updateVisionAll(this.w);
        }
        break;
      }
    }
  }

  /** DF layer (FUN_0043b108): replaces terrain/overlay, may create units; land units on new water sink. */
  activateMapChange(layer: number) {
    const s = this.s, w = this.w;
    const changes = s.mapChanges[layer];
    if (!changes) return;
    for (const c of changes) {
      const i = w.idx(c.x, c.y);
      const occupant = s.unitAt[i] >= 0 ? s.units[s.unitAt[i]] : null;
      if (c.unit === -1) {
        if (c.terrain >= 0) s.terrain[i] = c.terrain;
        s.overlay[i] = c.overlay;
        if (occupant && w.isOpenWater(c.x, c.y) && (w.cls(occupant).flags >>> 31) === 0 && !(w.cls(occupant).flags & UCF.PLANE)
          && !((w.cls(occupant).terrainMask >>> 0) & w.groundMask(c.x, c.y))) {
          this.destroyUnit(occupant, -1, 'sunk');
          this.emit('sunk', { unitId: occupant.id });
        }
      } else if (!occupant) {
        const type = c.unit & 255;
        const owner = ownerFromCode(c.unit);
        const nu = createUnit(s, this.data, type, owner, c.x, c.y);
        s.unitAt[i] = nu.id;
        if (owner < NEUTRAL) s.players[owner].alive = true;
      }
    }
    this.emit('map-change', { layer });
    updateVisionAll(w);
  }

  /** PROVISIONAL: weather switches terrain sprites via the weather table of PART000.DAT (BattleIsle2020 ApplyWeather). */
  applyWeather(weather: number, initial: boolean) {
    const s = this.s;
    if (weather < 0 || weather > 4) return;
    const prev = s.weather;
    for (let i = 0; i < s.terrain.length; i++) {
      const t = this.data.terrain[s.terrain[i]];
      if (t && t.weatherSprites[weather] >= 0) s.terrain[i] = t.weatherSprites[weather];
      const o = s.overlay[i];
      if (o >= 0) {
        const od = this.data.terrain[o];
        if (od && od.weatherSprites[weather] >= 0) s.overlay[i] = od.weatherSprites[weather];
      }
    }
    s.weather = weather;
    if (!initial) {
      this.emit('weather', { weather, previous: prev });
      // thaw: units that can no longer stand on their field sink
      for (const u of this.w.unitsOnMap()) {
        const c = this.w.cls(u);
        if ((c.flags & UCF.PLANE) || (c.flags >>> 31)) continue;
        if (this.w.isOpenWater(u.x, u.y) && !((c.terrainMask >>> 0) & this.w.groundMask(u.x, u.y))) {
          this.destroyUnit(u, -1, 'sunk');
          this.emit('sunk', { unitId: u.id });
        }
      }
    }
  }

  // ------------------------------------------------------------------ conditions
  /** FUN_00415d36. Not evaluated on the training level (difficulty code 1). */
  checkConditions() {
    const s = this.s;
    if (s.outcome || s.difficulty === 0) return;
    for (const c of s.defeatConditions) {
      if (this.conditionMet(c)) {
        s.outcome = { result: 'defeat', turn: s.turn, conditions: [c.type] };
        this.emit('defeat', { condition: c });
        return;
      }
    }
    const met = s.victoryConditions.filter((c) => this.conditionMet(c));
    const required = Math.max(1, s.requiredVictoryConditions);
    if (met.length >= required) {
      s.outcome = { result: 'victory', turn: s.turn, conditions: met.map((c) => c.type) };
      this.emit('victory', { conditions: met });
    }
  }

  conditionMet(c: QueuedAction): boolean {
    const s = this.s;
    switch (c.type) {
      case 8: // player has no relevant units left (FUN_00441a9d)
        return !s.units.some((u) => u.alive && u.owner === c.param && !(this.data.unitClasses[u.type].flags & NOT_COMBAT_RELEVANT));
      case 9: // building owned by player
        return this.shopByIndex(c.shop)?.owner === c.param;
      case 11: { // field occupied by a unit of player
        const x = c.param & 63, y = c.param >> 6;
        const id = s.unitAt[y * s.width + x];
        return id >= 0 && s.units[id].owner === c.shop;
      }
      case 12: // no units of type left for player
        return !s.units.some((u) => u.alive && u.owner === c.shop && u.type === c.param);
      case 14: // building no longer owned by player
        return this.shopByIndex(c.shop)?.owner !== c.param;
      default: // 10 (turn limit) is not evaluated by the original program
        return false;
    }
  }

  /** Condition shop indexes count building records only, in file order (FUN_004366a0). */
  shopByIndex(index: number) {
    return this.s.shops[index];
  }

  // ------------------------------------------------------------------ turns
  /** Ends the turn of the active player and starts the next one (FUN_0042218a / FUN_0040d4c4). */
  endTurn(): CommandResult {
    const { events } = this.collect(() => {
      const s = this.s;
      // events of this turn that did not trigger are discarded
      s.actions = s.actions.filter((a) => !(a.turn <= s.turn && (a.playerMask === 0 || lowestBitIndex(a.playerMask) <= s.activePlayer)));
      let p = s.activePlayer;
      for (let i = 0; i < 6; i++) {
        p++;
        if (p === 6) { p = 0; s.turn++; this.emit('turn', { turn: s.turn }); }
        if (s.players[p].alive) break;
      }
      s.activePlayer = p;
      this.startPlayerTurn(p);
      s.movement = 1;
      this.processEvents();
      this.checkConditions();
    });
    return { ok: true, events };
  }

  /** FUN_0040d4c4: resets units, aircraft lose fuel, income, automatic supply in buildings. */
  private startPlayerTurn(p: number) {
    const s = this.s, w = this.w;
    for (const u of s.units) {
      if (!u.alive || u.owner !== p) continue;
      u.flags &= UnitFlag.ASCENDED | UnitFlag.DIVED;
      u.moved = 0;
      if (!u.container && (w.cls(u).flags & UCF.PLANE)) {
        if (!(s.ruleFlags & RF.NO_FUEL_USE)) u.fuel = Math.max(0, u.fuel - 1);
        if (u.fuel <= 0) { this.destroyUnit(u, -1, 'crashed'); this.emit('crashed', { unitId: u.id }); }
      }
    }
    // PROVISIONAL income: energy (global) and material (per building)
    for (const shop of s.shops) {
      if (shop.owner !== p) continue;
      s.players[p].energy += shop.energyPlus;
      shop.material += shop.materialPlus;
    }
    updateVision(w, p);
  }

  // ------------------------------------------------------------------ buildings
  /** Unit types a building can produce now (FUN_00436e51); only factories, airports and harbours produce. */
  producible(shopId: number): number[] {
    const s = this.s, shop = s.shops[shopId];
    if (!(shop.type & (2 | 4 | 8)) || shop.owner >= NEUTRAL) return [];
    const computer = s.players[shop.owner].computer;
    const energy = s.players[shop.owner].energy;
    const out: number[] = [];
    const ok = (t: number) => {
      const c = this.data.unitClasses[t];
      return c && c.costEnergy <= energy && c.costMaterial <= shop.material && (shop.type & c.shopMask) !== 0;
    };
    const flags = s.productionFlags;
    for (let t = 0; t < 64; t++) if ((flags[t] & 1) && (!computer || (flags[t] & 2)) && ok(t)) out.push(t);
    for (const t of shop.production) if (t > 0 && !out.includes(t) && ok(t)) out.push(t);
    return out;
  }

  /** Builds a unit in a building (PROVISIONAL details: academy bonus per manual p. 66). */
  produce(shopId: number, type: number): CommandResult {
    const s = this.s, shop = s.shops[shopId];
    if (shop.owner !== s.activePlayer || !this.producible(shopId).includes(type)) return { ok: false, reason: 'cannot produce', events: [] };
    if (shop.units.length >= 16) return { ok: false, reason: 'building full', events: [] };
    const { events } = this.collect(() => {
      const c = this.data.unitClasses[type];
      s.players[shop.owner].energy -= c.costEnergy;
      shop.material -= c.costMaterial;
      const u = createUnit(s, this.data, type, shop.owner, shop.x, shop.y);
      u.experience = Math.min(MAX_XP, s.shops.filter((x) => x.owner === shop.owner && (x.type & 64)).length);
      u.container = { kind: 'shop', id: shopId };
      u.flags |= UnitFlag.DONE;
      shop.units.push(u.id);
      s.players[shop.owner].produced++;
      this.emit('message', { type: 'produced', unitId: u.id, shopId }, shop.owner);
      this.afterAction();
    });
    return { ok: true, events };
  }

  /** Refuel / rearm a unit inside a building: 100 fuel = 1 energy, 100 ammo = 1 material, at least 1 each (FUN_00440d99). */
  refuelInShop(unitId: number): CommandResult {
    const s = this.s, u = s.units[unitId];
    if (u.container?.kind !== 'shop' || u.owner !== s.activePlayer) return { ok: false, reason: 'not in a building', events: [] };
    const shop = s.shops[u.container.id];
    const c = this.w.cls(u);
    const { events } = this.collect(() => {
      const needFuel = c.fuel - u.fuel;
      let fuelCost = 0, matCost = 0;
      if (needFuel > 0) {
        const can = Math.min(needFuel, s.players[u.owner].energy * 100);
        u.fuel += can; fuelCost = can;
      }
      c.weapons.forEach((wp, i) => {
        const need = wp.ammo - u.ammo[i];
        if (need > 0) {
          const can = Math.min(need, shop.material * 100 - matCost);
          if (can > 0) { u.ammo[i] += can; matCost += can; }
        }
      });
      if (fuelCost > 0) s.players[u.owner].energy -= Math.max(1, Math.trunc(fuelCost / 100));
      if (matCost > 0) shop.material -= Math.max(1, Math.trunc(matCost / 100));
      // refuelling or repairing in a building costs one experience point (manual p. 67)
      if (fuelCost > 0 || matCost > 0) u.experience = Math.max(0, u.experience - 1);
      this.emit('message', { type: 'refuel', unitId }, u.owner);
    });
    return { ok: true, events };
  }

  /** Repair in a building: one energy and one material per point of strength (PROVISIONAL), costs one experience point. */
  repairInShop(unitId: number): CommandResult {
    const s = this.s, u = s.units[unitId];
    if (u.container?.kind !== 'shop' || u.owner !== s.activePlayer) return { ok: false, reason: 'not in a building', events: [] };
    const shop = s.shops[u.container.id];
    const missing = this.w.maxGroup(this.w.cls(u)) - u.group;
    const n = Math.min(missing, s.players[u.owner].energy, shop.material);
    if (n <= 0) return { ok: false, reason: 'nothing to repair', events: [] };
    const { events } = this.collect(() => {
      u.group += n;
      s.players[u.owner].energy -= n;
      shop.material -= n;
      u.experience = Math.max(0, u.experience - 1);
      this.emit('message', { type: 'repair', unitId }, u.owner);
    });
    return { ok: true, events };
  }

  // ------------------------------------------------------------------ helpers for UI / AI
  unitsOf(player: number) { return this.s.units.filter((u) => u.alive && u.owner === player); }
  visibleTo(player: number, unitId: number) { return unitVisibleTo(this.w, player, unitId); }
  shopEntrySlot(shopId: number, unitId: number) { return shopEntrySlot(this.w, this.s.shops[shopId], this.s.units[unitId]); }
}

function lowestBitIndex(mask: number) {
  for (let i = 0; i < 8; i++) if (mask & (1 << i)) return i;
  return 0;
}

function priority(type: number) {
  return type === 3 ? 3000 : type === 4 ? 2000 : 1000;
}

function ownerFromCode(code: number): number {
  for (let p = 5; p >= 0; p--) if (code & (256 << p)) return p;
  return NEUTRAL;
}
