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
