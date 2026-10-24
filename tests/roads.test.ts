import { describe, expect, it } from 'vitest';
import { buildRoadSet, connectionMask, roadLayers, ROAD_KIND, SPRITE_ROAD } from '../src/render/roads.ts';
import { neighbours } from '../src/engine/hex.ts';

describe('road autotiling', () => {
  it('expands 24 base pieces to 64 masks by mirroring', () => {
    const base = Array.from({ length: 24 }, (_, n) => new Uint8Array(576).fill(n + 1));
    const set = buildRoadSet(base);
    expect(set).toHaveLength(64);
    expect(set[3][0]).toBe(4); // base piece 3 is mask 3
    expect(set[12]).toBeDefined();
    for (let m = 1; m < 64; m++) expect(set[m].some((v) => v !== 0), `mask ${m}`).toBe(true);
  });

  it('connects to roads and continues straight at the map edge', () => {
    const w = 5, h = 5;
    const overlay = new Array(w * h).fill(-1);
    for (let y = 0; y < h; y++) overlay[y * w + 2] = SPRITE_ROAD; // vertical road in column 2
    const at = (x: number, y: number) => overlay[y * w + x];
    const mid = connectionMask(ROAD_KIND.road, neighbours(2, 2, w, h), at, () => false);
    expect(mid).toBe(1 | 8); // north and south
    const top = connectionMask(ROAD_KIND.road, neighbours(2, 0, w, h), at, () => false);
    expect(top).toBe(1 | 8); // continues over the edge
    expect(roadLayers(1265)).toEqual([ROAD_KIND.road, ROAD_KIND.rail]);
  });
});
