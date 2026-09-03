import { CONFIG } from "../config";
import type { Rect } from "../engine/aabb";
import type { Game } from "../game/game";

function stroke(ctx: CanvasRenderingContext2D, r: Rect, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    Math.round(r.x) + 0.5,
    Math.round(r.y) + 0.5,
    Math.round(r.w) - 1,
    Math.round(r.h) - 1,
  );
}

export function drawDebug(ctx: CanvasRenderingContext2D, game: Game): void {
  const { puncher, missile } = game;

  stroke(ctx, puncher.bodyCollider(), "#00e0ff");

  const hb = puncher.punchHitbox();
  if (hb) {
    ctx.fillStyle = "rgba(255,80,80,0.35)";
    ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
    stroke(ctx, hb, "#ff4040");
  }

  if (missile && missile.state !== "gone") {
    const c = missile.collider();
    stroke(ctx, c, "#ffe000");
    // velocity vector
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const vlen = missile.vx * 0.15;
    ctx.strokeStyle = "#ffe000";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + vlen, cy);
    ctx.stroke();
  }

  // text panel
  ctx.font = "6px monospace";
  ctx.textBaseline = "top";
  const lines = [
    `puncher: ${puncher.state}`,
    puncher.state === "punch"
      ? `  phase: ${puncher.phase}  ${Math.max(0, puncher.phaseTimer).toFixed(0)}ms`
      : `  facing: ${puncher.facing}  vx: ${puncher.vx.toFixed(0)}`,
    `missile: ${missile ? missile.state : "—"}`,
    missile
      ? `  speed: ${Math.abs(missile.vx).toFixed(0)} px/s`
      : `  next in: ${game.spawnCountdownMs().toFixed(0)}ms`,
    `punch ${game.punches}/${CONFIG.limit_punch}  explode ${game.deflects}/${CONFIG.limit_explode}  miss ${game.hits}/${CONFIG.limit_miss}`,
    `escalate ${game.escalate}`,
  ];
  lines.forEach((t, i) => {
    ctx.fillStyle = "#000";
    ctx.fillText(t, 3, 3 + i * 8);
    ctx.fillStyle = "#9effa0";
    ctx.fillText(t, 2, 2 + i * 8);
  });

  // altitude / reach guides
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.moveTo(0, CONFIG.missile_height + 0.5);
  ctx.lineTo(ctx.canvas.width, CONFIG.missile_height + 0.5);
  ctx.stroke();
}
