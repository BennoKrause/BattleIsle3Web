// Roads, paths, trenches and rails: the map stores one generic sprite per kind (PART000 sprites 90..93, 1275 snow road) and
// the game picks the matching piece from LIB/LAYR00x.LIB by the six neighbours (BattleIsle2020 SmoothRoad, LoadSpritesFromLib).
// A LAYR library holds 24 base pieces; the other connection masks are mirrored copies of them.
import { TILE } from './sprites.ts';

/** LAYR00n: 0 road, 1 path, 2 trench, 3 rail, 4 tyre tracks, 5 snow-covered road, 6 snow-covered path. */
export const ROAD_LIBS = 7;
export const ROAD_KIND = { road: 0, path: 1, trench: 2, rail: 3, snowRoad: 5, snowPath: 6 } as const;

export const SPRITE_ROAD = 90, SPRITE_RAIL = 91, SPRITE_PATH = 92, SPRITE_TRENCH = 93, SPRITE_SNOW_ROAD = 1275;

/** Base piece n of the library is the piece for connection mask BASE_MASK[n] (bit d = neighbour in direction d, 0 = north, clockwise). */
const BASE_MASK = [0, 1, 2, 3, 5, 7, 9, 11, 15, 18, 19, 20, 21, 22, 23, 27, 28, 29, 30, 31, 54, 55, 63, 6];

/** [target mask, base piece, mirror]: Y = top/bottom, X = left/right, XY = both. */
const MIRRORED: [number, number, 'X' | 'Y' | 'XY'][] = [
  [4, 2, 'Y'], [8, 1, 'Y'], [10, 4, 'Y'], [12, 3, 'Y'], [13, 7, 'Y'], [14, 5, 'Y'], [16, 2, 'XY'], [17, 4, 'X'],
  [24, 3, 'XY'], [25, 7, 'XY'], [26, 10, 'XY'], [32, 2, 'X'], [33, 3, 'X'], [34, 11, 'Y'], [35, 16, 'Y'], [36, 9, 'X'],
  [37, 10, 'X'], [38, 13, 'Y'], [39, 18, 'Y'], [40, 4, 'XY'], [41, 7, 'X'], [42, 12, 'Y'], [43, 17, 'Y'], [44, 10, 'Y'],
  [45, 15, 'Y'], [46, 14, 'Y'], [47, 19, 'Y'], [48, 23, 'X'], [49, 5, 'X'], [50, 13, 'XY'], [51, 18, 'XY'], [52, 13, 'X'],
  [53, 14, 'X'], [56, 5, 'XY'], [57, 8, 'X'], [58, 14, 'XY'], [59, 19, 'XY'], [60, 18, 'X'], [61, 19, 'X'], [62, 21, 'Y'],
];

function mirror(px: Uint8Array, how: 'X' | 'Y' | 'XY'): Uint8Array {
  const out = new Uint8Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const sx = how !== 'Y' ? TILE - 1 - x : x, sy = how !== 'X' ? TILE - 1 - y : y;
    out[y * TILE + x] = px[sy * TILE + sx];
  }
  return out;
}

/** Expands the 24 base pieces of a LAYR library to 64 sprites indexed by connection mask (0 = nothing). */
export function buildRoadSet(base: Uint8Array[]): Uint8Array[] {
  const out: Uint8Array[] = Array.from({ length: 64 }, () => new Uint8Array(TILE * TILE));
  BASE_MASK.forEach((mask, n) => { if (base[n]) out[mask] = base[n].subarray(0, TILE * TILE); });
  for (const [mask, n, how] of MIRRORED) if (base[n]) out[mask] = mirror(base[n].subarray(0, TILE * TILE), how);
  return out;
}

/** Which of the kinds a map overlay sprite shows, bottom to top (trench, path, road, rail). */
export function roadLayers(sprite: number): number[] {
  const out: number[] = [];
  const has = (...l: number[]) => l.includes(sprite);
  if (sprite === SPRITE_TRENCH || has(1266, 1268, 1269, 1271, 1272, 1273, 1274)) out.push(ROAD_KIND.trench);
  if (sprite === SPRITE_PATH || has(1264, 1267, 1268, 1270, 1271, 1273, 1274)) out.push(ROAD_KIND.path);
  if (sprite === SPRITE_ROAD || has(1264, 1265, 1266, 1270, 1271, 1272, 1274)) out.push(ROAD_KIND.road);
  if (sprite === SPRITE_SNOW_ROAD) out.push(ROAD_KIND.snowRoad);
  if (sprite === SPRITE_RAIL || has(1265, 1267, 1269, 1270, 1272, 1273, 1274)) out.push(ROAD_KIND.rail);
  return out;
}

/** Overlay sprites that continue a road of the given kind into the neighbouring field (crossings, buildings). */
const COMBOS: Record<number, number[]> = {
  [ROAD_KIND.road]: [1264, 1265, 1266, 1270, 1271, 1272, 1274, SPRITE_SNOW_ROAD, SPRITE_ROAD],
  [ROAD_KIND.rail]: [1265, 1267, 1269, 1270, 1272, 1273, 1274, SPRITE_RAIL],
  [ROAD_KIND.path]: [1264, 1267, 1268, 1270, 1271, 1273, 1274, SPRITE_PATH],
  [ROAD_KIND.trench]: [1266, 1268, 1269, 1271, 1272, 1273, 1274, SPRITE_TRENCH],
  [ROAD_KIND.snowRoad]: [1264, 1265, 1266, 1270, 1271, 1272, 1274, SPRITE_ROAD, SPRITE_SNOW_ROAD],
  [ROAD_KIND.snowPath]: [1264, 1267, 1268, 1270, 1271, 1273, 1274, SPRITE_PATH],
};
/** Building sprites the roads and rails run into (all kinds except trenches). */
const BUILDINGS = [54, 55, 76, 71, 80, 81, 44, 45, 66, 63, 69, 86, 87, 88, 393, 395, 563];

/**
 * Connection mask of a field for one road kind.
 * @param spriteAt overlay sprite at a field (-1 none) or undefined outside the map; @param building true for fields with a shop.
 */
export function connectionMask(kind: number, nbrs: ({ x: number; y: number } | null)[], spriteAt: (x: number, y: number) => number, building: (x: number, y: number) => boolean): number {
  const joins = (p: { x: number; y: number } | null) => {
    if (!p) return false;
    const s = spriteAt(p.x, p.y);
    if (COMBOS[kind].includes(s)) return true;
    if (kind === ROAD_KIND.trench) return false;
    return BUILDINGS.includes(s) || building(p.x, p.y);
  };
  let m = 0;
  for (let d = 0; d < 6; d++) {
    // at the map edge a road continues straight on: take the opposite neighbour
    if (joins(nbrs[d]) || (!nbrs[d] && joins(nbrs[(d + 3) % 6]))) m |= 1 << d;
  }
  return m;
}
