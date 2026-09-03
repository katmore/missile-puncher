import { CONFIG } from "../config";

/**
 * Screen-feel state. Runs on wall-clock time (real frame dt), never the fixed
 * sim step, so hit-stop actually freezes the simulation while it decays.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  NO EMBELLISHMENT. This is deliberately just a hit-stop (a brief freeze); the
 *  explosion visual (renderer.drawExplosion) is a crude blocky pixel burst on
 *  purpose — NOT a smooth circle, no anti-aliasing, no alpha fade. Screen
 *  shake, white flashes, shockwave rings, particles, debris — all were here
 *  once and all were removed. Do NOT add "juice" / "flare" / "game feel", and
 *  do NOT "smooth out" or "polish" what's left, unless the user asks for that
 *  specific thing by name. Cruder and simpler is the target. See MECHANICS §11.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class Effects {
  private hitStopMs = 0;

  get hitStopActive(): boolean {
    return this.hitStopMs > 0;
  }

  clear(): void {
    this.hitStopMs = 0;
  }

  /** Fist meets missile — the moment of contact. */
  triggerHit(): void {
    if (CONFIG.hit_stop_on_reset) this.hitStopMs = CONFIG.hit_stop_duration;
  }

  /** The reflected missile detonates in mid-air — the payoff. */
  triggerSuccess(): void {
    this.hitStopMs = CONFIG.success_hit_stop;
  }

  /** The missile reaches the Puncher — failure. */
  triggerExplosion(): void {
    this.hitStopMs = CONFIG.explosion_hit_stop;
  }

  update(realDtMs: number): void {
    if (this.hitStopMs > 0) this.hitStopMs -= realDtMs;
  }
}
