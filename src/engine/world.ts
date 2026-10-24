// Read-only helpers over GameState + GameData shared by the rule modules.
import type { GameData, UnitClassInfo } from '../data/gamedata.ts';
import { NEUTRAL, type GameState, type ShopState, type UnitState } from './state.ts';
import { neighbours, type Pos } from './hex.ts';
import { UCF } from './classes.ts';

/** Function bits of a building (1 HQ, 2 production, 4 depot, 8 training camp, 16 city); derived from the type for old saves. */
export function shopFunction(shop: ShopState): number {
  if (shop.func !== undefined) return shop.func;
  const t = shop.type;
  return (t & 1 ? 1 : 0) | (t & 14 ? 2 : 0) | (t & 16 ? 4 : 0) | (t & 64 ? 8 : 0) | (t & 32 ? 16 : 0);
}
export const SF = { HQ: 1, PRODUCTION: 2, DEPOT: 4, TRAINING_CAMP: 8, CITY: 16 } as const;

export class World {
  readonly data: GameData;
  readonly state: GameState;
  constructor(data: GameData, state: GameState) {
    this.data = data;
    this.state = state;
  }

  get width() { return this.state.width; }
  get height() { return this.state.height; }
  idx(x: number, y: number) { return y * this.state.width + x; }
  inside(x: number, y: number) { return x >= 0 && y >= 0 && x < this.state.width && y < this.state.height; }
  /** The outermost ring of the map cannot be entered or seen (SDI_1C.EXE FUN_0043ae65). */
  playable(x: number, y: number) { return x >= 1 && y >= 1 && x <= this.state.width - 2 && y <= this.state.height - 2; }
  neighbours(x: number, y: number): (Pos | null)[] { return neighbours(x, y, this.state.width, this.state.height); }

  cls(u: UnitState): UnitClassInfo { return this.data.unitClasses[u.type]; }
  unitAt(x: number, y: number): UnitState | null {
    const id = this.state.unitAt[this.idx(x, y)];
    return id >= 0 ? this.state.units[id] : null;
  }
  shopAt(x: number, y: number): ShopState | null {
    const id = this.state.shopAt[this.idx(x, y)];
    return id >= 0 ? this.state.shops[id] : null;
  }

  /** Lowest set bit of a terrain type mask (FUN_0041f1f0); 0 when no bit is set. */
  static lowestBit(mask: number): number {
    for (let b = 0; b <= 22; b++) if (mask & (1 << b)) return b;
    return 0;
  }
  groundMask(x: number, y: number) { return this.data.terrain[this.state.terrain[this.idx(x, y)]]?.typeMask ?? 0; }
  overlayMask(x: number, y: number) {
    const o = this.state.overlay[this.idx(x, y)];
    return o >= 0 ? this.data.terrain[o]?.typeMask ?? 0 : -1;
  }
  /** Terrain bit of a field for combat: overlay before ground (FUN_00415630 local_8). */
  combatTerrainBit(x: number, y: number): number {
    const o = this.overlayMask(x, y);
    return World.lowestBit(o >= 0 ? o : this.groundMask(x, y));
  }
  /** Water field without bridge/overlay (FUN_0041f247). */
  isOpenWater(x: number, y: number) {
    return (this.groundMask(x, y) & 0x70000) !== 0 && this.state.overlay[this.idx(x, y)] < 0;
  }

  ownerMask(owner: number) { return owner < 7 ? 1 << owner : 0; }
  allies(player: number) { return player < 6 ? this.state.players[player].allies : 1 << NEUTRAL; }
  isAllied(player: number, other: number) {
    if (player === other) return true;
    if (player >= 6 || other >= 6) return false;
    return (this.state.players[player].allies & (1 << other)) !== 0;
  }
  isEnemyOf(player: number, u: UnitState) { return u.owner !== player && u.owner < NEUTRAL && !this.isAllied(player, u.owner); }

  /** Hit points of a fresh unit of this class. */
  maxGroup(c: UnitClassInfo) { return Math.max(1, c.strength); }
  isTransporter(c: UnitClassInfo) { return (c.flags & UCF.TRANSPORTER) !== 0; }
  unitsOnMap(): UnitState[] { return this.state.units.filter((u) => u.alive && !u.container); }
}
