// LIB/PART000.DAT: one 46-byte record per sprite of PART000.LIB (1335 on the BI3 CD).
// Layout from BattleIsle2020 TTerrain (bi2types.inc, GPLv3); field meanings marked "?" there
// are kept raw.

export interface TerrainDef {
  index: number;
  /** Terrain property bits (BI2020): 0 road, 1 path, 2 trench, 3 rail, 4 small obstacle, 6 hill,
   *  7 mountain, 8 slope, 9 grass/field?, 10 forest, 12 basin?, 15 rock in water, 16 shallow water,
   *  17 medium water, 18 deep water, 20 building, 21 enterable building, 22 building entrance. */
  typeMask: number;
  animationStart: number;
  animationLength: number;
  defense: number;
  /** Replacement sprite for weather 0..4 (sunny, light rain, heavy rain, light snow, heavy snow). */
  weatherSprites: number[];
  /** Byte 19: 1 = impassable for low-flying aircraft (SDI_1C.EXE FUN_0043d9a9). */
  highObstacle: number;
  raw: Uint8Array;
}

export const TERRAIN_RECORD_SIZE = 46;

export function parseTerrainDefs(data: Uint8Array): TerrainDef[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: TerrainDef[] = [];
  for (let i = 0; (i + 1) * TERRAIN_RECORD_SIZE <= data.length; i++) {
    const p = i * TERRAIN_RECORD_SIZE;
    out.push({
      index: i,
      typeMask: v.getUint32(p + 6, true),
      animationStart: v.getInt16(p + 10, true),
      defense: v.getInt16(p + 12, true),
      animationLength: data[p + 16],
      weatherSprites: Array.from({ length: 5 }, (_, k) => v.getInt16(p + 20 + k * 2, true)),
      highObstacle: data[p + 19],
      raw: data.slice(p, p + TERRAIN_RECORD_SIZE),
    });
  }
  return out;
}
