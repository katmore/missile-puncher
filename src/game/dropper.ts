import { CONFIG } from "../config";
import type { Rect } from "../engine/aabb";

export type DropperState = "falling" | "exploding" | "gone";

/**
 * The anti-camp hazard: a missile that falls straight down onto a locked x.
 * Deliberately tiny compared to `Missile` — it is never punched, reflected or
 * fused, so it has none of that machinery. Spawned by the camp timer in
 * `Game`; a body overlap while `falling` is a MISS, reaching the ground clear
 * is a harmless burst.
 */
export class Dropper {
  x: number;
  y = CONFIG.drop_spawn_y;
  /** Current downward speed — starts at `drop_speed`, grows by `drop_accel`. */
  vy = CONFIG.drop_speed;
  state: DropperState = "falling";
  /** ms left on the impact burst animation. */
  explodeTimer = 0;

  /** @param targetX locked screen x (the camping Puncher's centre). */
  constructor(targetX: number) {
    this.x = targetX;
  }

  update(dtMs: number): void {
    if (this.state === "falling") {
      const dt = dtMs / 1000;
      this.vy += CONFIG.drop_accel * dt;
      this.y += this.vy * dt;
      if (this.y >= CONFIG.ground_y) this.detonate();
    } else if (this.state === "exploding") {
      this.explodeTimer -= dtMs;
      if (this.explodeTimer <= 0) this.state = "gone";
    }
  }

  detonate(): void {
    if (this.state !== "falling") return;
    this.state = "exploding";
    this.explodeTimer = CONFIG.explosion_ms;
    this.vy = 0;
  }

  /** ms until the hazard reaches ground level (Infinity once it has landed). */
  etaMs(): number {
    if (this.state !== "falling") return Infinity;
    const d = CONFIG.ground_y - this.y;
    const a = CONFIG.drop_accel;
    // d = vy·t + ½·a·t²  →  solve for t
    const t =
      a > 0
        ? (-this.vy + Math.sqrt(this.vy * this.vy + 2 * a * d)) / a
        : d / this.vy;
    return t * 1000;
  }

  collider(): Rect {
    return {
      x: this.x - CONFIG.drop_collider_w / 2,
      y: this.y - CONFIG.drop_collider_h / 2,
      w: CONFIG.drop_collider_w,
      h: CONFIG.drop_collider_h,
    };
  }
}
