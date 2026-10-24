import type { World } from './world.ts';
import type { UnitState } from './state.ts';
import type { Combatant } from './combat.ts';

export function toCombatant(w: World, u: UnitState): Combatant {
  return { cls: w.cls(u), group: u.group, experience: u.experience, layer: u.layer, ammo: u.ammo, x: u.x, y: u.y, ownerMask: w.ownerMask(u.owner) };
}
