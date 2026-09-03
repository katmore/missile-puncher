import { CONFIG, SCREEN_W, SCREEN_H } from "../config";
import { drawCell, type Assets } from "./sprites";

let skyGradient: CanvasGradient | null = null;
let skyKey = "";

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
): void {
  const bg = CONFIG.bg;

  // sky — gradient is cached until either stop colour changes
  const key = `${bg.sky_top}|${bg.sky_bottom}`;
  if (!skyGradient || key !== skyKey) {
    skyGradient = ctx.createLinearGradient(0, 0, 0, CONFIG.ground_y);
    skyGradient.addColorStop(0, bg.sky_top);
    skyGradient.addColorStop(1, bg.sky_bottom);
    skyKey = key;
  }
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, SCREEN_W, CONFIG.ground_y);

  // mountain layers, back to front
  for (const m of bg.mountains) {
    ctx.fillStyle = m.color;
    mountainRange(ctx, CONFIG.ground_y - m.base, m.height, m.period, m.phase);
  }

  // ground
  ctx.fillStyle = bg.ground;
  ctx.fillRect(0, CONFIG.ground_y, SCREEN_W, SCREEN_H - CONFIG.ground_y);
  ctx.fillStyle = bg.ground_edge;
  ctx.fillRect(0, CONFIG.ground_y, SCREEN_W, bg.ground_edge_h);
  ctx.fillStyle = bg.pebble;
  for (let x = 6; x < SCREEN_W; x += bg.pebble_spacing) {
    ctx.fillRect(x, CONFIG.ground_y + 10, 5, 2);
    ctx.fillRect(x + 14, CONFIG.ground_y + 22, 4, 2);
  }

  // shrubs / rocks sit on the ground line
  for (const [x, frame] of bg.shrubs) {
    drawCell(
      ctx,
      assets.shrub,
      frame,
      0,
      x,
      CONFIG.ground_y - assets.shrub.cellH + 1,
    );
  }
}

function mountainRange(
  ctx: CanvasRenderingContext2D,
  baseY: number,
  height: number,
  period: number,
  phase: number,
): void {
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  for (let x = -period; x <= SCREEN_W + period; x += period) {
    ctx.lineTo(x + phase + period / 2, baseY - height);
    ctx.lineTo(x + phase + period, baseY);
  }
  ctx.lineTo(SCREEN_W, baseY);
  ctx.closePath();
  ctx.fill();
}

export function invalidateBackground(): void {
  skyGradient = null;
}
