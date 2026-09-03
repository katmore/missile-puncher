import { CONFIG, SCREEN_W } from "../config";
import { Rng } from "../engine/rng";
import type { View } from "./view";

/** What a bot wants to do this tick. The runner debounces `punch` / `reset`. */
export interface BotAction {
  move: -1 | 0 | 1;
  punch: boolean;
  reset: boolean;
}

export interface Bot {
  readonly kind: BotKind;
  decide(view: View, dtMs: number): BotAction;
  reset(): void;
}

export type BotKind = "perfect" | "reflex" | "sloppy" | "idle";
export const BOT_KINDS: BotKind[] = ["perfect", "reflex", "sloppy", "idle"];

const NONE: BotAction = { move: 0, punch: false, reset: false };

interface Profile {
  /** ms the bot ignores a fresh missile before it starts tracking. */
  reactionMs: number;
  /** ± px of slop added to the punch trigger distance, rolled per missile. */
  timingJitterPx: number;
  /** chance per missile the bot fumbles it entirely (no punch). */
  whiffChance: number;
}

const PROFILES: Record<Exclude<BotKind, "idle">, Profile> = {
  perfect: { reactionMs: 0, timingJitterPx: 0, whiffChance: 0 },
  // "delayed": competent, just slow to react — no fumbles.
  reflex: { reactionMs: 150, timingJitterPx: 3, whiffChance: 0 },
  // "sloppy": slow AND mistimes, and now and then fumbles a missile entirely.
  sloppy: { reactionMs: 280, timingJitterPx: 7, whiffChance: 0.07 },
};

/**
 * Rule-based players — no ML, just reach / timing arithmetic against the
 * `View`. Deterministic given the seed + the sequence of views they see, so a
 * bot playthrough replays identically. `reflex` / `sloppy` layer a reaction
 * delay, timing jitter and a whiff chance on the same core logic.
 */
export function makeBot(kind: BotKind, seed = 1): Bot {
  if (kind === "idle") {
    return {
      kind,
      decide: (v) =>
        v.scene === "select" ||
        v.scene === "downed" ||
        v.scene === "tired" ||
        v.scene === "end"
          ? { move: 0, punch: true, reset: false }
          : NONE,
      reset: () => {},
    };
  }

  const prof = PROFILES[kind];
  const rng = new Rng(seed);

  // per-missile state
  let tracking = false;
  let awareMs = 0;
  let biasPx = 0;
  let whiffing = false;

  const startMissile = (): void => {
    tracking = true;
    awareMs = 0;
    biasPx = rng.range(-prof.timingJitterPx, prof.timingJitterPx);
    whiffing = rng.bool(prof.whiffChance);
  };

  return {
    kind,
    reset() {
      tracking = false;
      awareMs = 0;
      biasPx = 0;
      whiffing = false;
    },
    decide(v, dtMs) {
      // scene bookkeeping ------------------------------------------------
      if (v.scene === "select") return { move: 0, punch: true, reset: false };
      if (v.scene === "escalation") return NONE;
      if (v.scene === "downed") {
        return { move: 0, punch: v.timers.downed > CONFIG.explosion_ms, reset: false };
      }
      if (v.scene === "tired") {
        return { move: 0, punch: v.timers.tired > CONFIG.tired_prompt_delay, reset: false };
      }
      if (v.scene === "end") {
        return { move: 0, punch: v.timers.end > CONFIG.end_prompt_delay, reset: false };
      }
      if (v.scene !== "play") return NONE;

      // Minimal anti-camp dodge: a falling dropper (always) or a camp warning
      // in its final stretch (~0.5 s before the drop) outranks everything —
      // eating one is a MISS. Stepping aside also resets the camp timer. Real
      // navigation (closing on distant cruise missiles, baiting) is deferred.
      const threatX =
        v.dropper?.state === "falling"
          ? v.dropper.x
          : v.camp.warnLevel > 0.6
            ? v.camp.threatX
            : null;
      if (threatX !== null) {
        let away: -1 | 1 = v.puncher.cx < threatX ? -1 : 1;
        const nearEdge =
          (away === -1 && v.puncher.x <= 4) ||
          (away === 1 && v.puncher.x >= SCREEN_W - CONFIG.puncher_width - 4);
        if (nearEdge) away = (away === -1 ? 1 : -1) as -1 | 1;
        return { move: away, punch: false, reset: false };
      }

      const m = v.missile;
      if (!m || m.state !== "incoming") {
        tracking = false;
        // drift back toward the spawn x so timing is consistent
        const home = CONFIG.puncher_start_x;
        const dx = home - v.puncher.x;
        return {
          move: Math.abs(dx) < 1 ? 0 : dx > 0 ? 1 : -1,
          punch: false,
          reset: false,
        };
      }

      if (!tracking) startMissile();
      awareMs += dtMs;
      if (awareMs < prof.reactionMs) return NONE;

      // face the incoming missile (moving one tick flips `facing`)
      const desiredFacing = (m.dir === -1 ? 1 : -1) as -1 | 1;
      if (v.puncher.facing !== desiredFacing) {
        return { move: desiredFacing, punch: false, reset: false };
      }

      if (whiffing || !v.puncher.canAct) {
        return { move: 0, punch: false, reset: false };
      }

      // The x-band the missile CENTRE must be in for the hitbox to catch it.
      const half = CONFIG.missile_width / 2;
      const reach = CONFIG.punch_reach;
      let bandLo: number;
      let bandHi: number;
      if (desiredFacing === 1) {
        const hbL = v.puncher.x + CONFIG.puncher_width;
        bandLo = hbL - half;
        bandHi = hbL + reach + half;
      } else {
        const hbR = v.puncher.x;
        bandLo = hbR - reach - half;
        bandHi = hbR + half;
      }

      // Punch so the missile CENTRE sits near the band CENTRE at mid-active.
      // `biasPx` (per-missile, imperfect bots only) is the bot mis-reading the
      // missile position — positive = punches early.
      const midT =
        (CONFIG.punch_startup + CONFIG.punch_active_time / 2) / 1000;
      const projected = m.cx + m.vx * midT + biasPx * m.dir;
      const bandC = (bandLo + bandHi) / 2;
      const bandHalf = (bandHi - bandLo) / 2;
      const sweep = (Math.abs(m.vx) * CONFIG.punch_active_time) / 1000;
      const tol = Math.max(3, bandHalf - sweep / 2 - 3);

      const stillApproaching = m.dir === -1 ? m.cx > bandLo : m.cx < bandHi;
      const onTarget = Math.abs(projected - bandC) <= tol;

      return { move: 0, punch: onTarget && stillApproaching, reset: false };
    },
  };
}
