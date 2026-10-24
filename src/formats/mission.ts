// MSSN mission files (MIS/MISSxxx.DAT). Layout derived from BattleIsle2020 LoadMission&
// (bi2init.inc, GPLv3) and verified against all 40 mission files on the CD.
// Note: BI2020 names the sections by pointer variable, which is swapped relative to the tags:
// the section tagged "ACTN" holds the map grid, the section tagged "MAP " holds the actions.
//
// Header (little endian):
//   0   "MSSN"
//   4   u32 offset of "MISS" section (mission parameters)
//   8   u32 offset of "MAP " section (actions, 40 bytes each)
//   12  u32 offset of "SHOP" section (buildings, transporter cargo, AI points)
//   16  u32 offset of "ACTN" section (map grid)
//   20  u16 number of DF layers (scripted map changes)
//   22  u32[] DF layer offsets (+4, point past the "DFnn" tag)
//   146 u32 offset of custom message block (BI2020 extension, 0 in originals)
//   150 u32[] DF layer lengths
//   274 u32 custom message block length

export interface MissionAction {
  index: number;
  /** 0 = normal event, 48 = victory condition, 80 = defeat condition; upper bits encode an action level. */
  category: number;
  turn: number;
  movement: number;
  /** Bit mask of players the action applies to. */
  playerMask: number;
  type: number;
  param: number;
  shop: number;
  newAlly: number;
  raw: Uint8Array;
}

export interface MissionShop {
  index: number;
  /** 1 = building/transporter cargo, 2 = AI point. */
  kind: number;
  x: number;
  y: number;
  function: number;
  nameIndex: number;
  energy: number;
  material: number;
  energyPlus: number;
  materialPlus: number;
  /** Unit types inside (-1 = empty slot). */
  content: number[];
  /** 0 = cargo of the unit on this field, otherwise building type bits (1 HQ, 2 airport, 4 harbour, 8 factory, 16 depot, 32 city, 64 academy). */
  shopType: number;
  production: number[];
  priority: number;
  /** Player index 0-5, 6 = neutral. */
  owner: number;
  aiCommand: number;
  aiData: number[];
  raw: Uint8Array;
}

export interface MapChange {
  x: number;
  y: number;
  terrain: number;
  overlay: number;
  unit: number;
}

export interface MissionUnit {
  x: number;
  y: number;
  type: number;
  /** Player index 0-5, 6 = neutral. */
  owner: number;
}

export interface Mission {
  width: number;
  height: number;
  /** width*height terrain sprite numbers, row-major. */
  terrain: Int16Array;
  /** width*height overlay sprite numbers (buildings, roads, ...), -1 = none. */
  overlay: Int16Array;
  /** width*height raw unit codes (-1 = none). */
  unitCodes: Int16Array;
  units: MissionUnit[];
  shops: MissionShop[];
  actions: MissionAction[];
  dfLayers: MapChange[][];
  /** Raw byte at MISS+6: next mission (1-based in BI3), see nextMissionRaw2. */
  nextMissionRaw: number;
  nextMissionRaw2: number;
  weather: number;
  aiMask: number;
  requiredVictoryConditions: number;
  /** Alliance bit mask per player. */
  allies: number[];
  playerNames: string[];
  /** Per unit type: bit0 = producible by humans, bit1 = by AI. */
  productionFlags: number[];
  briefingMessage: number;
  bonusMission: number;
  /** Terrain tables (SDI_1C.EXE loads MISS+0x1C..0x9B): movement cost, sight cost, agility %, firepower %. */
  terrainTables: { move: number[]; sight: number[]; agility: number[]; firepower: number[] };
  /** Raw mission parameter block (after the MISS tag) for further analysis. */
  missRaw: Uint8Array;
}

export function ownerFromCode(code: number): number {
  if (code >= 256 && code < 512) return 0;
  if (code >= 512 && code < 1024) return 1;
  if (code >= 1024 && code < 2048) return 2;
  if (code >= 2048 && code < 4096) return 3;
  if (code >= 4096 && code < 8192) return 4;
  if (code >= 8192 && code < 16384) return 5;
  return 6;
}

function tagAt(data: Uint8Array, offset: number, tag: string): boolean {
  for (let i = 0; i < tag.length; i++) if (data[offset + i] !== tag.charCodeAt(i)) return false;
  return true;
}

function log2(v: number): number {
  return v > 0 ? Math.floor(Math.log2(v)) : 0;
}

export function parseMission(data: Uint8Array): Mission {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (!tagAt(data, 0, 'MSSN')) throw new Error('mission: missing MSSN signature');
  const pMiss = v.getUint32(4, true);
  const pActions = v.getUint32(8, true);
  const pShop = v.getUint32(12, true);
  const pGrid = v.getUint32(16, true);
  const dfCount = v.getUint16(20, true);
  if (!tagAt(data, pMiss, 'MISS') || !tagAt(data, pActions, 'MAP') || !tagAt(data, pShop, 'SHOP') || !tagAt(data, pGrid, 'ACTN')) {
    throw new Error('mission: section tags do not match header offsets');
  }

  // Mission parameters
  const m = pMiss + 4;
  const missRaw = data.slice(m, pGrid);
  const allies = Array.from({ length: 6 }, (_, i) => data[m + 16 + i] | (1 << i));
  const playerNames: string[] = [];
  if (data[m + 22] > 32) {
    for (let i = 0; i < 6; i++) {
      let s = '';
      for (let k = 0; k < 16; k++) s += String.fromCharCode(data[m + 22 + i * 16 + k]);
      playerNames.push(s.replace(/\0.*$/s, '').trimEnd());
    }
  }
  const productionFlags = Array.from({ length: 64 }, (_, i) => data[m + 152 + i * 2]);
  const table = (o: number) => Array.from({ length: 32 }, (_, i) => (data[pMiss + o + i] << 24) >> 24);
  const terrainTables = { move: table(0x1c), sight: table(0x3c), agility: table(0x5c), firepower: table(0x7c) };

  // Map grid
  const width = v.getUint16(pGrid + 4, true);
  const height = v.getUint16(pGrid + 6, true);
  const n = width * height;
  let p = pGrid + 8;
  const readLayer = () => {
    const layer = new Int16Array(n);
    for (let i = 0; i < n; i++, p += 2) layer[i] = v.getInt16(p, true);
    return layer;
  };
  const terrain = readLayer();
  const overlay = readLayer();
  const unitCodes = readLayer();
  const units: MissionUnit[] = [];
  for (let i = 0; i < n; i++) {
    const c = unitCodes[i];
    if (c >= 0) units.push({ x: i % width, y: Math.floor(i / width), type: c & 255, owner: ownerFromCode(c) });
  }

  // Shops: positions are packed as x + y*64 (or *256 on maps larger than 64)
  const yFactor = width > 64 || height > 64 ? 256 : 64;
  const shopCount = v.getUint16(pShop + 4, true);
  const shops: MissionShop[] = [];
  for (let i = 0; i < shopCount; i++) {
    const s = pShop + 6 + i * 80;
    const pos = v.getUint16(s + 2, true);
    shops.push({
      index: i,
      kind: v.getInt16(s, true),
      x: pos & (yFactor - 1),
      y: Math.floor(pos / yFactor),
      function: v.getInt16(s + 4, true),
      nameIndex: v.getInt16(s + 8, true),
      energy: v.getInt16(s + 12, true),
      material: v.getInt16(s + 14, true),
      energyPlus: data[s + 16],
      materialPlus: data[s + 17],
      content: Array.from({ length: 16 }, (_, k) => v.getInt16(s + 18 + k * 2, true)),
      shopType: data[s + 51],
      production: Array.from({ length: 4 }, (_, k) => v.getInt16(s + 52 + k * 2, true)),
      priority: v.getInt16(s + 62, true),
      owner: Math.min(6, log2(v.getInt16(s + 64, true))),
      aiCommand: v.getInt16(s + 72, true),
      aiData: [66, 68, 70, 74, 76, 78].map((o) => v.getInt16(s + o, true)),
      raw: data.slice(s, s + 80),
    });
  }

  // Actions: from the MAP section up to the first DF layer (or the next section)
  const firstDf = dfCount > 0 ? v.getUint32(22, true) - 4 : 0;
  const actionsEnd = firstDf > pActions ? firstDf : Math.min(...[pMiss, pShop, pGrid, data.length].filter((o) => o > pActions));
  const actions: MissionAction[] = [];
  for (let a = pActions + 4, i = 0; a + 40 <= actionsEnd; a += 40, i++) {
    actions.push({
      index: i,
      category: data[a],
      turn: v.getUint16(a + 2, true),
      movement: v.getUint16(a + 4, true),
      playerMask: data[a + 6],
      type: data[a + 7],
      param: v.getUint16(a + 12, true),
      shop: v.getUint16(a + 14, true),
      newAlly: v.getUint16(a + 16, true),
      raw: data.slice(a, a + 40),
    });
  }

  // DF layers
  const dfLayers: MapChange[][] = [];
  for (let k = 0; k < dfCount; k++) {
    const off = v.getUint32(22 + k * 4, true) - 4;
    const len = v.getUint32(150 + k * 4, true);
    const layer: MapChange[] = [];
    if (off > 0 && len > 0 && tagAt(data, off, 'DF')) {
      for (let q = off + 4; q + 8 <= off + len; q += 8) {
        const pos = v.getUint16(q, true);
        const x = pos & (yFactor - 1), y = Math.floor(pos / yFactor);
        if (x < width && y < height) {
          layer.push({ x, y, terrain: v.getInt16(q + 2, true), overlay: v.getInt16(q + 4, true), unit: v.getInt16(q + 6, true) });
        }
      }
    }
    dfLayers.push(layer);
  }

  return {
    width, height, terrain, overlay, unitCodes, units, shops, actions, dfLayers,
    nextMissionRaw: data[m + 6],
    nextMissionRaw2: data[m + 7],
    weather: data[m + 8],
    aiMask: data[m + 10],
    requiredVictoryConditions: data[m + 11],
    allies, playerNames, productionFlags,
    briefingMessage: data[m + 293],
    bonusMission: data[m + 296],
    terrainTables,
    missRaw,
  };
}
