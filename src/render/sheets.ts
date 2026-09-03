/**
 * Canonical layout of every pixel sheet in `src/assets/`.
 *
 * ONE source of truth for cell size + row/frame counts, shared by:
 *  - `sprites.ts`     — the game reads `cellW` / `cellH` from here;
 *  - `src/editor/*`   — the in-repo pixel editor draws its cell / row guides
 *                       and drives the animation preview from here;
 *  - `tools/gen-sprites.mjs` — the legacy placeholder generator (plain `.mjs`,
 *                       cannot import this file — keep its dimensions in sync by
 *                       hand if you ever re-run it).
 *
 * `fps` / `loop` are animation-only concerns; `sprites.ts` still owns the
 * runtime `PUNCHER_CLIPS` mapping, but its `row` / `frames` must match the
 * order here.
 */

export interface RowDef {
  /** Clip name — also the label the editor prints next to the row. */
  name: string;
  /** How many cells across this row actually hold art. */
  frames: number;
  /** Playback rate for the editor's preview. */
  fps: number;
  loop: boolean;
}

export interface SheetDef {
  /** File in `src/assets/`, also the editor's dropdown label. */
  file: string;
  cellW: number;
  cellH: number;
  /** Columns the sheet occupies on disk (`cols * cellW` px wide). */
  cols: number;
  rows: RowDef[];
}

const PUNCHER_ROWS: RowDef[] = [
  { name: "idle", frames: 2, fps: 2, loop: true },
  { name: "walk", frames: 4, fps: 10, loop: true },
  { name: "windup", frames: 1, fps: 1, loop: false },
  { name: "extension", frames: 1, fps: 1, loop: false },
  { name: "recovery", frames: 1, fps: 1, loop: false },
  { name: "hitdead", frames: 2, fps: 6, loop: false },
];

export const SHEETS = {
  "puncher-m": {
    file: "puncher-m.png",
    cellW: 24,
    cellH: 40,
    cols: 4,
    rows: PUNCHER_ROWS,
  },
  "puncher-f": {
    file: "puncher-f.png",
    cellW: 24,
    cellH: 40,
    cols: 4,
    rows: PUNCHER_ROWS,
  },
  missile: {
    file: "missile.png",
    cellW: 24,
    cellH: 12,
    cols: 3,
    rows: [{ name: "fly", frames: 3, fps: 14, loop: true }],
  },
  shrub: {
    file: "shrub.png",
    cellW: 16,
    cellH: 12,
    cols: 2,
    rows: [{ name: "props", frames: 2, fps: 1, loop: false }],
  },
} satisfies Record<string, SheetDef>;

export type SheetName = keyof typeof SHEETS;

export const SHEET_NAMES = Object.keys(SHEETS) as SheetName[];

export const sheetPixelW = (s: SheetDef): number => s.cols * s.cellW;
export const sheetPixelH = (s: SheetDef): number => s.rows.length * s.cellH;
