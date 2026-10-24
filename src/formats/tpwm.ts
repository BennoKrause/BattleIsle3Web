// TPWM: Blue Byte LZ77-style compression used by text, mission-control and many LIB entries.
// Algorithm verified against BattleIsle2020 (DecodeTPWM$, bi2init.inc, GPLv3) and against the
// original CD data (all TPWM files decode to plausible text/bitmaps of the declared length).

const XOR_KEY = 'FUCKBAUEREWALD';

export function isTpwm(data: Uint8Array): boolean {
  return data.length >= 8 && data[0] === 0x54 && data[1] === 0x50 && data[2] === 0x57 && data[3] === 0x4d;
}

export function decodeXor(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ XOR_KEY.charCodeAt(i % XOR_KEY.length);
  return out;
}

/** Decompresses TPWM data; returns input unchanged when it carries no TPWM header. */
export function decodeTpwm(data: Uint8Array): Uint8Array {
  if (!isTpwm(data)) return data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const orgLen = view.getUint32(4, true);
  // Some files are only XOR-obfuscated; the original length field is then meaningless.
  if (orgLen > data.length * 10) return decodeXor(data.subarray(4));

  const out = new Uint8Array(orgLen);
  let o = 0;
  let p = 8;
  const n = data.length;
  while (p < n && o < orgLen) {
    const mask = data[p++];
    for (let bit = 0x80; bit > 0 && p < n && o < orgLen; bit >>= 1) {
      if ((mask & bit) === 0) {
        out[o++] = data[p++];
      } else {
        const c = data[p++];
        let src = o - data[p++];
        let count: number;
        if (c < 16) {
          count = c + 3;
        } else {
          src -= 256 * (c >> 4);
          count = (c & 15) + 3;
        }
        if (src < 0) throw new Error(`TPWM: invalid back reference at input offset ${p}`);
        for (let k = 0; k < count && o < orgLen; k++) out[o++] = out[src + k];
      }
    }
  }
  if (o !== orgLen) throw new Error(`TPWM: decoded ${o} of ${orgLen} bytes`);
  return out;
}
