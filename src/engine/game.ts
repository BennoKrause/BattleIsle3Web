// Game flow: turns, unit commands, scripted events and mission conditions.
// Reconstructed from SDI_1C.EXE (see docs/research/GAME_RULES.md); parts marked PROVISIONAL are
// not yet verified against the original program.
import type { GameData } from '../data/gamedata.ts';
import { SF, World, shopFunction } from './world.ts';
import { RF } from './rules.ts';
import { UCF } from './classes.ts';
import { computeMoveArea, pathTo, shopEntrySlot, canBoard, canPickUp, canPickUpKind, type MoveArea } from './movement.ts';
import { updateVision, updateVisionAll, unitVisibleTo } from './vision.ts';
import { resolveCombat, usableWeapons, bestWeapon, type CombatResult } from './combat.ts';
import { toCombatant } from './combatant.ts';
import { distance, directionTo } from './hex.ts';
import { nextRandom } from './rng.ts';
import { createUnit } from './setup.ts';
import { trainingCategory } from './campaign.ts';
import { buildOn, buildTargets, canChangeHeight, canRefill, canRepair, changeHeight, initialBuildMask, refillByUnit, refillFrom, refillNeed, repairByUnit, repairFrom, repairNeed } from './support.ts';
import { ActionType } from '../formats/actions.ts';
import { Layer, MAX_EXPERIENCE, NEUTRAL, UnitFlag, type GameEvent, type GameState, type QueuedAction, type UnitState } from './state.ts';

export const MAX_XP = MAX_EXPERIENCE - 1; // experience 0..11 (FUN_004408ca)
/** Upper limit of energy and material (0x7ef4, FUN_004370af). */
const ENERGY_CAP = 32500;

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
    // after supplying, repairing or building the vehicle stays where it is (FUN_00424ea0 sets flag 0x200)
    if (u.flags & UnitFlag.ACTION_USED) return false;
    // a unit that entered a building or was produced this turn stays inside (FUN_00442f96: flags 0x320)
    if (u.flags & UnitFlag.ENTERED) return false;
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
    if ((u.flags & UnitFlag.MOVED) && (c.flags & COOLDOWN)) return []; // artillery cannot attack after moving (FUN_00443de3, class flag 0x20000)
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

  /**
   * Tyre tracks (SDI_1C.EXE MPW_AnimateMoveStep): every step of an animated move marks the direction on both fields
   * (bit d on the field it leaves, bit d+3 on the one it enters). Only the moves of human players are animated, and
   * classes with flag 0x1000 (NO_TRAILS) leave no tracks.
   */
  private leaveTracks(u: UnitState, path: number[]) {
    const s = this.s;
    if (s.players[u.owner]?.computer || (this.w.cls(u).flags & UCF.NO_TRAILS) || path.length < 2) return;
    const t = (s.tracks ??= new Array<number>(s.width * s.height).fill(0));
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      const d = directionTo(a % s.width, Math.trunc(a / s.width), b % s.width, Math.trunc(b / s.width));
      t[a] |= 1 << d;
      t[b] |= 1 << ((d + 3) % 6);
    }
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
    this.leaveTracks(u, path);
    this.emit('message', { type: 'move', unitId: u.id, path }, u.owner);

    // destination: building, transporter, pick-up or empty field
    const shopId = s.shopAt[target];
    const other = s.unitAt[target] >= 0 ? s.units[s.unitAt[target]] : null;
    if (shopId >= 0) {
      const shop = s.shops[shopId];
      if (shop.owner !== u.owner) this.captureShop(shop.id, u);
      if (u.alive) this.enterShop(u, shop.id);
    } else if (other && !canPickUpKind(w, u, other) && canBoard(w, other, u)) {
      other.cargo.push(u.id);
      u.container = { kind: 'unit', id: other.id };
      // a loaded transporter hands its cargo over to the free places of the other one (FUN_004425fd)
      for (const id of [...u.cargo]) {
        if (other.cargo.length >= 8) break;
        const cu = s.units[id];
        u.cargo = u.cargo.filter((x) => x !== id);
        other.cargo.push(id);
        cu.container = { kind: 'unit', id: other.id };
      }
    } else if (other && canPickUp(w, u, other)) {
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
    // ambush by hidden neighbours (FUN_004436b5), also after entering a building or a transporter
    this.ambush(u);
    // after the move the chip window still offers attacking and diving / climbing (manual p. 58)
    if (u.alive && (u.container || retreating || (!this.hasAttackTargets(u) && !canChangeHeight(this.w, u, true) && !canChangeHeight(this.w, u, false)))) this.unitDone(u);
    updateVisionAll(w);
    this.afterAction();
  }

  private hasAttackTargets(u: UnitState) { return this.attackTargets(u.id).length > 0 || this.structureTargets(u.id).length > 0; }

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

  /**
   * A unit enters a building (game function 0x01, FUN_004425fd). Crystals become material (4 per strength point).
   * A transporter unloads its whole cargo into the building as far as the 16 places allow; crystals in the cargo become
   * material as well.
   */
  private enterShop(u: UnitState, shopId: number) {
    const shop = this.s.shops[shopId];
    const c = this.w.cls(u);
    if (c.flags & UCF.CRYSTAL) {
      shop.material += 4 * u.group;
      this.destroyUnit(u, -1, 'consumed');
      return;
    }
    u.container = { kind: 'shop', id: shopId };
    u.flags |= UnitFlag.ENTERED;
    shop.units.push(u.id);
    for (const id of [...u.cargo]) {
      const cargo = this.s.units[id];
      if (this.w.cls(cargo).flags & UCF.CRYSTAL) { shop.material += 4 * cargo.group; this.destroyUnit(cargo, -1, 'consumed'); continue; }
      if (shop.units.length >= 16) continue;
      cargo.container = { kind: 'shop', id: shopId };
      cargo.flags |= UnitFlag.ENTERED;
      shop.units.push(cargo.id);
      u.cargo = u.cargo.filter((x) => x !== cargo.id);
    }
    u.cargo = u.cargo.filter((id) => this.s.units[id].alive);
  }

  private captureShop(shopId: number, by: UnitState) {
    const s = this.s, shop = s.shops[shopId];
    const prev = shop.owner;
    // capturing a building of an ally ends the alliance on both sides (FUN_004436b5)
    if (prev < NEUTRAL && this.w.isAllied(by.owner, prev) && prev !== by.owner) this.breakAlliance(by.owner, prev);
    if (prev === NEUTRAL) s.players[by.owner].energy += shop.energy; // energy of a neutral building is taken over (FUN_004436b5)
    shop.owner = by.owner;
    s.players[by.owner].shopsTaken = (s.players[by.owner].shopsTaken ?? 0) + 1;
    for (const id of shop.units) {
      const cu = s.units[id];
      if (cu.owner !== by.owner) {
        if (prev < NEUTRAL) s.players[prev].lost++;
        s.players[by.owner].captured++;
        cu.owner = by.owner;
        // GA_F0A_CaptureShop: the flags of the captured units are reset (mask 0xf89f), they can act this turn
        cu.flags &= UnitFlag.ASCENDED | UnitFlag.DIVED;
        cu.moved = 0;
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

  /**
   * Fields with a destructible structure a unit can attack (SDI_1C.EXE ATT_ListTargets, FUN_0043e607): weapons with
   * damage, ammunition and weapon flag 0x200 (raw weapon flags, not a supply slot) may fire at visible empty fields
   * (no unit, no building) whose overlay is destructible (terrain record byte 2 bit 0) and carries a road, path,
   * trench or rail (type bits 0..3).
   */
  structureTargets(unitId: number): { field: number; weapons: number }[] {
    const s = this.s, u = s.units[unitId];
    if (!u.alive || u.container || u.owner !== s.activePlayer || s.outcome) return [];
    if (u.flags & (UnitFlag.ATTACKED | UnitFlag.DONE)) return [];
    const c = this.w.cls(u);
    if ((u.flags & UnitFlag.MOVED) && (c.flags & COOLDOWN)) return [];
    const out: { field: number; weapons: number }[] = [];
    for (let f = 0; f < s.width * s.height; f++) {
      const ov = s.overlay[f];
      if (ov < 0 || s.unitAt[f] >= 0 || s.shopAt[f] >= 0 || !(s.vision[f] & (1 << u.owner))) continue;
      const t = this.data.terrain[ov];
      if (!t || !(t.raw[2] & 1) || !(t.typeMask & 0xf)) continue;
      const x = f % s.width, y = Math.trunc(f / s.width), d = distance(u.x, u.y, x, y);
      let mask = 0;
      c.weapons.forEach((w, i) => {
        if (w.damage > 0 && u.ammo[i] > 0 && !(w.rawTargets & 0xf) && (w.rawTargets & 0x200) && d >= Math.max(1, w.minRange) && d <= w.maxRange) mask |= 1 << i;
      });
      if (mask) out.push({ field: f, weapons: mask });
    }
    return out;
  }

  /**
   * Attack on a structure (SDI_1C.EXE ATT_AttackStructure, FUN_004241f6): a field starts with 10 hit points (divisor
   * 320); every hit removes max(1, experience - 2) + weapon damage / divisor points; at 0 the overlay is removed.
   * Ammunition is used (unless rule 0x2000); the attacker gains no experience.
   */
  attackStructure(unitId: number, field: number, weapon?: number): CommandResult {
    const s = this.s, u = s.units[unitId];
    const t = this.structureTargets(unitId).find((x) => x.field === field);
    if (!t) return { ok: false, reason: 'not a valid target', events: [] };
    const c = this.w.cls(u);
    const wpn = weapon !== undefined && (t.weapons & (1 << weapon)) ? weapon : bestWeapon(c, t.weapons);
    const { events } = this.collect(() => {
      const hpMap = (s.structureHp ??= {});
      const entry = hpMap[field] ?? { hp: 10, divisor: 320 };
      let dmg = Math.max(1, u.experience - 2) + Math.trunc(c.weapons[wpn].damage / entry.divisor);
      if (dmg > entry.hp) dmg = entry.hp;
      const destroyed = dmg === entry.hp;
      this.emit('structure-attack', { attacker: u.id, field, weapon: wpn, hp: entry.hp, damage: dmg, destroyed, overlay: s.overlay[field] }, u.owner);
      if (destroyed) { delete hpMap[field]; s.overlay[field] = -1; } else hpMap[field] = { hp: entry.hp - dmg, divisor: entry.divisor };
      if (!(s.ruleFlags & RF.NO_AMMO_USE)) u.ammo[wpn] = Math.max(0, u.ammo[wpn] - 1);
      u.flags |= UnitFlag.ATTACKED;
      if (!this.canRetreat(u)) this.unitDone(u);
      updateVisionAll(this.w);
      this.afterAction();
    });
    return { ok: true, events };
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

  /** FUN_004407c6: the units on board lose as many as their transporter, before it (FUN_0043739e, recursively). */
  private damage(u: UnitState, losses: number, by: number) {
    if (losses <= 0 || !u.alive) return;
    for (const id of [...u.cargo]) this.damage(this.s.units[id], losses, by);
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

  /**
   * Weather (FUN_0043a15f). For every terrain type on the map whose weather entry differs between the old and the new
   * weather, the program loads the complete 46-byte terrain record of the new weather sprite (graphics, type bits,
   * movement, sight) over it: snow turns water into ice, fields become impassable for some units and so on. Here the
   * fields simply take the index of that record. A mission is loaded with weather 0 and then switched to its initial
   * weather (end of the mission loader, SDI_1C.EXE line "if (DAT_004bf95a != 0) FUN_0043a15f"). Afterwards units that can no longer stand on their field sink
   * (FUN_0044187f).
   */
  applyWeather(weather: number, initial: boolean) {
    const s = this.s, t = this.data.terrain;
    if (weather < 0 || weather > 4) return;
    const prev = initial ? 0 : s.weather;
    if (prev !== weather) {
      const swap = (cur: number) => {
        const ws = t[cur]?.weatherSprites;
        return ws && ws[prev] !== ws[weather] && ws[weather] >= 0 ? ws[weather] : cur;
      };
      for (let i = 0; i < s.terrain.length; i++) {
        if (s.terrain[i] >= 0) s.terrain[i] = swap(s.terrain[i]);
        if (s.overlay[i] >= 0) s.overlay[i] = swap(s.overlay[i]);
      }
    }
    s.weather = weather;
    if (!initial) {
      this.emit('weather', { weather, previous: prev });
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
  /**
   * GA_CheckMissionGoals (SDI_1C.EXE FUN_00415d36), after every action: only on campaign maps (game type 1) and not on
   * the training level. Every fulfilled condition is announced (texts 0x82..0x86, event 'condition') and consumed; a
   * fulfilled victory condition counts for good even if it is undone later (DAT_004bfae5). Victory when the count
   * reaches the required number (with fewer than 2 required: any), defeat as soon as a defeat condition is fulfilled.
   */
  checkConditions() {
    const s = this.s;
    if (s.outcome || s.difficulty === 0 || (s.gameType ?? 1) !== 1) return;
    let defeat: QueuedAction | null = null;
    for (const c of [...s.defeatConditions]) {
      if (!this.conditionMet(c)) continue;
      s.defeatConditions = s.defeatConditions.filter((x) => x !== c);
      this.emit('condition', { type: c.type, param: c.param, shop: c.shop, defeat: true });
      defeat = c;
    }
    const met: QueuedAction[] = [];
    for (const c of [...s.victoryConditions]) {
      if (!this.conditionMet(c)) continue;
      s.victoryConditions = s.victoryConditions.filter((x) => x !== c);
      this.emit('condition', { type: c.type, param: c.param, shop: c.shop, defeat: false });
      met.push(c);
    }
    s.victoryMet = (s.victoryMet ?? 0) + met.length;
    if (defeat) {
      s.victoryMet = 0;
      s.outcome = { result: 'defeat', turn: s.turn, conditions: [defeat.type] };
      this.emit('defeat', { condition: defeat });
      return;
    }
    const required = s.requiredVictoryConditions;
    if (required < 2 ? s.victoryMet > 0 : s.victoryMet >= required) {
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
      // multiplayer maps (game type 2): players without units and without a production building drop out, the game
      // ends when fewer than two are left (MCP_CheckMultiPlayerGamePlayers / MCP_MultiPlayerGameCheckEnd)
      if (s.gameType === 2 && this.eliminatePlayers()) return;
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

  /** Returns true when the multiplayer game is over (outcome set, winner or nobody). */
  private eliminatePlayers(): boolean {
    const s = this.s;
    for (const pl of s.players) {
      if (!pl.alive || pl.index >= NEUTRAL) continue;
      const hasUnits = s.units.some((u) => u.alive && u.owner === pl.index);
      const hasFactory = s.shops.some((sh) => sh.owner === pl.index && (shopFunction(sh) & SF.PRODUCTION));
      if (!hasUnits && !hasFactory) {
        pl.alive = false;
        this.emit('player-out', { player: pl.index });
      }
    }
    const left = s.players.filter((p) => p.alive && p.index < NEUTRAL);
    if (left.length >= 2) return false;
    s.outcome = { result: left.length ? 'victory' : 'defeat', turn: s.turn, conditions: [], winner: left[0]?.index };
    this.emit(left.length ? 'victory' : 'defeat', { winner: left[0]?.index ?? -1 });
    return true;
  }

  /**
   * FUN_0040d4c4 at every change of the active player: all aircraft on the map (of every player) lose one point of
   * fuel and crash without fuel; then the income of the new player (FUN_004370af / FUN_00437284, capped at 32500).
   */
  private startPlayerTurn(p: number) {
    const s = this.s, w = this.w;
    for (const u of s.units) {
      if (!u.alive) continue;
      if (u.owner === p) {
        u.flags &= UnitFlag.ASCENDED | UnitFlag.DIVED;
        u.moved = 0;
      }
      if (!u.container && (w.cls(u).flags & UCF.PLANE)) {
        u.fuel = Math.max(0, u.fuel - 1);
        if (u.fuel <= 0) { this.destroyUnit(u, -1, 'crashed'); this.emit('crashed', { unitId: u.id }); }
      }
    }
    for (const shop of s.shops) {
      if (shop.owner !== p) continue;
      s.players[p].energy = Math.min(ENERGY_CAP, s.players[p].energy + shop.energyPlus);
      shop.material = Math.min(ENERGY_CAP, shop.material + shop.materialPlus);
    }
    // setup option "Units autom. betanken": units in buildings are repaired and refilled (rule flags 0x80 / 0x100)
    if (s.ruleFlags & (RF.AUTO_REPAIR | RF.AUTO_REFUEL)) {
      for (const u of s.units) {
        if (!u.alive || u.owner !== p || u.container?.kind !== 'shop') continue;
        const shop = s.shops[u.container.id], pl = s.players[p];
        if (s.ruleFlags & RF.AUTO_REPAIR) {
          const n = repairFrom(w, u, pl.energy, shop.material);
          pl.energy -= n; shop.material -= n;
        }
        if (s.ruleFlags & RF.AUTO_REFUEL) {
          const used = refillFrom(w, u, pl.energy, shop.material);
          if (used) { pl.energy = Math.max(0, pl.energy - used[0]); shop.material = Math.max(0, shop.material - used[1]); }
        }
      }
    }
    updateVision(w, p);
  }

  // ------------------------------------------------------------------ buildings
  /**
   * Unit types a building can produce now (FUN_00436e51 with the check 0x2b, FUN_00444c40): only buildings with the
   * production function, owned by the active player. The list holds every type released for the player by the mission
   * plus the 4 production entries of the building, each if the player's energy and the building's material suffice.
   * The original does not filter the list by the kind of factory.
   */
  producible(shopId: number): number[] {
    const s = this.s, shop = s.shops[shopId];
    if (!(shopFunction(shop) & SF.PRODUCTION) || shop.owner >= NEUTRAL) return [];
    const computer = s.players[shop.owner].computer;
    const energy = s.players[shop.owner].energy;
    const out: number[] = [];
    const ok = (t: number) => {
      const c = this.data.unitClasses[t];
      return c && c.costEnergy <= energy && c.costMaterial <= shop.material;
    };
    const flags = s.productionFlags;
    for (let t = 0; t < 64; t++) if ((flags[t] & 1) && (!computer || (flags[t] & 2)) && ok(t)) out.push(t);
    for (const t of shop.production) if (t > 0 && (!computer || (flags[t] & 2)) && ok(t)) out.push(t);
    return out;
  }

  /** Builds a unit in a building (game function 0x2f, FUN_0042550b). */
  produce(shopId: number, type: number): CommandResult {
    const s = this.s, shop = s.shops[shopId];
    if (shop.owner !== s.activePlayer || !this.producible(shopId).includes(type)) return { ok: false, reason: 'cannot produce', events: [] };
    if (shop.units.length >= 16) return { ok: false, reason: 'building full', events: [] };
    const { events } = this.collect(() => {
      const c = this.data.unitClasses[type];
      s.players[shop.owner].energy -= c.costEnergy;
      shop.material -= c.costMaterial;
      const u = createUnit(s, this.data, type, shop.owner, shop.x, shop.y);
      // one experience point per training camp of the player, at most 4 (FUN_0042550b)
      u.experience = Math.min(4, s.shops.filter((x) => x.owner === shop.owner && (shopFunction(x) & SF.TRAINING_CAMP)).length);
      u.container = { kind: 'shop', id: shopId };
      u.flags |= UnitFlag.DONE | UnitFlag.ENTERED;
      shop.units.push(u.id);
      s.players[shop.owner].produced++;
      this.emit('message', { type: 'produced', unitId: u.id, shopId }, shop.owner);
      this.afterAction();
    });
    return { ok: true, events };
  }

  /**
   * Refuel / rearm a unit inside a building (game function 0x39 with a building, FUN_00440d99): 100 fuel = 1 energy of
   * the player, 100 ammunition = 1 material of the building, at least 1 each. Unlike repairing it costs no experience
   * (the manual says so, the program does not do it).
   */
  refuelInShop(unitId: number): CommandResult {
    const s = this.s, u = s.units[unitId];
    if (u.container?.kind !== 'shop' || u.owner !== s.activePlayer) return { ok: false, reason: 'not in a building', events: [] };
    const shop = s.shops[u.container.id];
    // not in the turn the unit entered (unit flag 0x100) and only with energy in stock (FUN_00445118)
    if ((u.flags & UnitFlag.ENTERED) || s.players[u.owner].energy <= 0) return { ok: false, reason: 'not possible now', events: [] };
    const { events } = this.collect(() => {
      const used = refillFrom(this.w, u, s.players[u.owner].energy, shop.material);
      if (used) {
        s.players[u.owner].energy = Math.max(0, s.players[u.owner].energy - used[0]);
        shop.material = Math.max(0, shop.material - used[1]);
      }
      this.emit('message', { type: 'refuel', unitId }, u.owner);
    });
    return { ok: true, events };
  }

  /** Repair in a building: one energy and one material per point of strength, costs one experience point (FUN_0044156d). */
  repairInShop(unitId: number): CommandResult {
    const s = this.s, u = s.units[unitId];
    if (u.container?.kind !== 'shop' || u.owner !== s.activePlayer) return { ok: false, reason: 'not in a building', events: [] };
    const shop = s.shops[u.container.id];
    // not in the turn the unit entered (unit flag 0x100, FUN_00445319)
    if (u.flags & UnitFlag.ENTERED) return { ok: false, reason: 'entered this turn', events: [] };
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

  // ------------------------------------------------------------------ supply, construction, height (support.ts)
  /**
   * May the unit perform a special action now? Not after attacking; a unit that has not moved may serve up to six
   * neighbours (manual p. 61), the check functions of the original test no "action used" flag.
   */
  private canAct(u: UnitState) {
    return u.alive && !u.container && u.owner === this.s.activePlayer && !this.s.outcome
      && !(u.flags & (UnitFlag.DONE | UnitFlag.ATTACKED));
  }

  /** Neighbouring units a supply / repair vehicle can serve (game functions 0x1b / 0x3a). */
  supportTargets(unitId: number): { refill: number[]; repair: number[] } {
    const u = this.s.units[unitId], w = this.w;
    const out = { refill: [] as number[], repair: [] as number[] };
    if (!this.canAct(u)) return out;
    for (const p of w.neighbours(u.x, u.y)) {
      const t = p && w.unitAt(p.x, p.y);
      if (!t || t.id === u.id) continue;
      if (refillNeed(w, t) && canRefill(w, u, t)) out.refill.push(t.id);
      if (repairNeed(w, t) > 0 && canRepair(w, u, t)) out.repair.push(t.id);
    }
    return out;
  }

  /** After a special action the unit is finished if it has already moved (FUN_00424ea0: flag 0x20 -> FUN_00442b3a). */
  private afterSpecialAction(u: UnitState) {
    u.flags |= UnitFlag.ACTION_USED;
    if (u.flags & UnitFlag.MOVED) this.unitDone(u);
    this.afterAction();
  }

  refillUnit(unitId: number, targetId: number): CommandResult {
    const u = this.s.units[unitId];
    if (!this.supportTargets(unitId).refill.includes(targetId)) return { ok: false, reason: 'cannot refill', events: [] };
    const { events } = this.collect(() => {
      refillByUnit(this.w, u, this.s.units[targetId]);
      this.emit('message', { type: 'refuel', unitId: targetId, by: unitId }, u.owner);
      this.afterSpecialAction(u);
    });
    return { ok: true, events };
  }

  repairUnit(unitId: number, targetId: number): CommandResult {
    const u = this.s.units[unitId];
    if (!this.supportTargets(unitId).repair.includes(targetId)) return { ok: false, reason: 'cannot repair', events: [] };
    const { events } = this.collect(() => {
      repairByUnit(this.w, u, this.s.units[targetId]);
      this.emit('message', { type: 'repair', unitId: targetId, by: unitId }, u.owner);
      this.afterSpecialAction(u);
    });
    return { ok: true, events };
  }

  /** Construction targets of a vehicle: field -> bit set of Build values (road, rail, trench, demolish). */
  buildTargets(unitId: number): Map<number, number> {
    const u = this.s.units[unitId];
    if (!this.canAct(u)) return new Map();
    this.s.buildMask ??= initialBuildMask(this.w);
    return buildTargets(this.w, u, this.s.buildMask);
  }

  build(unitId: number, field: number, what: number): CommandResult {
    const u = this.s.units[unitId];
    const opt = this.buildTargets(unitId).get(field) ?? 0;
    if (!(opt & (1 << what))) return { ok: false, reason: 'cannot build here', events: [] };
    const { events } = this.collect(() => {
      if (buildOn(this.w, u, field, what)) {
        this.emit('map-change', { field, build: what, unitId });
        updateVisionAll(this.w);
      }
      this.afterSpecialAction(u);
    });
    return { ok: true, events };
  }

  /** Climb / surface (up) or descend / dive (down) by one level. */
  canChangeHeight(unitId: number, up: boolean): boolean {
    const u = this.s.units[unitId];
    return u.alive && !u.container && u.owner === this.s.activePlayer && !this.s.outcome && !(u.flags & UnitFlag.DONE)
      && canChangeHeight(this.w, u, up);
  }

  changeHeight(unitId: number, up: boolean): CommandResult {
    if (!this.canChangeHeight(unitId, up)) return { ok: false, reason: 'cannot change height', events: [] };
    const u = this.s.units[unitId];
    const { events } = this.collect(() => {
      changeHeight(u, up);
      this.emit('message', { type: 'height', unitId, up }, u.owner);
      updateVisionAll(this.w);
      this.afterAction();
    });
    return { ok: true, events };
  }

  /**
   * Campaign training (game functions 0x43-0x45, FUN_00422864 / FUN_00422b54): a unit in a building that is neither a
   * training camp nor a city gains one experience point per training point of its category (ground, water, air), up to 11.
   */
  canTrain(unitId: number): boolean {
    const s = this.s, u = s.units[unitId];
    if (u.container?.kind !== 'shop' || u.owner !== s.activePlayer || s.outcome) return false;
    if (shopFunction(s.shops[u.container.id]) & (SF.TRAINING_CAMP | SF.CITY)) return false;
    if (u.experience >= MAX_XP || (u.flags & UnitFlag.ENTERED)) return false;
    const pts = s.players[u.owner].trainingPoints;
    return !!pts && pts[trainingCategory(this.w.cls(u).flags >>> 0)] > 0;
  }

  /**
   * Chip "?" (event 11, SDI_1C.EXE WU_EditUnitName): own units and units of allied computer players can be named
   * (manual p. 60 "Eigenname", at most 16 characters, may be renamed); enemy units cannot.
   */
  canRenameUnit(unitId: number): boolean {
    const s = this.s, u = s.units[unitId];
    if (!u?.alive || s.outcome) return false;
    const me = s.activePlayer;
    return u.owner === me || (u.owner < NEUTRAL && this.w.isAllied(me, u.owner) && s.players[u.owner].computer);
  }

  renameUnit(unitId: number, name: string): CommandResult {
    if (!this.canRenameUnit(unitId)) return { ok: false, reason: 'cannot name this unit', events: [] };
    const u = this.s.units[unitId];
    const n = name.slice(0, 16).trim();
    if (n) u.name = n; else delete u.name;
    return { ok: true, events: [] };
  }

  train(unitId: number): CommandResult {
    if (!this.canTrain(unitId)) return { ok: false, reason: 'cannot train', events: [] };
    const s = this.s, u = s.units[unitId];
    const { events } = this.collect(() => {
      const pts = s.players[u.owner].trainingPoints!;
      pts[trainingCategory(this.w.cls(u).flags >>> 0)]--;
      u.experience = Math.min(MAX_XP, u.experience + 1);
      this.emit('message', { type: 'train', unitId }, u.owner);
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
