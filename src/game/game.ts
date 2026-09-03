import { CONFIG, type Gender } from "../config";
import { LABELS } from "../labels";
import { overlap } from "../engine/aabb";
import { killRestartReady } from "../killscreen";
import { Rng } from "../engine/rng";
import type { Audio } from "../engine/audio";
import type { Input } from "../engine/input";
import { Dropper } from "./dropper";
import { Effects } from "./effects";
import { Missile, type MissileState } from "./missile";
import { Puncher } from "./puncher";

/**
 * Owns the whole simulation: the Puncher, the current Missile, feel effects, and
 * the attempt loop (spawn delay -> approach -> outcome -> reset -> repeat).
 */
export type Scene =
  | "select"
  | "play"
  | "kill" // mechanic kept in code, no longer reached from gameplay
  | "end"
  | "escalation"
  | "downed"
  | "tired";

const other = (g: Gender): Gender => (g === "m" ? "f" : "m");

/**
 * Highest ESCALATE level with bespoke spawn rules (see `rollMissile()`). On
 * completing the EXPLODE loop AT this tier, ESCALATE wraps back to 0 and the
 * `SPEED` score goes up by 1 — every horizontal missile then flies
 * `1 + missile_speed_per_speed_level * SPEED` times as fast.
 */
export const MAX_ESCALATION_TIER = 2;

export class Game {
  readonly puncher = new Puncher();
  missile: Missile | null = null;
  /** The anti-camp hazard (independent of the cruise-missile loop). */
  dropper: Dropper | null = null;
  readonly effects = new Effects();

  /** ms the Puncher's x has held near `campAnchorX` (drives the dropper). */
  campMs = 0;
  campAnchorX = CONFIG.puncher_start_x;
  /** While > 0 the camp timer is paused (a grace window after a move). */
  campGraceMs = 0;
  /**
   * The camp / dropper sequence is inert until the first missile of the
   * life/level has been punched away. Re-armed (→ false) by `reset()`.
   */
  campArmed = false;
  private dropWhining = false;
  private campWarning = false;

  /**
   * All gameplay randomness. Reseed (`game.rng.reseed(n)`) + `reset()` for a
   * reproducible run — see `src/harness/`.
   */
  readonly rng = new Rng();

  scene: Scene = "select";
  /** Which Puncher stands on the LEFT of the start screen. */
  leftGender: Gender = "m";
  /** The picked Puncher (start-screen cursor). Defaults to whoever is on the left. */
  gender: Gender = "m";

  // Per-run tally — reset by `newGame()`, an ending, or a page reload.
  punches = 0; // every punch thrown              -> HUD "PUNCH"
  deflects = 0; // missiles punched away          -> HUD "EXPLODE"
  hits = 0; // times the missile hit the Puncher  -> HUD "MISS"

  // Persistent "level" — bumped on each escalation (EXPLODE limit reached),
  // wraps 0..MAX_ESCALATION_TIER. Never reset except a page reload / TOO TIRED.
  escalate = 0;
  /**
   * Integer, starts at 0. Goes up by 1 each time ESCALATE wraps past its last
   * tier; each point makes horizontal missiles `+missile_speed_per_speed_level`
   * (0.5x) faster. Persistent like `escalate`.
   */
  speedLevel = 0;

  debug = false;

  /** Multiplier applied to every horizontal missile's speed for the SPEED score. */
  get missileSpeedMult(): number {
    return 1 + CONFIG.missile_speed_per_speed_level * this.speedLevel;
  }

  /** ms elapsed on the kill screen (drives the distortion + input lock). */
  killMs = 0;
  /** ms elapsed on the frozen BAD END screen. */
  endMs = 0;
  /** ms elapsed on the CONGRATS interstitial before play resumes. */
  escalationMs = 0;
  /** ms elapsed since the puncher went down under fire (non-final MISS). */
  downedMs = 0;
  /**
   * Latches a punch pressed at any point during "downed" (even before the
   * explosion animation finishes) so an early tap isn't silently dropped —
   * it fires the moment `downedMs` clears `explosion_ms`, same as a tap
   * timed exactly right would.
   */
  private downedPunchQueued = false;
  /** ms elapsed on the frozen TOO TIRED screen (PUNCH-limit stop). */
  tiredMs = 0;

  private spawnTimer = CONFIG.missile_spawn_delay;
  private prevMissileState: MissileState | null = null;

  constructor(
    private readonly input: Input,
    private readonly audio: Audio,
  ) {
    this.leftGender = this.rng.bool() ? "m" : "f";
    this.gender = this.leftGender;
  }

  /** Restart the attempt loop (the `R` key). The tally is left untouched. */
  reset(): void {
    this.puncher.reset();
    this.missile = null;
    this.clearDropper();
    this.campMs = 0;
    this.campGraceMs = 0;
    this.campArmed = false;
    this.campAnchorX = this.puncher.x;
    this.effects.clear();
    this.spawnTimer = CONFIG.missile_spawn_delay;
    this.prevMissileState = null;
    this.killMs = 0;
    this.endMs = 0;
    this.escalationMs = 0;
    this.downedMs = 0;
    this.downedPunchQueued = false;
    this.tiredMs = 0;
  }

  /** Drop the hazard reference and silence both dropper sounds. */
  private clearDropper(): void {
    this.dropper = null;
    if (this.dropWhining) {
      this.audio.dropWhineStop();
      this.dropWhining = false;
    }
    if (this.campWarning) {
      this.audio.campWarnStop();
      this.campWarning = false;
    }
  }

  /** 0 below `camp_warn_fraction`, ramps to 1 at the trigger point. */
  campWarnLevel(): number {
    const f = this.campMs / CONFIG.camp_time_ms;
    const w = CONFIG.camp_warn_fraction;
    return f <= w ? 0 : Math.min(1, (f - w) / (1 - w));
  }

  spawnCountdownMs(): number {
    return this.spawnTimer;
  }

  /** One fixed simulation step. */
  update(dtMs: number): void {
    if (this.input.pressed("debug")) this.debug = !this.debug;

    if (this.scene === "select") {
      this.updateSelect();
      return;
    }

    if (this.scene === "kill") {
      this.killMs += dtMs;
      // no way out for the first few distortion cycles
      if (
        killRestartReady(this.killMs) &&
        (this.input.pressed("punch") || this.input.pressed("reset"))
      ) {
        this.newGame();
      }
      return;
    }

    if (this.scene === "end") {
      this.endMs += dtMs;
      if (
        this.endMs > CONFIG.end_prompt_delay &&
        (this.input.pressed("punch") || this.input.pressed("reset"))
      ) {
        this.newGame();
      }
      return;
    }

    // CONGRATS interstitial: holds a few seconds, then play resumes for the
    // next escalation. EXPLODE and PUNCH both reset to full; MISS / ESCALATE
    // / SPEED carry over.
    if (this.scene === "escalation") {
      this.escalationMs += dtMs;
      if (this.escalationMs >= CONFIG.escalation_screen_ms) {
        this.reset(); // also disarms the camp sequence for the new level
        this.deflects = 0;
        this.punches = 0;
        this.scene = "play";
      }
      return;
    }

    // MISS aftermath: the fallen puncher keeps getting shelled until the
    // player punches out. Then -> BAD END if that MISS ended the run, else
    // back to the selector.
    if (this.scene === "downed") {
      this.updateDowned(dtMs);
      return;
    }

    // TOO TIRED: PUNCH limit stopped the run. No escape this time — the
    // puncher is immobilized (no move, no punch). "TOO TIRED" blinks for
    // tired_warn_ms, then a laser locks on over tired_laser_ms, then a
    // Dropper falls on the puncher's now-fixed x. It always connects — the
    // puncher can't dodge — and that hit runs the normal registerBodyHit()
    // path: MISS +1, downed / BAD END as usual. EXPLODE is untouched (no
    // more "back to the start of the level"); PUNCH resets once the hit
    // lands so the next attempt isn't stuck re-triggering this immediately.
    if (this.scene === "tired") {
      this.tiredMs += dtMs;

      if (!this.dropper) {
        if (this.tiredMs >= CONFIG.tired_warn_ms + CONFIG.tired_laser_ms) {
          this.dropper = new Dropper(this.puncher.x + CONFIG.puncher_width / 2);
        }
        return;
      }

      this.dropper.update(dtMs);
      this.syncDropAudio();
      if (this.dropper.state === "falling") this.resolveDropper();
      if (this.scene === "tired") return; // still falling, hasn't connected yet
      this.punches = 0; // life spent; fresh stamina for the next attempt
      return;
    }

    if (this.input.pressed("reset")) {
      this.reset();
      return;
    }

    // Hit-stop freezes the simulation but not the effect timers.
    if (this.effects.hitStopActive) {
      this.effects.update(dtMs);
      return;
    }

    this.puncher.update(dtMs, this.input);
    if (this.puncher.punchStarted) this.punches++;
    this.updateCamp(dtMs); // may spawn `this.dropper`
    this.missile?.update(dtMs);
    this.dropper?.update(dtMs);
    this.syncDropAudio();
    this.syncCampAudio();

    this.resolveCollisions();
    if (this.scene === "play") this.resolveDropper();
    // A body hit (cruise or dropper) switches scene here: "downed" (non-final
    // MISS) or "end" (final MISS -> BAD END). Nothing else to do this frame.
    if (this.scene !== "play") return;
    if (this.dropper?.state === "gone") this.clearDropper();
    this.detectAirburst();

    // Enough deflections -> escalate a level (CONGRATS interstitial, then play).
    if (this.deflects >= CONFIG.limit_explode) {
      if (this.escalate >= MAX_ESCALATION_TIER) {
        // past the last authored tier: wrap ESCALATE, bump SPEED (faster
        // horizontal missiles from here on)
        this.escalate = 0;
        this.speedLevel++;
      } else {
        this.escalate++;
      }
      this.escalationMs = 0;
      // clean frozen frame behind the interstitial
      this.effects.clear();
      this.missile = null;
      this.clearDropper();
      this.campMs = 0;
      this.prevMissileState = null;
      this.scene = "escalation";
      return;
    }
    // One past the punch limit -> TOO TIRED: an inevitable forced hit, not
    // a game over (see the "tired" branch above). (The kill-screen mechanic
    // still exists in code but nothing routes to it now.)
    if (this.punches > CONFIG.limit_punch) {
      this.effects.clear();
      this.clearDropper();
      this.puncher.state = "idle"; // a clean stance for the immobilized wait
      this.tiredMs = 0;
      this.scene = "tired";
      return;
    }

    this.advanceAttemptLoop(dtMs);

    this.prevMissileState = this.missile?.state ?? null;
    this.effects.update(dtMs);
  }

  /** Which counter tripped the kill screen (always PUNCH now), and its value. */
  killedBy(): { label: string; value: number } {
    return { label: LABELS.hud.punch, value: this.punches };
  }

  /** Start screen: pick the Puncher (by side), then punch to begin. */
  private updateSelect(): void {
    if (this.input.pressed("left")) this.gender = this.leftGender;
    if (this.input.pressed("right")) this.gender = other(this.leftGender);
    if (this.input.pressed("punch")) this.startFromSelect();
  }

  /** Leave the select screen for a fresh attempt with `this.gender`. */
  startFromSelect(): void {
    if (this.scene !== "select") return;
    this.reset();
    this.scene = "play";
  }

  /** After a death: back to the selector, GUY/GAL swap sides, cursor on the left. */
  private returnToSelect(): void {
    this.reset();
    this.leftGender = other(this.leftGender);
    this.gender = this.leftGender;
    this.scene = "select";
  }

  /** Wipe the tally and start fresh (only from the kill screen). */
  private newGame(): void {
    this.punches = 0;
    this.deflects = 0;
    this.hits = 0;
    this.reset();
    this.leftGender = this.rng.bool() ? "m" : "f";
    this.gender = this.leftGender;
    this.scene = "select";
  }

  /** The reflected missile's fuse ran out and it detonated in mid-air. */
  private detectAirburst(): void {
    const m = this.missile;
    if (!m) return;
    if (this.prevMissileState === "punched" && m.state === "exploding") {
      this.effects.triggerSuccess();
      this.audio.explosion();
      this.deflects++;
      if (!this.campArmed) {
        // first missile punched away this level → arm the anti-camp sequence,
        // with the usual post-event grace before the timer actually counts
        this.campArmed = true;
        this.campGraceMs = Math.max(this.campGraceMs, CONFIG.camp_move_grace_ms);
      }
    }
  }

  private resolveCollisions(): void {
    const m = this.missile;
    if (!m) return;

    if (m.state !== "incoming") return;

    const hb = this.puncher.punchHitbox();
    if (hb && overlap(hb, m.collider())) {
      m.reflect();
      this.effects.triggerHit();
      this.audio.punchConnect();
      this.audio.reflect();
      // A landed punch invigorates the Puncher — refund the PUNCH it cost,
      // so only whiffed punches actually drain toward TOO TIRED.
      this.punches--;
      return;
    }
    if (overlap(m.collider(), this.puncher.bodyCollider())) {
      m.detonate(false);
      this.registerBodyHit();
    }
  }

  /**
   * Anti-camp timer. Inert until `campArmed` (first missile punched away this
   * level). Then, only genuine planting is punished:
   *  - any move past `camp_move_tolerance` re-anchors, zeroes `campMs`, and
   *    starts a `camp_move_grace_ms` (3 s) pause;
   *  - `campMs` only accrues once no grace is left and the Puncher is holding
   *    one x (mid-punch counts);
   *  - at `camp_time_ms` a `Dropper` locks onto the Puncher's centre and
   *    `campMs` resets; while a dropper is live the timer holds at 0.
   */
  private updateCamp(dtMs: number): void {
    if (!this.campArmed) {
      this.campMs = 0;
      this.campAnchorX = this.puncher.x; // so it arms wherever you are
      return;
    }
    if (Math.abs(this.puncher.x - this.campAnchorX) > CONFIG.camp_move_tolerance) {
      this.campAnchorX = this.puncher.x;
      this.campMs = 0;
      this.campGraceMs = Math.max(this.campGraceMs, CONFIG.camp_move_grace_ms);
      return;
    }
    if (this.campGraceMs > 0) {
      this.campGraceMs -= dtMs;
      this.campMs = 0;
      return;
    }
    if (this.dropper) {
      this.campMs = 0;
      return;
    }
    this.campMs += dtMs;
    if (this.campMs >= CONFIG.camp_time_ms) {
      this.dropper = new Dropper(this.puncher.x + CONFIG.puncher_width / 2);
      this.campMs = 0;
    }
  }

  /** A falling dropper reaching the Puncher's body — a MISS, like a cruise hit. */
  private resolveDropper(): void {
    const d = this.dropper;
    if (!d || d.state !== "falling") return;
    if (overlap(d.collider(), this.puncher.bodyCollider())) {
      d.detonate();
      this.registerBodyHit();
    }
  }

  /** Shared body-hit outcome: corpse, effect, MISS tally, downed / bad end. */
  private registerBodyHit(): void {
    this.puncher.state = "hitdead";
    this.effects.triggerExplosion();
    this.audio.explosion();
    this.hits++;
    this.clearDropper();
    if (this.hits >= CONFIG.limit_miss) {
      // Final miss -> straight to BAD END, no barrage.
      this.effects.clear();
      this.endMs = 0;
      this.scene = "end";
    } else {
      // Otherwise the MISS aftermath: barrage-on-the-corpse until punch-out.
      this.downedMs = 0;
      this.downedPunchQueued = false;
      this.scene = "downed";
    }
  }

  /** Keep the descent whine matched to whether a dropper is falling. */
  private syncDropAudio(): void {
    const falling = this.dropper?.state === "falling";
    if (falling && !this.dropWhining) {
      this.audio.dropWhineStart();
      this.dropWhining = true;
    } else if (!falling && this.dropWhining) {
      this.audio.dropWhineStop();
      this.dropWhining = false;
    }
  }

  /** The warble tone joins the visual warning only in its final stretch. */
  private syncCampAudio(): void {
    const warning =
      !this.dropper &&
      this.campMs >= CONFIG.camp_time_ms - CONFIG.camp_warn_sound_lead_ms;
    if (warning && !this.campWarning) {
      this.audio.campWarnStart();
      this.campWarning = true;
    } else if (!warning && this.campWarning) {
      this.audio.campWarnStop();
      this.campWarning = false;
    }
  }

  /**
   * MISS aftermath (non-final miss). The puncher is down; missiles keep raining
   * in and bursting on the corpse until the player punches back to the selector.
   */
  private updateDowned(dtMs: number): void {
    this.downedMs += dtMs;
    if (this.input.pressed("punch")) this.downedPunchQueued = true;

    if (this.downedMs > CONFIG.explosion_ms && this.downedPunchQueued) {
      this.returnToSelect();
      return;
    }

    if (this.effects.hitStopActive) {
      this.effects.update(dtMs);
      return;
    }

    this.missile?.update(dtMs);
    this.resolveBarrage();
    this.advanceAttemptLoop(dtMs, CONFIG.downed_barrage_delay);
    this.prevMissileState = this.missile?.state ?? null;
    this.effects.update(dtMs);
  }

  /** A barrage missile reaches the fallen puncher -> it just detonates. */
  private resolveBarrage(): void {
    const m = this.missile;
    if (!m || m.state !== "incoming") return;
    if (overlap(m.collider(), this.puncher.bodyCollider())) {
      m.detonate(false);
      this.effects.triggerExplosion();
      this.audio.explosion();
    }
  }

  private advanceAttemptLoop(
    dtMs: number,
    spawnDelay = CONFIG.missile_spawn_delay,
  ): void {
    if (this.missile?.state === "gone") {
      this.missile = null;
      this.spawnTimer = spawnDelay;
    }

    if (!this.missile) {
      this.spawnTimer -= dtMs;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 0;
        this.missile = this.rollMissile();
      }
    }
  }

  /** Spawn behaviour by ESCALATE level (only one missile is ever on screen). */
  private rollMissile(): Missile {
    const tier = Math.min(this.escalate, MAX_ESCALATION_TIER);

    // ESCALATE 1: enters from a random side.
    const fromRight = tier === 1 ? this.rng.bool() : true;

    // ESCALATE 2+: single side again, but a random slow or fast variant.
    const base =
      tier >= 2
        ? this.rng.bool()
          ? CONFIG.missile_speed_slow
          : CONFIG.missile_speed_fast
        : CONFIG.missile_speed;

    // SPEED score scales every horizontal missile.
    return new Missile(fromRight, base * this.missileSpeedMult);
  }
}
