// Deterministic random numbers (mulberry32). The state lives in GameState so that saved games
// and test runs reproduce exactly.
import type { GameState } from './state.ts';

export function nextRandom(state: GameState): number {
  let t = (state.rngState = (state.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [min, max]. */
export function randomInt(state: GameState, min: number, max: number): number {
  return min + Math.floor(nextRandom(state) * (max - min + 1));
}
