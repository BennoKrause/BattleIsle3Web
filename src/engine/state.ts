// Complete, JSON-serialisable game state. Everything needed to continue a game lives here
// (save games are this object); static data (unit classes, terrain) comes from GameData.

export const NEUTRAL = 6;
export const MAX_PLAYERS = 6;
export const MAX_EXPERIENCE = 12;

/** Height level of a unit (BI2020 zpos): bit index into weapon target masks. */
export const Layer = { HIGH_AIR: 0, AIR: 1, GROUND: 2, WATER: 3, SUBMERGED: 4 } as const;

export const UnitFlag = {
  MOVED: 1,
  ATTACKED: 4,
  SURPRISED: 8,
  DONE: 16,
  ASCENDED: 32,
  DIVED: 64,
  MOVED_FROM_CONTAINER: 128,
  ACTION_USED: 256,
} as const;

export type Container = { kind: 'shop'; id: number } | { kind: 'unit'; id: number } | null;

export interface UnitState {
  id: number;
  type: number;
  owner: number;
  alive: boolean;
  x: number;
  y: number;
  layer: number;
  dir: number;
  /** Current group strength (1..groupSize). */
  group: number;
  fuel: number;
  ammo: number[];
  experience: number;
  flags: number;
  /** Fields moved this turn. */
  moved: number;
  cargo: number[];
  container: Container;
  /** AI order from the mission (0 attack, 1 defend, 64 hold position). */
  aiOrder: number;
  name?: string;
}

export interface ShopState {
  id: number;
  /** 1 = building / cargo definition, 2 = AI point. */
  kind: number;
  x: number;
  y: number;
  /** Building type bits: 1 HQ, 2 airport, 4 harbour, 8 factory, 16 depot, 32 city, 64 academy; 0 = transporter cargo. */
  type: number;
  owner: number;
  nameIndex: number;
  energy: number;
  material: number;
  energyPlus: number;
  materialPlus: number;
  units: number[];
  production: number[];
  aiCommand: number;
}

export interface PlayerState {
  index: number;
  /** Bit mask of allied players including the player itself. */
  allies: number;
  energy: number;
  computer: boolean;
  alive: boolean;
  killed: number;
  lost: number;
  produced: number;
  captured: number;
}

export interface QueuedAction {
  category: number;
  level: number;
  turn: number;
  movement: number;
  playerMask: number;
  type: number;
  param: number;
  shop: number;
  newAlly: number;
}

export type Outcome = { result: 'victory' | 'defeat'; turn: number; conditions: number[] } | null;

export type MapChangeLayer = { x: number; y: number; terrain: number; overlay: number; unit: number }[];

export interface GameEvent {
  /** Sequence number within the game (stable ordering for the UI). */
  seq: number;
  kind: 'message' | 'video' | 'weather' | 'map-change' | 'alliance' | 'combat' | 'unit-destroyed' | 'building-captured'
    | 'victory' | 'defeat' | 'turn' | 'surprise' | 'sunk' | 'crashed';
  turn: number;
  player?: number;
  data: Record<string, unknown>;
}

export interface GameState {
  version: 1;
  missionFileId: number;
  setId: number;
  difficulty: number;
  /** Rule and combat flags of the difficulty level (see rules.ts); the setup menu can toggle auto-refuel. */
  ruleFlags: number;
  combatFlags: number;
  /** Mission terrain tables (MISS+0x1C..0x9B), 32 entries each, indexed by terrain bit. */
  terrainTables: { move: number[]; sight: number[]; agility: number[]; firepower: number[] };
  /** Global production flags per unit type (MISS+0x9C): bit 0 human players, bit 1 computer players. */
  productionFlags: number[];
  width: number;
  height: number;
  terrain: number[];
  overlay: number[];
  /** Unit id on each field (top-level units only), -1 = none. */
  unitAt: number[];
  /** Building index on each field, -1 = none. */
  shopAt: number[];
  units: UnitState[];
  shops: ShopState[];
  players: PlayerState[];
  /** Explored / currently watched fields: bit per player. */
  explored: number[];
  vision: number[];
  turn: number;
  /** Count of completed unit moves of the human player in this turn (action timing). */
  movement: number;
  activePlayer: number;
  weather: number;
  victoryConditions: QueuedAction[];
  defeatConditions: QueuedAction[];
  requiredVictoryConditions: number;
  /** Pending normal actions sorted by time; later action levels wait in `laterLevels`. */
  actions: QueuedAction[];
  laterLevels: QueuedAction[];
  mapChanges: MapChangeLayer[];
  turnLimit: number;
  turnLimitIsVictory: boolean;
  outcome: Outcome;
  rngState: number;
  events: GameEvent[];
  eventSeq: number;
  /** Video sequence ids already shown (videorecorder menu). */
  seenSequences: number[];
}
