import { CONFIG, SCREEN_W } from "../config";
import type { Game, Scene } from "../game/game";
import type { PunchPhase, PuncherState } from "../game/puncher";
import type { MissileState } from "../game/missile";
import type { DropperState } from "../game/dropper";

/**
 * A compact, stable snapshot of the simulation — the single shape consumed by
 * the harness state panel, the bots, and playthrough-test assertions. Keep it
 * derived + serialisable; never hand out live engine objects.
 */
export interface MissileView {
  x: number;
  /** centre x (same as x — missiles are centre-anchored — but explicit). */
  cx: number;
  y: number;
  vx: number;
  /** travel direction: -1 flying left, +1 flying right. */
  dir: -1 | 1;
  state: MissileState;
  /** signed gap from the punch-reach front to the missile's near edge (px). */
  gap: number;
  /** rough ms until the missile centre reaches the Puncher centre. */
  timeToImpactMs: number;
}

export interface View {
  scene: Scene;
  escalate: number;
  /** SPEED score — horizontal missiles fly `1 + 0.5·speedLevel` times as fast. */
  speedLevel: number;
  seed: number;
  scores: { punches: number; deflects: number; hits: number };
  limits: { punch: number; explode: number; miss: number };
  puncher: {
    x: number;
    cx: number;
    facing: -1 | 1;
    state: PuncherState;
    phase: PunchPhase;
    /** free to move / start a punch this tick. */
    canAct: boolean;
    /** punch hitbox is live right now. */
    hitboxLive: boolean;
  };
  missile: MissileView | null;
  /** Anti-camp state — `warnLevel` > 0 means "move or eat a dropper". */
  camp: {
    ms: number;
    /** campMs / camp_time_ms, 0..1+. */
    fraction: number;
    /** the sequence is live — a missile has been punched away this level. */
    armed: boolean;
    /** ms left on the post-move grace window (timer frozen while > 0). */
    graceMs: number;
    /** 0 below camp_warn_fraction, ramps to 1 at the trigger (visual warning). */
    warnLevel: number;
    /** the warble tone is playing (starts `camp_warn_sound_lead_ms` before the drop). */
    soundOn: boolean;
    /** where a dropper would land (the camped x). */
    threatX: number;
  };
  dropper: {
    x: number;
    y: number;
    vy: number;
    state: DropperState;
    /** ms until it reaches the ground (Infinity once landed). */
    etaMs: number;
  } | null;
  /** ms until the next missile spawns (only counts while none is on screen). */
  spawnInMs: number;
  /** scene timers, ms (0 unless that scene is active). */
  timers: { downed: number; tired: number; end: number; escalation: number };
}

export function readView(game: Game): View {
  const p = game.puncher;
  const pcx = p.x + CONFIG.puncher_width / 2;

  let missile: MissileView | null = null;
  const m = game.missile;
  if (m && m.state !== "gone") {
    const dir: -1 | 1 = m.vx >= 0 ? 1 : -1;
    // front of the punch reach, in the direction the Puncher faces
    const frontX =
      p.facing === "right"
        ? p.x + CONFIG.puncher_width + CONFIG.punch_reach
        : p.x - CONFIG.punch_reach;
    // leading edge of the missile, in its travel direction
    const nearEdge = m.x + dir * (CONFIG.missile_width / 2);
    // px the missile must still travel for its edge to reach the reach front;
    // positive while approaching, negative once it has passed
    const gap = (nearEdge - frontX) * -dir;
    const secsToCentre = m.vx !== 0 ? (pcx - m.x) / m.vx : Infinity;
    missile = {
      x: m.x,
      cx: m.x,
      y: m.y,
      vx: m.vx,
      dir,
      state: m.state,
      gap,
      timeToImpactMs: secsToCentre > 0 ? secsToCentre * 1000 : Infinity,
    };
  }

  return {
    scene: game.scene,
    escalate: game.escalate,
    speedLevel: game.speedLevel,
    seed: game.rng.seed,
    scores: { punches: game.punches, deflects: game.deflects, hits: game.hits },
    limits: {
      punch: CONFIG.limit_punch,
      explode: CONFIG.limit_explode,
      miss: CONFIG.limit_miss,
    },
    puncher: {
      x: p.x,
      cx: pcx,
      facing: p.facing === "right" ? 1 : -1,
      state: p.state,
      phase: p.phase,
      canAct: p.state === "idle" || p.state === "walk",
      hitboxLive: p.punchHitbox() !== null,
    },
    missile,
    camp: {
      ms: game.campMs,
      fraction: game.campMs / CONFIG.camp_time_ms,
      armed: game.campArmed,
      graceMs: Math.max(0, game.campGraceMs),
      warnLevel: game.campWarnLevel(),
      soundOn:
        !game.dropper &&
        game.campMs >= CONFIG.camp_time_ms - CONFIG.camp_warn_sound_lead_ms,
      threatX: game.campAnchorX + CONFIG.puncher_width / 2,
    },
    dropper: game.dropper
      ? {
          x: game.dropper.x,
          y: game.dropper.y,
          vy: game.dropper.vy,
          state: game.dropper.state,
          etaMs: game.dropper.etaMs(),
        }
      : null,
    spawnInMs: game.missile ? 0 : game.spawnCountdownMs(),
    timers: {
      downed: game.downedMs,
      tired: game.tiredMs,
      end: game.endMs,
      escalation: game.escalationMs,
    },
  };
}

export { SCREEN_W };
