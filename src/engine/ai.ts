// Computer opponent. PROVISIONAL: a heuristic AI using the original combat formula for its
// evaluations; the original AI (SDI_1C.EXE module CO_*, "Computergegner Thomas Häuser") is not yet
// reconstructed. Honours the mission AI orders (0 attack, 1 defend, 64 hold position).
import type { Game } from './game.ts';
import type { UnitState } from './state.ts';
import { NEUTRAL, UnitFlag } from './state.ts';
import { distance } from './hex.ts';
import { UCF } from './classes.ts';
import { usableWeapons, bestWeapon } from './combat.ts';
import { toCombatant } from './combatant.ts';

const AI_HOLD = 64;
const AI_DEFEND = 1;

interface Plan { target: number; score: number; attack?: { unitId: number; weapon: number } }

export class ComputerPlayer {
  private game: Game;
  constructor(game: Game) {
    this.game = game;
  }

  /** Plays the whole turn of the active (computer) player; returns when the turn is over. */
  playTurn(maxActions = 400) {
    const g = this.game, s = g.state, p = s.activePlayer;
    this.planObjectives();
    this.produceTurn();
    let actions = 0;
    const order = g.unitsOf(p).sort((a, b) => this.unitOrder(b) - this.unitOrder(a));
    for (const u of order) {
      if (s.outcome || actions++ > maxActions) break;
      if (!u.alive || u.owner !== p) continue;
      this.actUnit(u);
    }
  }

  /** Executes a single unit's best action (exported for tests / step-wise animation). */
  actUnit(u: UnitState) {
    const g = this.game;
    if (u.flags & UnitFlag.DONE) return;
    // supply and repair vehicles serve their neighbours first (the original AI issues CMD_REFILLUNIT / CMD_REPAIRUNIT)
    const sup = g.supportTargets(u.id);
    if (sup.repair.length || sup.refill.length) {
      for (const t of sup.repair) g.repairUnit(u.id, t);
      for (const t of g.supportTargets(u.id).refill) g.refillUnit(u.id, t);
      if (u.alive && !(u.flags & UnitFlag.DONE)) g.skipUnit(u.id);
      return;
    }
    // attack without moving if that is good enough
    const here = this.bestAttack(u, u.x, u.y);
    const cls = g.data.unitClasses[u.type];
    const holds = u.aiOrder === AI_HOLD || cls.moveRange === 0;
    let plan: Plan | null = null;
    if (!holds && g.canMove(u)) plan = this.bestMove(u, here);
    if (plan && plan.target !== g.w.idx(u.x, u.y) && (!here || plan.score > here.score + 1)) {
      g.moveUnit(u.id, plan.target);
      if (!u.alive) return;
      if (plan.attack && g.attackTargets(u.id).some((t) => t.unitId === plan!.attack!.unitId)) {
        g.attack(u.id, plan.attack.unitId, plan.attack.weapon);
      }
    } else if (here) {
      g.attack(u.id, here.attack!.unitId, here.attack!.weapon);
    }
    if (u.alive && !(u.flags & UnitFlag.DONE)) g.skipUnit(u.id);
  }

  /** Units with long-range weapons act first. */
  unitOrder(u: UnitState) {
    const c = this.game.data.unitClasses[u.type];
    return Math.max(...c.weapons.map((w) => w.maxRange)) * 100 + c.weapons.reduce((s, w) => s + w.damage, 0) / 10;
  }

  /** Visible enemy units of a player (computed once per unit decision). */
  private enemiesOf(player: number): UnitState[] {
    const g = this.game, w = g.w;
    return w.unitsOnMap().filter((t) => t.owner < NEUTRAL && t.owner !== player && !w.isAllied(player, t.owner) && g.visibleTo(player, t.id));
  }

  /** Expected value of attacking from (x, y): damage dealt minus damage taken (weighted by unit value). */
  private bestAttack(u: UnitState, x: number, y: number, enemies = this.enemiesOf(u.owner)): Plan | null {
    const g = this.game, w = g.w;
    const cls = w.cls(u);
    if ((u.flags & UnitFlag.ATTACKED) || ((u.flags & UnitFlag.MOVED || x !== u.x || y !== u.y) && (cls.flags & UCF.COOLDOWN))) return null;
    const maxRange = Math.max(...cls.weapons.map((wp) => (wp.damage > 0 ? wp.maxRange : 0)));
    if (maxRange <= 0) return null;
    let best: Plan | null = null;
    const me = toCombatant(w, u);
    me.x = x; me.y = y;
    for (const t of enemies) {
      const d = distance(x, y, t.x, t.y);
      if (d > maxRange) continue;
      let mask = usableWeapons(me, toCombatant(w, t));
      cls.weapons.forEach((wp, i) => { if (d < Math.max(1, wp.minRange) || d > wp.maxRange) mask &= ~(1 << i); });
      if (!mask) continue;
      const weapon = bestWeapon(cls, mask);
      const r = g.previewCombat(u, weapon, t, { x, y });
      const valueT = unitValue(g, t) * (this.threatened.has(t.id) ? 10 : this.priorityTargets.has(t.id) ? 3 : 1), valueU = unitValue(g, u);
      const score = (r.defenderLosses / Math.max(1, t.group)) * valueT * (r.defenderLosses >= t.group ? 1.5 : 1)
        - (r.attackerLosses / Math.max(1, u.group)) * valueU;
      if (r.defenderLosses > 0 && (!best || score > best.score)) best = { target: w.idx(x, y), score, attack: { unitId: t.id, weapon } };
    }
    return best;
  }

  /** Units the mission objectives want destroyed (computed per turn). */
  private priorityTargets = new Set<number>();
  /** Objective fields with weights for the active player (computed per turn). */
  private objectives: { x: number; y: number; weight: number; occupy: boolean }[] = [];
  /** Own buildings whose loss loses the mission: keep them garrisoned. */
  private guard = new Set<number>();
  /** Enemy occupiers threatening a guarded building. */
  private threatened = new Set<number>();

  /** Derives goals from the mission conditions: own victory conditions and the opponents' defeat conditions. */
  planObjectives() {
    const g = this.game, s = g.state, p = s.activePlayer, w = g.w;
    this.objectives = [];
    this.priorityTargets.clear();
    this.guard.clear();
    this.threatened.clear();
    const mine = (pl: number) => pl === p || (pl < NEUTRAL && w.isAllied(p, pl));
    const wantShop = (id: number, weight: number) => {
      const shop = s.shops[id];
      if (shop && !mine(shop.owner)) this.objectives.push({ x: shop.x, y: shop.y, weight, occupy: true });
    };
    const humanSide = !!s.victoryConditions.length && s.players.some((pl) => pl.alive && !pl.computer && w.isAllied(p, pl.index));
    for (const c of s.victoryConditions) {
      if (!humanSide && !mine(c.type === 9 ? c.param : c.shop)) continue;
      if (c.type === 9 && mine(c.param)) wantShop(c.shop, 8);
      if (c.type === 8) for (const u of g.unitsOf(c.param)) this.priorityTargets.add(u.id);
      if (c.type === 11 && mine(c.shop)) this.objectives.push({ x: c.param & 63, y: c.param >> 6, weight: 6, occupy: false });
      if (c.type === 12) for (const u of g.unitsOf(c.shop)) if (u.type === c.param) this.priorityTargets.add(u.id);
    }
    for (const c of s.defeatConditions) {
      // buildings we must not lose
      const shop = s.shops[c.shop];
      if (shop && mine(shop.owner) && ((c.type === 9 && !mine(c.param)) || (c.type === 14 && mine(c.param)))) this.guard.add(shop.id);
      // what makes the (human) side lose is what its opponents want
      if (c.type === 9 && mine(c.param)) wantShop(c.shop, 8);
      if (c.type === 14 && !mine(c.param)) wantShop(c.shop, 8);
      if (c.type === 8 && !mine(c.param)) for (const u of g.unitsOf(c.param)) this.priorityTargets.add(u.id);
    }
    // enemy units able to occupy a guarded building soon are the most urgent targets
    for (const id of this.guard) {
      const shop = s.shops[id];
      for (const e of w.unitsOnMap()) {
        if (mine(e.owner) || e.owner >= NEUTRAL) continue;
        const ec = g.data.unitClasses[e.type];
        if ((ec.flags & UCF.OCCUPY) && distance(e.x, e.y, shop.x, shop.y) <= (ec.moveRange >> 3) + 2) {
          this.priorityTargets.add(e.id);
          this.threatened.add(e.id);
        }
      }
    }
  }

  private bestMove(u: UnitState, here: Plan | null): Plan | null {
    const g = this.game, w = g.w, s = g.state;
    const area = g.moveArea(u.id);
    if (!area.targets.size) return null;
    const cls = w.cls(u);
    const occupier = (cls.flags & UCF.OCCUPY) !== 0;
    const enemies = this.enemiesOf(u.owner);
    const goals: { x: number; y: number; weight: number }[] = [];
    for (const o of this.objectives) goals.push({ x: o.x, y: o.y, weight: o.occupy && !occupier ? o.weight / 3 : o.weight });
    for (const e of enemies) goals.push({ x: e.x, y: e.y, weight: this.priorityTargets.has(e.id) ? 3 : 1 });
    for (const shop of s.shops) {
      if (shop.owner === u.owner || (shop.owner < NEUTRAL && w.isAllied(u.owner, shop.owner))) continue;
      if (!(s.explored[w.idx(shop.x, shop.y)] & (1 << u.owner)) && enemies.length) continue;
      goals.push({ x: shop.x, y: shop.y, weight: occupier ? 3 : 0.5 });
    }
    if (!goals.length) for (const e of w.unitsOnMap()) if (w.isEnemyOf(u.owner, e)) goals.push({ x: e.x, y: e.y, weight: 0.5 });
    const goalDist = (x: number, y: number) => {
      let best = 99;
      for (const gl of goals) best = Math.min(best, distance(x, y, gl.x, gl.y) / gl.weight);
      return best;
    };
    const defending = u.aiOrder === AI_DEFEND;
    const startGoal = goalDist(u.x, u.y);
    const maxRange = Math.max(0, ...cls.weapons.map((wp) => (wp.damage > 0 ? wp.maxRange : 0)));
    let best: Plan | null = here ? { ...here } : null;
    for (const [f] of area.targets) {
      const x = f % s.width, y = Math.trunc(f / s.width);
      let score = 0;
      const shopId = s.shopAt[f];
      if (shopId >= 0) {
        const owner = s.shops[shopId].owner;
        if (owner !== u.owner && owner < NEUTRAL && w.isAllied(u.owner, owner)) continue; // never take allied buildings
        if (owner !== u.owner && occupier) score += 50 + (this.objectives.some((o) => o.x === x && o.y === y) ? 200 : 0);
      }
      if (this.objectives.some((o) => !o.occupy && o.x === x && o.y === y)) score += 120;
      if (shopId >= 0 && this.guard.has(shopId) && !s.shops[shopId].units.length) score += 400;
      const near = enemies.filter((e) => distance(x, y, e.x, e.y) <= maxRange + 1);
      const att = near.length ? this.bestAttack(u, x, y, near) : null;
      if (att) score += att.score + 5;
      if (goals.length) score += (startGoal - goalDist(x, y)) * 2;
      if (defending) score -= distance(x, y, u.x, u.y) * 3;
      // avoid ending next to enemies that can hit us
      for (const e of near) if (distance(x, y, e.x, e.y) === 1 && usableWeapons(toCombatant(w, e), { ...toCombatant(w, u), x, y })) score -= 2;
      if (!best || score > best.score) best = { target: f, score, attack: att?.attack };
    }
    return best;
  }

  produceTurn() {
    const g = this.game, s = g.state, p = s.activePlayer;
    for (const shop of s.shops) {
      if (shop.owner !== p) continue;
      for (let n = 0; n < 2; n++) {
        const options = g.producible(shop.id);
        if (!options.length || shop.units.length >= 12) break;
        // keep a reserve: only spend half of the energy per building and turn
        const best = options.map((t) => ({ t, v: unitValueByType(g, t) })).sort((a, b) => b.v - a.v)[0];
        const c = g.data.unitClasses[best.t];
        if (c.costEnergy > s.players[p].energy / 2) break;
        g.produce(shop.id, best.t);
      }
    }
  }
}

function unitValueByType(g: Game, t: number) {
  const c = g.data.unitClasses[t];
  return c.costEnergy + c.costMaterial + c.weapons.reduce((s, w) => s + w.damage, 0) / 50 + c.armor / 50;
}

function unitValue(g: Game, u: UnitState) {
  return unitValueByType(g, u.type) * (1 + u.experience / 6);
}
