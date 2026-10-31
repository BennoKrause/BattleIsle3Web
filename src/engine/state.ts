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
  /** Entered a building or was produced this turn (SDI_1C.EXE unit flag 0x100): no repair, refuel, training or moving out. */
  ENTERED: 512,
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
  /** Fixed computer order from the mission (AI point record bytes 72-79, SDI_1C.EXE FUN_00427912): flags
   *  1 hold and fight, 2 wait until it attacks, 4 hold target field `aiTimer`, 8 move to `aiTarget`, 0x10 limited by
   *  `aiTimer` turns. */
  aiOrder: number;
  /** Priority of the fixed order (bytes 74-75 × 10). */
  aiPrio?: number;
  /** Target field of the fixed order (y·64 + x, bytes 76-77). */
  aiTarget?: number;
  /** Turns left (flag 0x10) or the field to hold (flag 4) (bytes 78-79). */
  aiTimer?: number;
  name?: string;
}

export interface ShopState {
  id: number;
  /** 1 = building / cargo definition, 2 = AI point. */
  kind: number;
  x: number;
  y: number;
  /** Building type bits: 1 HQ, 2 airport, 4 harbour, 8 factory, 16 depot, 32 city, 64 academy; 0 = transporter cargo.
   *  Compared with the class shop mask when a unit enters (FUN_00436afa). */
  type: number;
  /** Building function (mission record +4, SDI_1C.EXE shop byte 0): 1 HQ, 2 production, 4 depot, 8 training camp,
   *  16 city; missing in old saves (see shopFunction). */
  func?: number;
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
  /** Buildings taken (statistics of the computer window, 0x4b8f60); missing in old saves. */
  shopsTaken?: number;
  /** Campaign training points [ground, water, air]; only in campaign games. */
  trainingPoints?: number[];
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

export type Outcome = { result: 'victory' | 'defeat'; turn: number; conditions: number[]; winner?: number } | null;

export type MapChangeLayer = { x: number; y: number; terrain: number; overlay: number; unit: number }[];

export interface GameEvent {
  /** Sequence number within the game (stable ordering for the UI). */
  seq: number;
  kind: 'message' | 'video' | 'weather' | 'map-change' | 'alliance' | 'combat' | 'unit-destroyed' | 'building-captured'
    | 'victory' | 'defeat' | 'turn' | 'surprise' | 'sunk' | 'crashed' | 'condition' | 'player-out' | 'structure-attack';
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
  /** Hit points of attacked structures per field (SDI_1C.EXE list 0x4b9450: default 10 points, divisor 320). */
  structureHp?: Record<number, { hp: number; divisor: number }>;
  /** Tyre tracks: direction mask per field (SDI_1C.EXE g_Tracks 0x4b4200, cleared for every new map). */
  tracks?: number[];
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
  /** Victory conditions fulfilled so far (SDI_1C.EXE DAT_004bfae5): a fulfilled condition counts once and for good. */
  victoryMet?: number;
  /** 1 campaign map (mission goals apply), 2 single multiplayer map (players drop out, last one wins) - DAT_004cce94. */
  gameType?: number;
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
  /** Overlay kinds that may be built (0x10 | type bits 1 road, 2 path, 4 trench, 8 rail present at the start); missing in old saves. */
  buildMask?: number;
  /** Video sequence ids already shown (videorecorder menu). */
  seenSequences: number[];
}
