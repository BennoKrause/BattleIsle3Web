// Action (event / condition) codes in mission files. Values from BattleIsle2020 bi2const.inc;
// codes >= 20 are BI2020 extensions and do not occur in the original BI3 missions
// (verified: the 40 BI3 missions only use categories 0/48/80/208 and types 2,3,4,8,9,10).

export const ActionCategory = {
  NORMAL: 0,
  VICTORY: 48,
  DEFEAT: 80,
} as const;

export const ActionType = {
  WEATHER: 2,
  MESSAGE: 3,
  DF_LAYER: 4,
  ALLIANCE: 7,
  VC_PLAYER_DEFEATED: 8,
  VC_SHOP_OCCUPIED: 9,
  VC_TURN_REACHED: 10,
  VC_UNIT_DEAD_PLAYER1: 11,
  VC_UNIT_DEAD_PLAYER6: 16,
  DF_LAYER_DIFFICULTY1: 17,
  DF_LAYER_DIFFICULTY3: 19,
} as const;

export const Weather = ['sunny', 'light rain', 'heavy rain', 'light snow', 'heavy snow'] as const;

/** Splits the category byte into kind and action level (multi-stage missions). */
export function splitCategory(category: number): { kind: 'normal' | 'victory' | 'defeat'; level: number } {
  if (category === 48) return { kind: 'victory', level: 0 };
  if (category === 80) return { kind: 'defeat', level: 0 };
  if (category < 48) return { kind: 'normal', level: category };
  if (category < 80) return { kind: 'victory', level: category - 48 };
  return { kind: 'defeat', level: category - 80 };
}

export function describeCondition(type: number, param: number, shop: number): string {
  switch (type) {
    case ActionType.VC_PLAYER_DEFEATED: return `player ${param} has no units left`;
    case ActionType.VC_SHOP_OCCUPIED: return `building ${shop} owned by player ${param}`;
    case ActionType.VC_TURN_REACHED: return `turn ${param} reached`;
    default:
      if (type >= ActionType.VC_UNIT_DEAD_PLAYER1 && type <= ActionType.VC_UNIT_DEAD_PLAYER6) {
        return `all units of type ${param} of player ${shop} destroyed`;
      }
      return `unknown condition type ${type} (param ${param}, shop ${shop})`;
  }
}
