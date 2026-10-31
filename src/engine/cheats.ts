// Hidden developer cheats of the original (SDI_1C.EXE w_sdi_cheat.c, CHT_KeyWatcher / CHT_CheatMenu): typing "ewald"
// enables them, F9 then opens the "Cheat Menu", ESC disables them again; typing "BAUER" hands the allied computer
// players to the human players. The menu has nine items; the first value of each item means "no change".
import type { Game } from './game.ts';
import { NEUTRAL, UnitFlag } from './state.ts';
import { RF } from './rules.ts';
import { updateVisionAll } from './vision.ts';

export const CHEAT_ITEMS: string[][] = [
  ['Mission fortsetzen', 'Mission gewonnen', 'Mission verloren'],
  ['Unit nicht auffüllen', 'Unit auffüllen', 'Unit entleeren'],
  ['Erfahrung nicht ändern', 'Erfahrung 0', 'Erfahrung 4', 'Erfahrung 8', 'Erfahrung 10', 'Erfahrung 11'],
  ['U-Boote nicht sichtbar', 'U-Boote sichtbar'],
  ['Anzahl nicht ändern', '1 Unit', '5 Unit', '10 Unit'],
  ['Aufklärung nicht ändern', 'Alles aufgeklärt', 'Nicht alles aufgeklärt'],
  ['Computer an', 'Computer aus'],
  ['Besitzer nicht ändern', 'Besitz übernehmen'],
  ['Allierte nicht ändern', 'Alliierte steuern', 'Alliierte Computer'],
];

/** Typed keys: "ewald" enables the cheats, ESC resets, "BAUER" lets the active player control his computer allies. */
export class CheatWatcher {
  enabled = false;
  private typed = '';
  /** Returns 'menu' when F9 is pressed with cheats enabled, 'bauer' after typing BAUER. */
  key(key: string): 'menu' | 'bauer' | null {
    if (key === 'Escape') { this.typed = ''; this.enabled = false; return null; }
    if (key === 'F9') return this.enabled ? 'menu' : null;
    if (key.length !== 1) return null;
    this.typed = (this.typed + key).slice(-5);
    if (this.typed === 'ewald') this.enabled = true;
    if (this.typed === 'BAUER') { this.typed = ''; return 'bauer'; }
    return null;
  }
}

/** Allied computer players of the active player become human ("BAUER", "Alliierte steuern") or computer again. */
export function setAlliedComputers(g: Game, human: boolean) {
  const s = g.state, me = s.activePlayer;
  for (const p of s.players) {
    if (p.index === me || p.index >= NEUTRAL || !g.w.isAllied(me, p.index)) continue;
    if (human && p.computer) { p.computer = false; p.cheatControlled = true; }
    if (!human && p.cheatControlled) { p.computer = true; delete p.cheatControlled; }
  }
}

/** CHT_CheatMenu: applies the chosen values (index per item) to the game and the unit on the cursor field. */
export function applyCheatMenu(g: Game, values: number[], cursorField: number) {
  const s = g.state, w = g.w;
  if (values[0] === 1) g.forceOutcome('victory');
  if (values[0] === 2) g.forceOutcome('defeat');
  const id = cursorField >= 0 ? s.unitAt[cursorField] : -1;
  const u = id >= 0 ? s.units[id] : null;
  if (u && u.alive && !u.container) {
    const c = w.cls(u);
    if (values[1] === 1 || values[1] === 2) {
      const full = values[1] === 1;
      u.fuel = full ? c.fuel : 0;
      u.ammo = c.weapons.map((wp) => (full ? Math.max(0, wp.ammo) : 0));
      // the original clears the flags 0x20/0x40/0x80/0x100: the unit can act again
      u.flags &= UnitFlag.ASCENDED | UnitFlag.DIVED;
      u.moved = 0;
    }
    if (values[4]) u.group = [0, 1, 5, 10][values[4]];
    if (values[2]) u.experience = [0, 0, 4, 8, 10, 11][values[2]];
    if (values[7] === 1) u.owner = s.activePlayer;
  }
  s.cheatSubmarinesVisible = values[3] === 1;
  if (values[5] === 1) s.ruleFlags |= RF.NO_FOG;
  if (values[5] === 2) s.ruleFlags &= ~RF.NO_FOG;
  if (values[5]) updateVisionAll(w);
  s.cheatSkipComputer = values[6] === 1;
  if (values[8]) setAlliedComputers(g, values[8] === 1);
}
