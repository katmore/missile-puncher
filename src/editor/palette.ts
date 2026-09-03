/**
 * The house palette — lifted straight from `tools/gen-sprites.mjs` so the
 * editor nudges you back toward the established look. `null` is the transparent
 * "erase" swatch. Free colours can still be mixed in via the `<input
 * type=color>` in the toolbar; they just are not on the quick-pick rail.
 */

export interface Swatch {
  name: string;
  /** `#rrggbb`, or `null` for transparent. */
  hex: string | null;
}

export const PALETTE: Swatch[] = [
  { name: "erase", hex: null },
  { name: "outline", hex: "#1a1816" },
  { name: "skin", hex: "#d8a06a" },
  { name: "fist", hex: "#e6b478" },
  { name: "hair", hex: "#5c4634" },
  { name: "shirt.m", hex: "#4a7a3a" },
  { name: "shirt.m.d", hex: "#345828" },
  { name: "shirt.f", hex: "#9c4a34" },
  { name: "shirt.f.d", hex: "#743424" },
  { name: "pants", hex: "#6b5a3c" },
  { name: "boot", hex: "#3a2e22" },
  { name: "missile", hex: "#b4b8be" },
  { name: "missile.d", hex: "#787c84" },
  { name: "missile.tip", hex: "#c8463c" },
  { name: "flame.a", hex: "#ffd25a" },
  { name: "flame.b", hex: "#ff8c32" },
  { name: "shrub", hex: "#6e804a" },
  { name: "shrub.d", hex: "#4e5e34" },
  { name: "rock", hex: "#8c8478" },
  { name: "rock.d", hex: "#686056" },
];

/** `#rgb` / `#rrggbb` -> [r,g,b,255]; anything unparseable -> opaque magenta. */
export function parseHex(hex: string): [number, number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [255, 0, 255, 255];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    255,
  ];
}

export function toHex(r: number, g: number, b: number): string {
  const p = (n: number) => n.toString(16).padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`;
}
