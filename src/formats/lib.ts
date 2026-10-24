// LIB archive: u32 offset of the index, entry data, then 12-byte index records
// (8-byte zero-padded name + u32 data offset). An entry ends where the next one starts
// (the last entry ends at the index). Verified on every LIB file of both CDs.

export interface LibEntry {
  name: string;
  data: Uint8Array;
}

export function parseLib(data: Uint8Array): LibEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const indexOffset = view.getUint32(0, true);
  if (indexOffset < 4 || indexOffset > data.length || (data.length - indexOffset) % 12 !== 0) {
    throw new Error(`LIB: invalid index offset ${indexOffset} for file of ${data.length} bytes`);
  }
  const count = (data.length - indexOffset) / 12;
  const offsets: number[] = [];
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const rec = indexOffset + i * 12;
    let name = '';
    for (let k = 0; k < 8; k++) {
      const ch = data[rec + k];
      if (ch === 0) break;
      name += String.fromCharCode(ch);
    }
    names.push(name);
    offsets.push(view.getUint32(rec + 8, true));
  }
  offsets.push(indexOffset);
  return names.map((name, i) => ({ name, data: data.subarray(offsets[i], offsets[i + 1]) }));
}
