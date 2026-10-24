// Prints the outcome of typical duels (equal terrain, no random, given experience) with the engine's combat code.
import { NodeSource } from '../lib/node-source.ts';
import { loadGameData } from '../../src/data/gamedata.ts';
import { resolveCombat, usableWeapons, bestWeapon, XP_TABLE } from '../../src/engine/combat.ts';
import { DIFFICULTY_FLAGS, Difficulty } from '../../src/engine/rules.ts';
import { createGame } from '../../src/engine/setup.ts';
import { Game } from '../../src/engine/game.ts';
import { toCombatant } from '../../src/engine/combatant.ts';
const data = await loadGameData(new NodeSource());
const lm = await data.loadMission(100);
const g = new Game(data, createGame(data, lm, { setId: 0, difficulty: Difficulty.NORMAL }));
const types = [...new Set(g.state.units.map((u) => u.type))];
console.log('classes in MISS100:', types.map((t) => `${t}:${data.unitClasses[t].name}(n=${data.unitClasses[t].strength},arm=${data.unitClasses[t].armor})`).join(' '));
const rows: string[] = [];
for (const at of types) for (const dt of types) {
  const A = g.state.units.find((u) => u.type === at)!, D = g.state.units.find((u) => u.type === dt && u.id !== A.id) ?? g.state.units.find((u) => u.type === dt)!;
  const ac = toCombatant(g.w, A), dc = toCombatant(g.w, D);
  dc.x = ac.x + 1; dc.y = ac.y; // adjacent for a sensible comparison
  const mask = usableWeapons(ac, dc);
  if (!mask) continue;
  const wpn = bestWeapon(data.unitClasses[at], mask);
  const back = bestWeapon(data.unitClasses[dt], usableWeapons(dc, ac));
  for (const xp of [0, 4]) {
    ac.experience = 0; dc.experience = xp;
    const r = resolveCombat({
      attacker: ac, attackerWeapon: wpn, defender: dc, defenderWeapon: back, neighbourOwners: [0, 0, 0, 0, 0, 0], attackerAllies: 1,
      flags: DIFFICULTY_FLAGS[Difficulty.NORMAL].combat, terrain: { terrainBit: () => 9, agility: Array(32).fill(0), firepower: Array(32).fill(0) }, mapWidth: 40, mapHeight: 40,
    });
    if (xp === 0) rows.push(`${data.unitClasses[at].name.padEnd(12)} (${ac.group}) -> ${data.unitClasses[dt].name.padEnd(12)} (${dc.group}) wpn ${data.unitClasses[at].weapons[wpn].damage}  dmg to def ${r.defenderLosses}/${dc.group}, to att ${r.attackerLosses}/${ac.group}  (xp 0/0)`);
    else rows.push(`    defender xp ${xp}: to def ${r.defenderLosses}, to att ${r.attackerLosses}`);
  }
}
console.log(rows.slice(0, 70).join('\n'));
console.log('XP_TABLE', XP_TABLE.join(','));
