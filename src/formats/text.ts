// Blue Byte text/control files: lines of the form  #NNNN:NNNN{content}
// (optionally TPWM-compressed). Lines without that shape are comments.
import { decodeTpwm } from './tpwm.ts';

const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

/** Decodes Windows-1252 bytes (the encoding of most BI3 text files). */
export function decodeCp1252(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
  return s;
}

// UNIT000.TXT is DOS-encoded (CP850): only the German letters occur.
const CP850_GERMAN: Record<number, string> = { 0x84: 'ä', 0x94: 'ö', 0x81: 'ü', 0x8e: 'Ä', 0x99: 'Ö', 0x9a: 'Ü', 0xe1: 'ß' };

export function decodeCp850German(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += CP850_GERMAN[b] ?? String.fromCharCode(b);
  return s;
}

export interface TextRecord {
  id: number;
  sub: number;
  body: string;
  /** Trailing text after the closing brace (designer comments). */
  comment: string;
}

export function parseTextFile(raw: Uint8Array, encoding: 'cp1252' | 'cp850' = 'cp1252'): TextRecord[] {
  const bytes = decodeTpwm(raw);
  const text = encoding === 'cp850' ? decodeCp850German(bytes) : decodeCp1252(bytes);
  const out: TextRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*#(\d+):(\d+)\{(.*)\}(.*)$/.exec(line);
    if (m) out.push({ id: Number(m[1]), sub: Number(m[2]), body: m[3], comment: m[4].trim() });
  }
  return out;
}

/** Map of numeric id -> text for plain message files (TEXT000.TXT, MISSxxx.TXT, UNIT000.TXT). */
export function textTable(raw: Uint8Array, encoding: 'cp1252' | 'cp850' = 'cp1252'): Map<number, string> {
  return new Map(parseTextFile(raw, encoding).map((r) => [r.id, r.body]));
}

export interface ControlRecord {
  key: string;
  value: string;
  comment: string;
}

/** Control files (MCPxxx.DAT/TXT) whose bodies are KEY:value pairs. */
export function parseControlFile(raw: Uint8Array): ControlRecord[] {
  const out: ControlRecord[] = [];
  for (const r of parseTextFile(raw)) {
    const km = /^([A-Z_]+):(.*)$/s.exec(r.body);
    if (km) out.push({ key: km[1], value: km[2].trim(), comment: r.comment });
  }
  return out;
}
