import puncherMUrl from "../assets/puncher-m.png";
import puncherFUrl from "../assets/puncher-f.png";
import missileUrl from "../assets/missile.png";
import shrubUrl from "../assets/shrub.png";
import type { Gender } from "../config";
import type { Puncher } from "../game/puncher";
import { SHEETS } from "./sheets";

export interface Sheet {
  img: HTMLImageElement;
  cellW: number;
  cellH: number;
}

export interface Clip {
  row: number;
  frames: number;
  fps: number;
  loop: boolean;
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

export interface Assets {
  puncherM: Sheet;
  puncherF: Sheet;
  missile: Sheet;
  shrub: Sheet;
}

export async function loadAssets(): Promise<Assets> {
  const [puncherM, puncherF, missile, shrub] = await Promise.all([
    load(puncherMUrl),
    load(puncherFUrl),
    load(missileUrl),
    load(shrubUrl),
  ]);
  const cell = (name: keyof typeof SHEETS, img: HTMLImageElement): Sheet => ({
    img,
    cellW: SHEETS[name].cellW,
    cellH: SHEETS[name].cellH,
  });
  return {
    puncherM: cell("puncher-m", puncherM),
    puncherF: cell("puncher-f", puncherF),
    missile: cell("missile", missile),
    shrub: cell("shrub", shrub),
  };
}

export function puncherSheet(assets: Assets, gender: Gender): Sheet {
  return gender === "f" ? assets.puncherF : assets.puncherM;
}

// Row order / frame counts must match `sheets.ts` (PUNCHER_ROWS) and
// tools/gen-sprites.mjs. This table adds the runtime-only fps / loop.
export const PUNCHER_CLIPS = {
  idle: { row: 0, frames: 2, fps: 2, loop: true },
  walk: { row: 1, frames: 4, fps: 10, loop: true },
  windup: { row: 2, frames: 1, fps: 1, loop: false },
  extension: { row: 3, frames: 1, fps: 1, loop: false },
  recovery: { row: 4, frames: 1, fps: 1, loop: false },
  hitdead: { row: 5, frames: 2, fps: 6, loop: false },
} as const satisfies Record<string, Clip>;

export type PuncherClipName = keyof typeof PUNCHER_CLIPS;

/** Maps the Puncher's live state to the clip that should be showing. */
export function puncherClip(p: Puncher): PuncherClipName {
  if (p.state === "hitdead") return "hitdead";
  if (p.state === "punch") {
    if (p.phase === "startup") return "windup";
    if (p.phase === "active") return "extension";
    return "recovery";
  }
  return p.state === "walk" ? "walk" : "idle";
}

/** Advances an animation clock and returns the frame index to draw. */
export function frameIndex(
  clip: Clip,
  elapsedMs: number,
): number {
  const raw = Math.floor((elapsedMs / 1000) * clip.fps);
  return clip.loop ? raw % clip.frames : Math.min(raw, clip.frames - 1);
}

/**
 * Crop of just the head from the idle clip's first frame (row 0, col 0) —
 * same rect works for both puncher sheets, the head sits in the same spot on
 * every cell. Used by the HUD's DED indicator (see hud.ts) instead of the
 * "DED: N" text it replaced.
 */
export const HEAD_CROP = { x: 5, y: 0, w: 13, h: 11 } as const;

export function drawHead(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  dx: number,
  dy: number,
): void {
  const { x, y, w, h } = HEAD_CROP;
  ctx.drawImage(sheet.img, x, y, w, h, Math.round(dx), Math.round(dy), w, h);
}

/**
 * Crop of just the forearm + fist from the "extension" clip's single frame
 * (the pose with the punch hitbox active) — same rect works for both
 * sheets. Used by the HUD's PNCH indicator instead of the "PNCH: N" text it
 * replaced. Starts right at the torso's own outline (x: 16), deliberately
 * excluding the torso itself — a body-shaped icon reads as confusing, not
 * as "a fist".
 */
export const FIST_CROP = {
  x: 16,
  y: PUNCHER_CLIPS.extension.row * SHEETS["puncher-m"].cellH + 11,
  w: 8,
  h: 6,
} as const;

export function drawFist(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  dx: number,
  dy: number,
): void {
  const { x, y, w, h } = FIST_CROP;
  ctx.drawImage(sheet.img, x, y, w, h, Math.round(dx), Math.round(dy), w, h);
}

/**
 * The missile sheet's two exhaust-flicker frames (1 and 2 of 3 — frame 2's
 * flame is bigger and two-toned orange/yellow, same flicker the flying
 * missile itself cycles through every 70ms), each composited from two
 * source slices that skip 2 columns of the flat midsection shaft (that run
 * is a uniform repeating pattern, so removing a couple of its columns is
 * seamless) — same nose, fin, and exhaust flame, just a couple pixels
 * shorter so it sits more snugly in the HUD bar. The tail slice is sized to
 * frame 2's larger flame so the icon's width — and the number after it —
 * doesn't shift as it flickers; frame 1's slightly narrower flame just
 * leaves its last column transparent. Used by the HUD's EXPL indicator
 * instead of the "EXPL: N" text it replaced. The sheet's missiles point
 * left by default (see renderer.ts's `flip` note), so drawMissileIcon
 * always mirrors this — nose right, exhaust trailing out the left,
 * matching reading order (icon, then its number).
 */
const MISSILE_NOSE_OFFSET = 1; // nose + most of the shaft
const MISSILE_NOSE_W = 11;
const MISSILE_TAIL_OFFSET = 14; // rest of shaft + fin + flame
const MISSILE_TAIL_W = 10;
const MISSILE_Y = 2;
const MISSILE_H = 8;

export const MISSILE_CROP = {
  w: MISSILE_NOSE_W + MISSILE_TAIL_W,
  h: MISSILE_H,
} as const;

/** Which exhaust-flicker frame (1 or 2 of the missile sheet) to draw. */
export type MissileFlicker = 1 | 2;

export function drawMissileIcon(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  dx: number,
  dy: number,
  frame: MissileFlicker = 1,
): void {
  const { w, h } = MISSILE_CROP;
  const frameX = sheet.cellW * frame;
  const roundedX = Math.round(dx);
  const roundedY = Math.round(dy);
  ctx.save();
  ctx.translate(roundedX + w, roundedY);
  ctx.scale(-1, 1);
  ctx.drawImage(
    sheet.img,
    frameX + MISSILE_NOSE_OFFSET,
    MISSILE_Y,
    MISSILE_NOSE_W,
    h,
    0,
    0,
    MISSILE_NOSE_W,
    h,
  );
  ctx.drawImage(
    sheet.img,
    frameX + MISSILE_TAIL_OFFSET,
    MISSILE_Y,
    MISSILE_TAIL_W,
    h,
    MISSILE_NOSE_W,
    0,
    MISSILE_TAIL_W,
    h,
  );
  ctx.restore();
}

export function drawCell(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  col: number,
  row: number,
  dx: number,
  dy: number,
  flipX = false,
): void {
  const { img, cellW, cellH } = sheet;
  if (flipX) {
    ctx.save();
    ctx.translate(Math.round(dx) + cellW, Math.round(dy));
    ctx.scale(-1, 1);
    ctx.drawImage(img, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);
    ctx.restore();
  } else {
    ctx.drawImage(
      img,
      col * cellW,
      row * cellH,
      cellW,
      cellH,
      Math.round(dx),
      Math.round(dy),
      cellW,
      cellH,
    );
  }
}
