// Player colour schemes of the original (SDI_1C.EXE table 0x4cf650, built into lookup tables at
// 0x4cd153 by WVR_Init). Unit sprites use palette indices 0..7 for the player colour; scheme k
// replaces them with CHROMA_SCHEMES[k][i]. MCP CHROMA entries ("k^c") select the scheme per player
// (slots 0..5 = players, 6 = neutral); "30" = player not used.
export const CHROMA_SCHEMES: readonly (readonly number[])[] = [
  [96, 254, 253, 252, 251, 249, 248, 240],
  [224, 16, 17, 19, 20, 21, 22, 23],
  [207, 191, 189, 188, 187, 186, 184, 183],
  [72, 24, 25, 26, 27, 28, 29, 30],
  [8, 10, 11, 12, 13, 14, 15, 15],
  [247, 244, 242, 240, 238, 236, 235, 234],
  [32, 33, 34, 35, 36, 37, 38, 39],
  [56, 57, 58, 59, 60, 61, 62, 63],
  [89, 72, 73, 74, 75, 76, 77, 77],
  [120, 121, 122, 123, 124, 125, 126, 127],
  [64, 65, 66, 67, 68, 69, 70, 71],
  [186, 184, 183, 196, 83, 60, 61, 79],
  [104, 1, 2, 3, 4, 5, 6, 7],
  [207, 206, 205, 204, 203, 202, 201, 200],
  [96, 97, 98, 99, 100, 101, 102, 103],
];

export interface PlayerChroma { scheme: number; color: number }

/** Parses an MCP CHROMA value like "0^240 30 8^75 30 30 7^58 30" (7 slots). */
export function parseChroma(value: string): PlayerChroma[] {
  const out: PlayerChroma[] = [];
  for (const tok of value.trim().split(/\s+/).slice(0, 7)) {
    const [s, c] = tok.split('^').map(Number);
    const scheme = Number.isFinite(s) ? s : 30;
    out.push({ scheme, color: Number.isFinite(c) ? c : CHROMA_SCHEMES[scheme]?.[5] ?? 0 });
  }
  while (out.length < 7) out.push({ scheme: 30, color: 0 });
  return out;
}

/** Default when a set has no CHROMA entry: scheme = slot (FUN_00448d04 "Chromacoding not found"). */
export const DEFAULT_CHROMA: PlayerChroma[] = Array.from({ length: 7 }, (_, i) => ({ scheme: i, color: CHROMA_SCHEMES[i][5] }));

export function remapForScheme(scheme: number): (c: number) => number {
  const t = CHROMA_SCHEMES[scheme] ?? CHROMA_SCHEMES[12];
  return (c) => (c < 8 ? t[c] : c);
}
