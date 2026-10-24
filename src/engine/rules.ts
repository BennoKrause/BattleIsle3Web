// Difficulty-dependent rule switches of the original (SDI_1C.EXE WSM_StartupMenu, see
// docs/research/GAME_RULES.md section 3). The bit meanings are taken from the code that tests them.

export const Difficulty = { TRAINING: 0, NORMAL: 1, EXPERT: 2 } as const;

/** Rule flags (0x4c8ad6). */
export const RF = {
  JAM_FULL: 0x1, // jamming at full strength (else halved)            FUN_0043d8a6
  JAM_ADD: 0x2, // jamming values add up (else maximum)               FUN_0043d8a6
  ADJACENT_VISIBLE: 0x4, // neighbour fields are always visible          FUN_0043d03d
  JAM_SPREAD: 0x8, // jamming spreads by search (else neighbours only)
  ZOC_ALL_ENEMIES: 0x10, // every enemy exerts a zone of control         FUN_0043d9a9
  ADJACENT_MOVE: 0x20, // an empty neighbour field can always be entered FUN_0043d9a9
  AUTO_REPAIR: 0x80, // units in buildings are repaired at turn start   FUN_0040d4c4
  AUTO_REFUEL: 0x100, // units in buildings are refuelled at turn start FUN_0040d4c4
  SINGLE_AMBUSH: 0x800, // only one ambush attack per move              FUN_004436b5
  NO_FUEL_USE: 0x1000, //                                                FUN_004436b5
  NO_AMMO_USE: 0x2000, //                                                FUN_0042342f
  NO_FOG: 0x4000, // enemy units always visible (training)
} as const;

export const DIFFICULTY_FLAGS: Record<number, { rules: number; combat: number }> = {
  [Difficulty.TRAINING]: { rules: 0x04007c34, combat: 0x1f0f },
  [Difficulty.NORMAL]: { rules: 0x04000425, combat: 0x1b0c },
  [Difficulty.EXPERT]: { rules: 0x04000465, combat: 0x1b08 },
};
