import { CONFIG, SCREEN_W, SCREEN_H } from "../config";
import { showBuildBadge } from "../build";
import type { Game } from "../game/game";
import { drawBackground } from "./background";
import { drawDebug } from "./debug";
import {
  drawDownedScreen,
  drawEndScreen,
  drawBuildBadge,
  drawEscalationScreen,
  drawHud,
  drawKillVars,
  drawStartScreen,
  drawTiredStrike,
  layoutKillVars,
  type KillVar,
} from "./hud";
import {
  PUNCHER_CLIPS,
  drawCell,
  frameIndex,
  loadAssets,
  puncherClip,
  puncherSheet,
  type Assets,
  type PuncherClipName,
} from "./sprites";

/** Deterministic hash -> [0,1); stable per integer seed. */
function frac(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** smoothstep easing for 0..1 */
function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

export class Renderer {
  private assets: Assets | null = null;

  private puncherAnim: { name: PuncherClipName; elapsed: number } = {
    name: "idle",
    elapsed: 0,
  };
  private missileAnimMs = 0;
  private clockMs = 0;
  private glitchBuf: HTMLCanvasElement | null = null;
  private killLayout: KillVar[] | null = null;

  async init(): Promise<void> {
    this.assets = await loadAssets();
  }

  render(
    ctx: CanvasRenderingContext2D,
    game: Game,
    realDtMs: number,
  ): void {
    this.renderScene(ctx, game, realDtMs);
    // Build badge sits on top of every scene (dim overlays, glitch pass, HUD).
    if (showBuildBadge()) drawBuildBadge(ctx);
  }

  private renderScene(
    ctx: CanvasRenderingContext2D,
    game: Game,
    realDtMs: number,
  ): void {
    const assets = this.assets;
    if (!assets) return;

    const kill = game.scene === "kill";
    const frozen =
      kill || game.scene === "end" || game.scene === "escalation";
    this.clockMs += realDtMs;
    if (!frozen) this.missileAnimMs += realDtMs;
    if (!kill) this.killLayout = null;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    drawBackground(ctx, assets);

    if (game.scene === "select") {
      drawStartScreen(ctx, game, assets, this.clockMs);
      drawHud(ctx, game, assets);
      return;
    }

    // Play, kill, end, and tired all render the world. On kill/end it is
    // frozen (game.update stops); kill additionally corrupts it. tired stays
    // live (the puncher just doesn't move) so its laser + dropper strike can
    // animate. No screen shake / flash / shockwave — see game/effects.ts.
    const worldDt = frozen ? 0 : realDtMs;
    const drawMissile = () => this.drawMissile(ctx, assets, game);
    const drawPuncher = () => this.drawPuncher(ctx, assets, game, worldDt);

    this.drawCampWarning(ctx, game);

    if (CONFIG.missile_draw_on_top) {
      drawPuncher();
      drawMissile();
    } else {
      drawMissile();
      drawPuncher();
    }
    this.drawDropper(ctx, assets, game);

    if (kill) {
      this.glitchPass(ctx, game.killMs);
      if (!this.killLayout) this.killLayout = layoutKillVars(game);
      drawKillVars(ctx, this.killLayout, game.killMs);
      return;
    }

    if (game.scene === "end") {
      drawEndScreen(ctx, game, this.clockMs, game.endMs, assets);
      drawHud(ctx, game, assets);
      return;
    }

    if (game.scene === "tired") {
      drawTiredStrike(ctx, game, this.clockMs, assets);
      drawHud(ctx, game, assets);
      return;
    }

    if (game.scene === "escalation") {
      drawEscalationScreen(ctx, this.clockMs);
      drawHud(ctx, game, assets);
      return;
    }

    if (game.scene === "downed") {
      drawDownedScreen(ctx, this.clockMs, game.downedMs);
      drawHud(ctx, game, assets);
      return;
    }

    drawHud(ctx, game, assets);
    if (game.debug) drawDebug(ctx, game);
  }

  /**
   * Corrupts the (already-drawn, frozen) frame: snapshots it, then paints
   * slowly-shifting displaced slices back over a darkened base. Everything
   * eases between states over ~1.5s so nothing strobes.
   */
  private glitchPass(ctx: CanvasRenderingContext2D, elapsedMs: number): void {
    if (!this.glitchBuf) {
      this.glitchBuf = document.createElement("canvas");
      this.glitchBuf.width = SCREEN_W;
      this.glitchBuf.height = SCREEN_H;
    }
    const snap = this.glitchBuf.getContext("2d")!;
    snap.clearRect(0, 0, SCREEN_W, SCREEN_H);
    snap.drawImage(ctx.canvas, 0, 0);

    const sev = Math.min(0.75, 0.3 + elapsedMs / 9000);
    // slow phase: whole seed changes ~every 1.5s, and we ease across it
    const p = elapsedMs / 1500;
    const seed = Math.floor(p);
    const ease = smooth(p - seed);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // sink the frame
    ctx.fillStyle = `rgba(9,3,7,${(0.5 + 0.2 * sev).toFixed(3)})`;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    // a handful of slices, each drifting from its previous offset to the next
    for (let i = 0; i < 5; i++) {
      const y = frac(seed * 3 + i * 71 + 5) * SCREEN_H;
      const h = 8 + frac(i * 131 + 2) * 26;
      const from = (frac(seed * 7 + i * 53) - 0.5) * 40 * sev;
      const to = (frac((seed + 1) * 7 + i * 53) - 0.5) * 40 * sev;
      const dx = from + (to - from) * ease;
      ctx.drawImage(this.glitchBuf, 0, y, SCREEN_W, h, dx, y, SCREEN_W, h);
    }

    // faint, static-ish colour bands (low alpha, slow drift, no flashing)
    for (let i = 0; i < 4; i++) {
      const yFrom = frac(seed * 11 + i * 97) * SCREEN_H;
      const yTo = frac((seed + 1) * 11 + i * 97) * SCREEN_H;
      const y = yFrom + (yTo - yFrom) * ease;
      const tint = i % 2 ? "rgba(255,70,90,0.10)" : "rgba(90,200,255,0.09)";
      ctx.fillStyle = tint;
      ctx.fillRect(0, y, SCREEN_W, 6 + frac(i * 41) * 10);
    }

    // constant dim scanline veil — texture, not motion
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    for (let y = 0; y < SCREEN_H; y += 3) ctx.fillRect(0, y, SCREEN_W, 1);
  }

  private drawPuncher(
    ctx: CanvasRenderingContext2D,
    assets: Assets,
    game: Game,
    realDtMs: number,
  ): void {
    const p = game.puncher;
    const name = puncherClip(p);
    if (name !== this.puncherAnim.name) {
      this.puncherAnim = { name, elapsed: 0 };
    } else {
      this.puncherAnim.elapsed += realDtMs;
    }
    const clip = PUNCHER_CLIPS[name];
    const col = frameIndex(clip, this.puncherAnim.elapsed);
    const sheet = puncherSheet(assets, game.gender);

    // Align the 24x40 sprite cell so its feet land on the ground and the
    // 16px-wide body collider is centred within it.
    const dx = p.x - (sheet.cellW - CONFIG.puncher_width) / 2;
    const dy = CONFIG.ground_y - sheet.cellH + 4;
    drawCell(ctx, sheet, col, clip.row, dx, dy, p.facing === "left");
  }

  private drawMissile(
    ctx: CanvasRenderingContext2D,
    assets: Assets,
    game: Game,
  ): void {
    const m = game.missile;
    if (!m || m.state === "gone") return;

    if (m.state === "exploding") {
      const total = m.big ? CONFIG.success_explosion_ms : CONFIG.explosion_ms;
      const radius = m.big
        ? CONFIG.success_explosion_radius
        : CONFIG.explosion_radius;
      this.drawExplosion(ctx, m.x, m.y, m.explodeTimer, total, radius);
      return;
    }

    const frame = 1 + (Math.floor(this.missileAnimMs / 70) % 2); // exhaust flicker
    const flip = m.vx > 0; // sprite points left by default; flip after reflection
    drawCell(
      ctx,
      assets.missile,
      frame,
      0,
      m.x - assets.missile.cellW / 2,
      m.y - assets.missile.cellH / 2,
      flip,
    );
  }

  private campLaserStage = 0;
  private campStageFlashUntil = 0;

  /**
   * The anti-camp telegraph. Two beats:
   *   1. from `camp_warn_fraction` → the sound-lead point: the emitter shows and
   *      the laser holds at **stage 1** (a stub) — "something is aiming here".
   *   2. over the final `camp_warn_sound_lead_ms` (with the warble): the laser
   *      descends the column in `camp_warn_stages` steps, hitting the ground as
   *      the missile drops. A flash + brighter leading segment on each step.
   */
  private drawCampWarning(ctx: CanvasRenderingContext2D, game: Game): void {
    if (game.scene !== "play") {
      this.campLaserStage = 0;
      return;
    }
    if (game.campWarnLevel() <= 0) {
      this.campLaserStage = 0;
      return;
    }

    const x = Math.round(game.campAnchorX + CONFIG.puncher_width / 2) + 0.5;
    const gy = CONFIG.ground_y;
    const apexY = 13;
    const emitterH = 6;
    const topY = apexY + emitterH; // where the beam leaves the emitter

    const steps = Math.max(1, CONFIG.camp_warn_stages);
    // descent progress: 0 through the "waiting" beat, then 0→1 over the final
    // sound-lead window so the beam lands exactly when the missile spawns.
    const lead = Math.max(1, CONFIG.camp_warn_sound_lead_ms);
    const descentT = Math.max(
      0,
      (game.campMs - (CONFIG.camp_time_ms - lead)) / lead,
    );
    const stage =
      descentT <= 0
        ? 1
        : Math.min(steps, 1 + Math.floor(descentT * (steps - 1) + 1e-4));
    if (stage !== this.campLaserStage) {
      this.campLaserStage = stage;
      this.campStageFlashUntil = this.clockMs + 110;
    }
    const flashing = this.clockMs < this.campStageFlashUntil;
    const waiting = descentT <= 0;

    const beamEndY = topY + ((gy - topY) * stage) / steps;

    // emitter — a small down-triangle, steady
    ctx.fillStyle = "rgba(255,64,52,0.92)";
    ctx.beginPath();
    ctx.moveTo(x - 4, apexY);
    ctx.lineTo(x + 4, apexY);
    ctx.lineTo(x, apexY + emitterH);
    ctx.closePath();
    ctx.fill();

    // the beam — a stub that gently breathes while waiting, then snaps down
    // one stage-length at a time during the descent
    const breathe = waiting ? 0.4 + 0.25 * Math.sin(this.clockMs / 260) : 0.8;
    ctx.strokeStyle = flashing
      ? "rgba(255,180,150,0.95)"
      : `rgba(255,54,42,${breathe.toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, beamEndY);
    ctx.stroke();

    if (!waiting) {
      // brighter leading segment (the chunk that most recently extended)
      ctx.strokeStyle = "rgba(255,150,110,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, Math.max(topY, beamEndY - (gy - topY) / steps + 2));
      ctx.lineTo(x, beamEndY);
      ctx.stroke();
    }

    // pulsing lock dot at the beam tip
    const p = 0.55 + 0.45 * Math.sin(this.clockMs / 55);
    ctx.fillStyle = `rgba(255,90,70,${p.toFixed(3)})`;
    ctx.fillRect(x - 1.5, beamEndY - 1.5, 3, 3);

    // ground mark — brightens as the beam nears it
    const gm = (0.25 + 0.75 * (stage / steps)).toFixed(3);
    const half = 9;
    ctx.fillStyle = `rgba(200,70,60,${(Number(gm) * 0.35).toFixed(3)})`;
    ctx.fillRect(x - half, gy - 2, half * 2, 4);
    ctx.strokeStyle = `rgba(230,90,80,${gm})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const s of [-1, 1]) {
      ctx.moveTo(x + s * half, gy - 4.5);
      ctx.lineTo(x + s * half, gy + 2.5);
      ctx.lineTo(x + s * (half - 4), gy + 2.5);
    }
    ctx.stroke();
  }

  /** The falling anti-camp hazard: cruise sprite rotated nose-down, then a burst. */
  private drawDropper(
    ctx: CanvasRenderingContext2D,
    assets: Assets,
    game: Game,
  ): void {
    const d = game.dropper;
    if (!d || d.state === "gone") return;

    if (d.state === "exploding") {
      this.drawExplosion(
        ctx,
        d.x,
        CONFIG.ground_y,
        d.explodeTimer,
        CONFIG.explosion_ms,
        CONFIG.explosion_radius,
      );
      return;
    }

    // faint guide line from the hazard down to its landing x
    ctx.strokeStyle = "rgba(230,90,80,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(d.x) + 0.5, Math.max(0, d.y));
    ctx.lineTo(Math.round(d.x) + 0.5, CONFIG.ground_y);
    ctx.stroke();

    const sheet = assets.missile;
    const frame = 1 + (Math.floor(this.missileAnimMs / 70) % 2);
    ctx.save();
    ctx.translate(Math.round(d.x), Math.round(d.y));
    ctx.rotate(-Math.PI / 2); // cruise sprite noses left → rotate CCW → nose down
    ctx.drawImage(
      sheet.img,
      frame * sheet.cellW,
      0,
      sheet.cellW,
      sheet.cellH,
      -sheet.cellW / 2,
      -sheet.cellH / 2,
      sheet.cellW,
      sheet.cellH,
    );
    ctx.restore();
  }

  /**
   * A crude blocky burst — hard-edged 3px blocks in a rough circle, no
   * anti-aliasing, no alpha fade, flat colour, snapped to ~3 discrete grow
   * frames. Matches the chunky sprite art; do NOT make it smooth. See the note
   * in game/effects.ts.
   */
  private drawExplosion(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    timerMs: number,
    totalMs: number,
    maxRadius: number,
  ): void {
    const life = 1 - Math.max(0, Math.min(1, timerMs / totalMs)); // 0 -> 1
    const B = 3; // block size (px)
    const frame = Math.min(2, Math.floor(life * 3)); // 0,1,2
    const scale = [0.45, 0.8, 1][frame];
    const r = Math.round((maxRadius * scale) / B) * B;
    if (r <= 0) return;

    const cx = Math.round(x / B) * B;
    const cy = Math.round(y / B) * B;
    ctx.fillStyle = frame === 0 ? "#ffd25a" : "#ff8c32";
    for (let bx = -r; bx <= r; bx += B) {
      const h = Math.round(Math.sqrt(Math.max(0, r * r - bx * bx)) / B) * B;
      if (h <= 0) continue;
      ctx.fillRect(cx + bx, cy - h, B, h * 2);
    }
  }
}
