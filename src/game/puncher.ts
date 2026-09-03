import { CONFIG, SCREEN_W } from "../config";
import type { Rect } from "../engine/aabb";
import type { Input } from "../engine/input";

export type Facing = "left" | "right";
export type PuncherState = "idle" | "walk" | "punch" | "hitdead";
export type PunchPhase = "startup" | "active" | "recovery";

export class Puncher {
  x = CONFIG.puncher_start_x;
  vx = 0;
  facing: Facing = "right";
  state: PuncherState = "idle";
  grounded = true;

  /** Only meaningful while `state === "punch"`. */
  phase: PunchPhase = "startup";
  phaseTimer = 0; // ms remaining in the current phase

  /** One-tick pulse: true on the frame a new punch begins. */
  punchStarted = false;

  reset(): void {
    this.x = CONFIG.puncher_start_x;
    this.vx = 0;
    this.facing = "right";
    this.state = "idle";
    this.phase = "startup";
    this.phaseTimer = 0;
    this.punchStarted = false;
  }

  update(dtMs: number, input: Input): void {
    this.punchStarted = false;
    if (this.state === "hitdead") return;

    if (this.state === "punch") {
      this.advancePunch(dtMs);
      return;
    }

    // Free movement (idle / walk).
    const left = input.down("left");
    const right = input.down("right");
    const dir = (right ? 1 : 0) - (left ? 1 : 0);

    this.vx = dir * CONFIG.player_speed;
    if (dir > 0) this.facing = "right";
    else if (dir < 0) this.facing = "left";

    this.x += (this.vx * dtMs) / 1000;
    this.clampToScreen();

    this.state = this.vx !== 0 ? "walk" : "idle";

    if (input.pressed("punch")) this.startPunch();
  }

  private startPunch(): void {
    this.state = "punch";
    this.phase = "startup";
    this.phaseTimer = CONFIG.punch_startup;
    this.punchStarted = true;
    if (CONFIG.rooted_during_punch) this.vx = 0;
  }

  private advancePunch(dtMs: number): void {
    if (CONFIG.rooted_during_punch) {
      this.vx = 0;
    } else {
      this.x += (this.vx * dtMs) / 1000;
      this.clampToScreen();
    }

    this.phaseTimer -= dtMs;
    while (this.phaseTimer <= 0) {
      if (this.phase === "startup") {
        this.phase = "active";
        this.phaseTimer += CONFIG.punch_active_time;
      } else if (this.phase === "active") {
        this.phase = "recovery";
        this.phaseTimer += CONFIG.punch_recovery;
      } else {
        this.state = "idle";
        this.phaseTimer = 0;
        return;
      }
    }
  }

  private clampToScreen(): void {
    const maxX = SCREEN_W - CONFIG.puncher_width;
    if (this.x < 0) this.x = 0;
    else if (this.x > maxX) this.x = maxX;
  }

  bodyCollider(): Rect {
    return {
      x: this.x,
      y: CONFIG.ground_y - CONFIG.puncher_height,
      w: CONFIG.puncher_width,
      h: CONFIG.puncher_height,
    };
  }

  /** The punch hitbox — non-null only during the active phase. */
  punchHitbox(): Rect | null {
    if (this.state !== "punch" || this.phase !== "active") return null;
    const h = CONFIG.puncher_height * 0.4;
    const y = CONFIG.missile_height - h / 2;
    if (this.facing === "right") {
      return { x: this.x + CONFIG.puncher_width, y, w: CONFIG.punch_reach, h };
    }
    return { x: this.x - CONFIG.punch_reach, y, w: CONFIG.punch_reach, h };
  }
}
