import { CONFIG, SCREEN_W } from "../config";
import type { Rect } from "../engine/aabb";

export type MissileState = "incoming" | "punched" | "exploding" | "gone";

export class Missile {
  x: number;
  y: number;
  vx: number;
  state: MissileState = "incoming";

  /** ms left before a reflected missile detonates in mid-air. */
  fuseMs = 0;
  /** ms left on the current explosion animation. */
  explodeTimer = 0;
  /** true for the larger successful-punch airburst. */
  big = false;

  /**
   * @param fromRight enters from the right edge flying left (default), else
   *   enters from the left edge flying right.
   * @param speed px/s (magnitude).
   */
  constructor(fromRight = true, speed = CONFIG.missile_speed) {
    this.y = CONFIG.missile_height;
    if (fromRight) {
      this.x = SCREEN_W + CONFIG.missile_width;
      this.vx = -speed;
    } else {
      this.x = -CONFIG.missile_width;
      this.vx = speed;
    }
  }

  private offScreen(pad: number): boolean {
    return (
      this.x < -CONFIG.missile_width - pad ||
      this.x > SCREEN_W + CONFIG.missile_width + pad
    );
  }

  update(dtMs: number): void {
    if (this.state === "incoming") {
      this.x += (this.vx * dtMs) / 1000;
      this.y = CONFIG.missile_height;
      // dodged past everyone -> just despawn
      if (this.offScreen(8)) this.state = "gone";
    } else if (this.state === "punched") {
      this.x += (this.vx * dtMs) / 1000;
      this.y = CONFIG.missile_height;
      this.fuseMs -= dtMs;
      if (this.fuseMs <= 0 || this.offScreen(0)) this.detonate(true);
    } else if (this.state === "exploding") {
      this.explodeTimer -= dtMs;
      if (this.explodeTimer <= 0) this.state = "gone";
    }
  }

  /** Knocked back the way it came; now on a short fuse. */
  reflect(): void {
    this.vx = -this.vx * CONFIG.missile_reflect_speed_mult;
    this.state = "punched";
    this.fuseMs = CONFIG.punched_fuse;
  }

  /** Blow up. `big` = the satisfying successful-punch airburst. */
  detonate(big: boolean): void {
    if (this.state === "exploding" || this.state === "gone") return;
    this.state = "exploding";
    this.big = big;
    this.explodeTimer = big
      ? CONFIG.success_explosion_ms
      : CONFIG.explosion_ms;
    this.vx = 0;
  }

  collider(): Rect {
    return {
      x: this.x - CONFIG.missile_width / 2,
      y: this.y - CONFIG.missile_height_px / 2,
      w: CONFIG.missile_width,
      h: CONFIG.missile_height_px,
    };
  }
}
