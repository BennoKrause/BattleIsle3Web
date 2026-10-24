// Hex grid of Battle Isle: columns of hexes, odd columns shifted half a field down.
// Screen position of field (x, y): (x*16, y*24 + (x&1)*12) for 24x24 sprites.
// Direction 0 = north, then clockwise (BattleIsle2020 GetAdjacentFields).

export interface Pos { x: number; y: number }

const EVEN = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]] as const;
const ODD = [[0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]] as const;

/** Neighbour in direction d (0..5), possibly outside the map. */
export function neighbour(x: number, y: number, d: number): Pos {
  const o = (x & 1 ? ODD : EVEN)[d];
  return { x: x + o[0], y: y + o[1] };
}

export function neighbours(x: number, y: number, w: number, h: number): (Pos | null)[] {
  const out: (Pos | null)[] = [];
  for (let d = 0; d < 6; d++) {
    const p = neighbour(x, y, d);
    out.push(p.x >= 0 && p.y >= 0 && p.x < w && p.y < h ? p : null);
  }
  return out;
}

function toCube(x: number, y: number): [number, number, number] {
  const q = x;
  const r = y - ((x - (x & 1)) >> 1);
  return [q, r, -q - r];
}

/** Hex distance in fields. */
export function distance(ax: number, ay: number, bx: number, by: number): number {
  const a = toCube(ax, ay), b = toCube(bx, by);
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/** Direction index (0..5) from a to an adjacent or distant field b (BattleIsle2020 GetDirectionToField). */
export function directionTo(sx: number, sy: number, dx: number, dy: number): number {
  if (sx === dx) return sy > dy ? 0 : 3;
  if (sx < dx) {
    if (sy > dy) return 1;
    if (sy < dy) return 2;
    return (sx & 1) === 0 ? 2 : 1;
  }
  if (sy > dy) return 5;
  if (sy < dy) return 4;
  return (sx & 1) === 0 ? 4 : 5;
}

/** All fields within `range` of (x, y), clipped to the map. */
export function fieldsInRange(x: number, y: number, range: number, w: number, h: number): Pos[] {
  const out: Pos[] = [];
  for (let fx = Math.max(0, x - range); fx <= Math.min(w - 1, x + range); fx++) {
    for (let fy = Math.max(0, y - range - 1); fy <= Math.min(h - 1, y + range + 1); fy++) {
      if (distance(x, y, fx, fy) <= range) out.push({ x: fx, y: fy });
    }
  }
  return out;
}

export const HEX_W = 24;
export const HEX_H = 24;
export const COL_STEP = 16;

export function fieldToPixel(x: number, y: number, scale = 1): Pos {
  return { x: x * COL_STEP * scale, y: (y * HEX_H + (x & 1) * (HEX_H / 2)) * scale };
}
