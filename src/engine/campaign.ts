// Campaign progress and the unit pool ("Waffenpool"), reconstructed from SDI_1C.EXE:
//   WU_TransferUnitsIntoPool  FUN_0047b0f9   (after a won mission)
//   WU_TransferUnitsOntoMap   FUN_0047b81a   (at mission start)
//   WU_AdaptComputerUnits     FUN_0047bbde   (sets with COMPUTERPROGRESSION)
// README.TXT ("Kampagnenmodus") describes the same rules.
import type { GameData } from '../data/gamedata.ts';
import type { GameState } from './state.ts';
import { nextRandom } from './rng.ts';

export interface PoolUnit { type: number; experience: number; name?: string; used: boolean }

export interface CampaignProgress {
  version: 1;
  setId: number;
  difficulty: number;
  /** Index of the current mission within the set (NUMMER). */
  missionIndex: number;
  pool: PoolUnit[];
  /** Video sequence ids seen during the campaign (video recorder). */
  seenSequences: number[];
  completed: number[];
  finished: boolean;
  /** Training points of the campaign player [ground, water, air] (FUN_004168e6), spent in buildings; missing in old saves. */
  trainingPoints?: number[];
}

export function newCampaign(setId: number, difficulty: number): CampaignProgress {
  return { version: 1, setId, difficulty, missionIndex: 0, pool: [], seenSequences: [], completed: [], finished: false };
}

/** Training points per experience level of a surviving unit (table 0x4c8ba8). */
const POINTS_PER_XP = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3];

/** Category of a unit class for training points: 0 ground, 1 water (ships), 2 air (FUN_004168e6). */
export function trainingCategory(flags: number) { return (flags >>> 31) ? 1 : (flags & 0x800000) ? 2 : 0; }

/**
 * At the end of a won campaign mission every surviving unit of the player earns training points by its experience
 * (FUN_004168e6, called from the next-mission dialog FUN_00416a8e); support units and crystals (class bits 29/30) do not.
 */
export function earnTrainingPoints(data: GameData, state: GameState, points: number[] = [0, 0, 0]): number[] {
  const out = [...points];
  for (const u of state.units) {
    if (!u.alive || u.owner !== CAMPAIGN_PLAYER) continue;
    const f = data.unitClasses[u.type].flags >>> 0;
    if (f & 0x60000000) continue;
    out[trainingCategory(f)] += POINTS_PER_XP[u.experience] ?? 0;
  }
  return out;
}

/** Player 0 (owner mask 1) is the campaign player. */
const CAMPAIGN_PLAYER = 0;

/** After victory: keep unused pool entries, add every surviving unit of player 0. */
export function transferUnitsIntoPool(data: GameData, state: GameState, pool: PoolUnit[]): PoolUnit[] {
  const next = pool.filter((p) => !p.used).map((p) => ({ ...p }));
  for (const u of state.units) {
    if (!u.alive || u.owner !== CAMPAIGN_PLAYER) continue;
    let xp = u.experience;
    const c = data.unitClasses[u.type];
    // damaged units lose one experience point for the repair
    if (xp !== 0 && u.group < c.strength) xp -= 1;
    next.push({ type: u.type, experience: xp, name: u.name, used: false });
  }
  return next;
}

/** Mission start: each unit of player 0 takes the most experienced pool unit of its type. */
export function transferUnitsOntoMap(state: GameState, pool: PoolUnit[]) {
  for (const u of state.units) {
    if (!u.alive || u.owner !== CAMPAIGN_PLAYER) continue;
    let best = -1, bestXp = 0;
    pool.forEach((p, i) => {
      if (!p.used && p.type === u.type && p.experience >= bestXp) { best = i; bestXp = p.experience; }
    });
    if (best >= 0) {
      u.experience = pool[best].experience;
      if (pool[best].name) u.name = pool[best].name;
      pool[best].used = true;
    }
  }
}

/** Types whose computer experience is halved (table 0x4e36f8): Imperator SP, Super Virus, Zenit, UX-2. */
const HALF_XP_TYPES = [7, 24, 49, 59];

/** Computer units gain experience with campaign progress: missionIndex/2, 10 % chance of ±1, at most 4. */
export function adaptComputerUnits(state: GameState, missionIndex: number) {
  for (const u of state.units) {
    if (!u.alive || u.owner === CAMPAIGN_PLAYER) continue;
    let xp = Math.trunc(missionIndex / 2);
    if (nextRandom(state) * 100 < 11 && xp > 0) xp += nextRandom(state) < 0.5 || xp < 1 ? 1 : -1;
    if (xp > 4) xp = 4;
    if (HALF_XP_TYPES.includes(u.type)) xp = Math.trunc(xp / 2);
    u.experience = xp;
  }
}
