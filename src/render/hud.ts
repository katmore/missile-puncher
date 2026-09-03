import { BUILD } from "../build";
import { SCREEN_W, SCREEN_H, CONFIG, type Gender } from "../config";
import { LABELS } from "../labels";
import type { Game } from "../game/game";
import { SHEETS } from "./sheets";
import { KILL_DISTORT_CYCLE_MS } from "../killscreen";
import { GLYPH_H, drawText, textWidth } from "./font";
import {
  HEAD_CROP,
  PUNCHER_CLIPS,
  drawCell,
  drawHead,
  frameIndex,
  puncherSheet,
  type Assets,
} from "./sprites";

const rot13 = (s: string): string =>
  s.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });

/** the 5 colours the overflowed variable endlessly cycles through */
const DISTORT_COLORS = ["#ff3b6b", "#22e0ff", "#ffe14d", "#8cff5a", "#ff8a2a"];

const DED_GAP = 2; // px between the head icon and its number

/** Pixel width of the head-icon + number combo — for layout / centering. */
function dedBadgeWidth(remaining: number): number {
  return HEAD_CROP.w + DED_GAP + textWidth(String(remaining));
}

/**
 * The current puncher's head + remaining-hits-before-BAD-END, replacing the
 * old "DED: N" text. `x, y` is the head icon's top-left corner.
 */
function drawDedBadge(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  game: Game,
  x: number,
  y: number,
  color: string,
): void {
  drawHead(ctx, puncherSheet(assets, game.gender), x, y);
  const remaining = CONFIG.limit_miss - game.hits;
  const numX = x + HEAD_CROP.w + DED_GAP;
  const numY = y + Math.round((HEAD_CROP.h - GLYPH_H) / 2);
  drawText(ctx, String(remaining), numX, numY, color, "left");
}

/** Running scoreboard, always visible during play. */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  game: Game,
  assets: Assets,
): void {
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  ctx.fillRect(0, 0, SCREEN_W, 11);
  const h = LABELS.hud;

  const margin = 2;
  drawDedBadge(ctx, assets, game, margin, 0, "#ffffff");

  const rest = [
    `${h.punch}: ${game.punches}`,
    `${h.explode}: ${game.deflects}`,
    `${h.escalate}: ${game.escalate}`,
    `${h.speed}: ${game.speedLevel}`,
  ].join(h.sep);
  const restX =
    margin + dedBadgeWidth(CONFIG.limit_miss - game.hits) + textWidth(h.sep);
  drawText(ctx, rest, restX, 2, "#ffffff", "left");
}

/**
 * Backbuffer-space rects for the two start-screen figures (incl. the name
 * label above). Single source of truth for `drawStartScreen` and the
 * tap-to-pick touch hit-test (`engine/touch.ts`).
 */
export function selectSlots(
  game: Game,
): { gender: Gender; x: number; y: number; w: number; h: number }[] {
  const { cellW: w, cellH: h } = SHEETS["puncher-m"];
  const y = CONFIG.ground_y + 8 - h;
  const right: Gender = game.leftGender === "m" ? "f" : "m";
  return [
    { gender: game.leftGender, x: SCREEN_W / 2 - 52, y, w, h },
    { gender: right, x: SCREEN_W / 2 + 28, y, w, h },
  ];
}

/** Start screen: choose the Puncher, then punch to begin. */
export function drawStartScreen(
  ctx: CanvasRenderingContext2D,
  game: Game,
  assets: Assets,
  clockMs: number,
): void {
  ctx.fillStyle = "rgba(8,8,16,0.42)";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  drawText(ctx, LABELS.start.title, SCREEN_W / 2, 32, "#ffe27a", "center");
  drawText(ctx, LABELS.start.prompt, SCREEN_W / 2, 48, "#ffffff", "center");

  const clip = PUNCHER_CLIPS.idle;
  const col = frameIndex(clip, clockMs);
  const footY = CONFIG.ground_y + 8;

  for (const slot of selectSlots(game)) {
    const sheet = puncherSheet(assets, slot.gender);
    const dx = slot.x;
    const dy = footY - sheet.cellH;
    const selected = game.gender === slot.gender;
    const midX = dx + sheet.cellW / 2;

    drawText(
      ctx,
      slot.gender === "m" ? LABELS.start.guy : LABELS.start.gal,
      midX,
      dy - 12,
      selected ? "#ffe27a" : "#9a9daa",
      "center",
    );

    if (selected) {
      ctx.strokeStyle = "#ffe27a";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        Math.round(dx) - 3.5,
        Math.round(dy) - 3.5,
        sheet.cellW + 6,
        sheet.cellH + 6,
      );
    }
    drawCell(ctx, sheet, col, clip.row, dx, dy, false);
  }

  drawText(ctx, "←  →", SCREEN_W / 2, footY + 12, "#cfd2da", "center");
  if (Math.floor(clockMs / 450) % 2 === 0) {
    drawText(ctx, LABELS.start.begin, SCREEN_W / 2, footY + 24, "#ffffff", "center");
  }
}

/**
 * Build-flavour badge: steady red mode name in the lower-left on every screen
 * of a non-production build (`DEV` now, `DEBUG` later). A persistent "not the
 * shipping build" watermark — gameplay is identical with or without it.
 */
export function drawBuildBadge(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawText(
    ctx,
    BUILD.mode,
    4,
    SCREEN_H - 10,
    "#ff3b3b",
    "left",
    "rgba(0,0,0,0.6)",
  );
}

export interface KillVar {
  text: string;
  x: number;
  y: number;
}

const KILL_MARGIN = 8;

/**
 * All three counters as ROT13'd `LABEL = value` strings. The one that tripped
 * the kill screen is centred; the other two are dropped at random spots that
 * don't overlap each other or run off-screen. Call once per kill and cache —
 * the random placement must not change frame to frame.
 */
export function layoutKillVars(game: Game): KillVar[] {
  const rows = [
    { label: LABELS.hud.punch, value: game.punches },
    { label: LABELS.hud.explode, value: game.deflects },
    { label: LABELS.hud.miss, value: game.hits },
  ];
  const mainLabel = game.killedBy().label;
  const ordered = [
    rows.find((r) => r.label === mainLabel)!,
    ...rows.filter((r) => r.label !== mainLabel),
  ];
  const items = ordered.map((r) => {
    const text = `${rot13(r.label)} = ${r.value}`;
    return { text, w: textWidth(text), h: 7 };
  });

  type Box = { text: string; x: number; y: number; w: number; h: number };
  const placed: Box[] = [];

  // main: centre of the screen
  placed.push({
    ...items[0],
    x: Math.round(SCREEN_W / 2 - items[0].w / 2),
    y: Math.round(SCREEN_H / 2 - items[0].h / 2),
  });

  for (let k = 1; k < items.length; k++) {
    const it = items[k];
    const maxX = SCREEN_W - it.w - KILL_MARGIN;
    const maxY = SCREEN_H - it.h - KILL_MARGIN;
    let box: Box | null = null;
    for (let tries = 0; tries < 80 && !box; tries++) {
      const cand: Box = {
        ...it,
        x: Math.round(KILL_MARGIN + Math.random() * (maxX - KILL_MARGIN)),
        y: Math.round(KILL_MARGIN + Math.random() * (maxY - KILL_MARGIN)),
      };
      if (!placed.some((p) => boxesOverlap(cand, p, 6))) box = cand;
    }
    placed.push(box ?? { ...it, x: KILL_MARGIN, y: KILL_MARGIN + (k - 1) * 22 });
  }

  return placed.map(({ text, x, y }) => ({ text, x, y }));
}

function boxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  pad: number,
): boolean {
  return (
    a.x - pad < b.x + b.w + pad &&
    a.x + a.w + pad > b.x - pad &&
    a.y - pad < b.y + b.h + pad &&
    a.y + a.h + pad > b.y - pad
  );
}

/**
 * Draws the cached kill-screen variables, each endlessly cycling the 5
 * distortion colours (offset per line) with a chromatic split and jitter.
 */
export function drawKillVars(
  ctx: CanvasRenderingContext2D,
  layout: KillVar[],
  killMs: number,
): void {
  const cycle = Math.floor(killMs / KILL_DISTORT_CYCLE_MS);
  const phase = (killMs % KILL_DISTORT_CYCLE_MS) / KILL_DISTORT_CYCLE_MS;
  const n = DISTORT_COLORS.length;

  layout.forEach((item, i) => {
    const c1 = DISTORT_COLORS[(cycle + i * 2) % n];
    const c2 = DISTORT_COLORS[(cycle + i * 2 + 2) % n];
    const spread = 1 + ((cycle + i) % 3);
    const jitter = (((cycle + i) % 2 ? 1 : -1) * ((cycle * 5) % 3)) | 0;
    const { text, x } = item;
    const y = item.y + jitter;

    drawText(ctx, text, x - spread, y, "#ff2b4a", "left", null);
    drawText(ctx, text, x + spread, y, "#22e0ff", "left", null);
    drawText(ctx, text, x, y, c1, "left", null);
    if (phase < 0.35) drawText(ctx, text, x + 1, y - 1, c2, "left", null);
  });
}

/**
 * The bad ending: play frame dimmed, headline centred. The blinking prompt at
 * the bottom appears (and input is accepted) only after `end_prompt_delay`.
 */
export function drawEndScreen(
  ctx: CanvasRenderingContext2D,
  clockMs: number,
  endMs: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "rgba(6,6,10,0.6)";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  drawText(
    ctx,
    LABELS.end.title,
    SCREEN_W / 2,
    Math.round(SCREEN_H / 2 - 3),
    "#ffffff",
    "center",
  );
  if (endMs >= CONFIG.end_prompt_delay) blinkPrompt(ctx, LABELS.end.prompt, clockMs);
}

/** Bottom-centred blinking call-to-action, shared by the downed / tired screens. */
function blinkPrompt(
  ctx: CanvasRenderingContext2D,
  text: string,
  clockMs: number,
): void {
  if (Math.floor(clockMs / 450) % 2 !== 0) return;
  drawText(
    ctx,
    text,
    SCREEN_W / 2,
    SCREEN_H - 16,
    "#ffffff",
    "center",
    "rgba(0,0,0,0.55)",
  );
}

/**
 * MISS aftermath: the world stays live (missiles keep bursting on the downed
 * puncher) — no dim overlay. The blinking prompt to punch out appears as soon
 * as the killing blow's explosion animation (`explosion_ms`) finishes — the
 * corpse keeps taking barrage fire in the background either way.
 */
export function drawDownedScreen(
  ctx: CanvasRenderingContext2D,
  clockMs: number,
  downedMs: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (downedMs < CONFIG.explosion_ms) return;
  blinkPrompt(ctx, LABELS.downed, clockMs);
}

/**
 * PUNCH-limit stop. Play frame frozen + dimmed (like BAD END), with the
 * ESCALATE / RUIN / MISS tally kept on screen. A blinking PUNCH prompt appears
 * at the bottom after `tired_prompt_delay`.
 */
export function drawTiredScreen(
  ctx: CanvasRenderingContext2D,
  game: Game,
  clockMs: number,
  assets: Assets,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "rgba(6,6,10,0.6)";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  const cx = SCREEN_W / 2;
  drawText(
    ctx,
    LABELS.tired.title,
    cx,
    Math.round(SCREEN_H / 2 - 12),
    "#ffffff",
    "center",
  );

  const h = LABELS.hud;
  const escText = `${h.escalate}: ${game.escalate}`;
  const remaining = CONFIG.limit_miss - game.hits;
  const tallyY = Math.round(SCREEN_H / 2 + 2);
  const totalW = textWidth(escText) + textWidth(h.sep) + dedBadgeWidth(remaining);
  const startX = Math.round(cx - totalW / 2);
  drawText(ctx, escText, startX, tallyY, "#c9ccd6", "left");
  const badgeX = startX + textWidth(escText) + textWidth(h.sep);
  const badgeY = tallyY - Math.round((HEAD_CROP.h - GLYPH_H) / 2);
  drawDedBadge(ctx, assets, game, badgeX, badgeY, "#c9ccd6");

  if (game.tiredMs >= CONFIG.tired_prompt_delay) {
    blinkPrompt(ctx, LABELS.tired.prompt, clockMs);
  }
}

/**
 * The escalation interstitial: steady "CONGRATS", and under it a slow
 * hard-blinking dark-orange "PREPARE FOR ESCALATION" over the frozen frame.
 * Holds a few seconds, then play resumes.
 */
export function drawEscalationScreen(
  ctx: CanvasRenderingContext2D,
  clockMs: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "rgba(6,6,10,0.62)";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  const cx = SCREEN_W / 2;
  drawText(ctx, LABELS.escalation.congrats, cx, Math.round(SCREEN_H / 2 - 12), "#ffffff", "center");

  // hard on/off blink, slow enough (~0.85s each way) not to strain the eyes
  if (Math.floor(clockMs / 850) % 2 === 0) {
    drawText(
      ctx,
      LABELS.escalation.prepare,
      cx,
      Math.round(SCREEN_H / 2 + 3),
      "#b5651d",
      "center",
      "rgba(0,0,0,0.45)",
    );
  }
}
