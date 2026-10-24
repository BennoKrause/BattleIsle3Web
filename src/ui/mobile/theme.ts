// Theme of the phone interface taken from the original graphics: the mottled green metal textures of the
// windows, the colours of the blue text fields, the yellow of the buttons, and the bevel colours of the frames.
import type { Assets } from '../assets.ts';
import { COLORS } from './pixel.ts';

/** Seamless mottled texture (wrap-around value noise plus fine speckle) in a given colour; looks like the green metal of the windows. */
function metal(size: number, base: [number, number, number], amp: number, seed: number): string {
  let state = seed;
  const rnd = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  const grid = 8, cells = Array.from({ length: grid * grid }, () => rnd());
  const noise = (x: number, y: number) => {
    const gx = (x / size) * grid, gy = (y / size) * grid;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
    const at = (i: number, j: number) => cells[(((j % grid) + grid) % grid) * grid + (((i % grid) + grid) % grid)];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!, img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = (noise(x, y) - 0.5) * 2 * amp + (rnd() - 0.5) * amp * 0.5;
    const o = (y * size + x) * 4;
    img.data[o] = Math.max(0, Math.min(255, base[0] * (1 + v)));
    img.data[o + 1] = Math.max(0, Math.min(255, base[1] * (1 + v)));
    img.data[o + 2] = Math.max(0, Math.min(255, base[2] * (1 + v)));
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return `url(${c.toDataURL()})`;
}

const hex = (pal: Uint8Array, i: number) => `#${[0, 1, 2].map((k) => pal[i * 3 + k].toString(16).padStart(2, '0')).join('')}`;

export function applyMobileTheme(assets: Assets) {
  const root = document.body.style;
  const pal = assets.palette;
  // textures: medium green window metal (strip beside the animation) and the dark inset area
  // procedural metal in the greens of the original windows (mean colours of the UIA bitmaps)
  root.setProperty('--tex-dark', metal(96, [34, 78, 40], 0.22, 7));
  root.setProperty('--tex-light', metal(96, [48, 108, 54], 0.2, 19));
  root.setProperty('--field', hex(pal, 227));
  root.setProperty('--field-edge', hex(pal, 225));
  root.setProperty('--yellow', hex(pal, 230));
  root.setProperty('--yellow-hi', hex(pal, 229));
  root.setProperty('--yellow-lo', hex(pal, 232));
  root.setProperty('--text', COLORS.text);
  root.setProperty('--muted', COLORS.muted);
  root.setProperty('--accent', COLORS.accent);
  root.setProperty('--bevel-hi', '#a8cfa4');
  root.setProperty('--bevel-lo', '#0b1f0d');
}
