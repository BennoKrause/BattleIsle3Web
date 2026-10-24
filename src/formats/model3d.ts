// "3DO2" polygon models of the 3D fight (FGT/UN3D000.LIB, UN3D001.LIB, LAND000.LIB, LAYR000.LIB, SCHOSS.LIB).
// Layout derived from the data (and cross-checked against MS/WC_FIGTR.DLL names), see docs/research/FORMAT_3DO2.md:
//
//   0x000  "3DO2", u32 vertexOffset, u32 workOffset, u32 normalOffset, u32 endOfWork
//   0x0a6  u32 vertexCount, u32 faceCount, u32 partCount
//   0x114  faces, each a record that starts with its own byte size:
//            +0x00 u32 size            +0x04 u32 pointer to a work slot
//            +0x1c u32 shade           +0x20 u32 texture number
//            +0x36 u32 (4 * n + 0x3c)  +0x3a u16 n (vertex count)
//            +0x3c n * u32 pointers into the work area (vertex index = (ptr - workOffset) / 20)
//            then n * (u32 u, u32 v), texture coordinates as 0..65535 fractions of the texture
//   vertexOffset: vertexCount * (s32 x, y, z); y grows downwards
//   normalOffset: faceCount * (s32 x, y, z) in 2.14 fixed point
//   workOffset:   vertexCount * 20 bytes of run-time data (transformed coordinates)
//   endOfWork: partCount records of 0x40 bytes: +0x00 u32 a, +0x04 u32 b, +0x08 u32 file offset of a list of
//     work-slot pointers, +0x0c u32 list length, +0x10 s32 x, y, z pivot. A part owns the vertices of its list; a part
//     whose list contains another one's vertices is its parent (turret contains barrel). Front of the models = -z.

export interface ModelFace {
  vertices: number[];
  uv: [number, number][];
  texture: number;
  shade: number;
  normal: [number, number, number];
}

export interface ModelPart {
  pivot: [number, number, number];
  vertices: number[];
  /** Unknown fields a and b of the record (a: 1728..15504, b: smaller count). */
  a: number;
  b: number;
}

export interface Model3D {
  vertices: [number, number, number][];
  faces: ModelFace[];
  partCount: number;
  parts: ModelPart[];
}

export function isModel3D(d: Uint8Array): boolean {
  return d.length > 0x114 && d[0] === 0x33 && d[1] === 0x44 && d[2] === 0x4f && d[3] === 0x32;
}

export function parseModel3D(d: Uint8Array): Model3D {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const vertOff = v.getUint32(4, true), workOff = v.getUint32(8, true), normOff = v.getUint32(12, true);
  const nv = v.getUint32(0xa6, true), nf = v.getUint32(0xaa, true), parts = v.getUint32(0xae, true);
  const vertices: [number, number, number][] = [];
  for (let i = 0; i < nv; i++) vertices.push([v.getInt32(vertOff + i * 12, true), v.getInt32(vertOff + i * 12 + 4, true), v.getInt32(vertOff + i * 12 + 8, true)]);
  const faces: ModelFace[] = [];
  let r = 0x114;
  for (let f = 0; f < nf && r + 0x3c <= d.length; f++) {
    const size = v.getUint32(r, true);
    const n = v.getUint16(r + 0x3a, true);
    if (size < 0x3c || r + size > d.length) throw new Error(`bad face record ${f} at 0x${r.toString(16)}`);
    const idx: number[] = [], uv: [number, number][] = [];
    for (let k = 0; k < n; k++) idx.push(Math.round((v.getUint32(r + 0x3c + k * 4, true) - workOff) / 20));
    for (let k = 0; k < n; k++) uv.push([v.getUint32(r + 0x3c + n * 4 + k * 8, true) / 65536, v.getUint32(r + 0x3c + n * 4 + k * 8 + 4, true) / 65536]);
    faces.push({
      vertices: idx, uv, texture: v.getUint32(r + 0x20, true), shade: v.getInt32(r + 0x1c, true),
      normal: [v.getInt32(normOff + f * 12, true) / 16384, v.getInt32(normOff + f * 12 + 4, true) / 16384, v.getInt32(normOff + f * 12 + 8, true) / 16384],
    });
    r += size;
  }
  const end = v.getUint32(0x10, true);
  const partList: ModelPart[] = [];
  for (let i = 0; i < parts && end + (i + 1) * 0x40 <= d.length; i++) {
    const p = end + i * 0x40, lp = v.getUint32(p + 8, true), cnt = v.getUint32(p + 12, true);
    if (lp + cnt * 4 > d.length) break;
    partList.push({
      a: v.getInt32(p, true), b: v.getInt32(p + 4, true),
      pivot: [v.getInt32(p + 16, true), v.getInt32(p + 20, true), v.getInt32(p + 24, true)],
      vertices: Array.from({ length: cnt }, (_, k) => Math.round((v.getUint32(lp + k * 4, true) - workOff) / 20)),
    });
  }
  return { vertices, faces, partCount: parts, parts: partList };
}
