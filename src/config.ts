/**
 * Every tuning value for the prototype lives here.
 *
 * Rules:
 *  - Times are milliseconds, speeds are pixels/second, distances are pixels.
 *  - Other modules read `CONFIG.x` live every frame — never destructure or cache
 *    values at module load — so editing this file hot-swaps without a reload.
 */

export const SCREEN_W = 320;
export const SCREEN_H = 224;

/** Which Puncher body the player picked on the start screen. */
export type Gender = "m" | "f";

export const CONFIG = {
  // --- Exposed tuning values (from PROTOTYPE-HANDOFF.md) ---
  player_speed: 90, // px/s, snapped instantly (no inertia)
  punch_startup: 100, // ms before the hitbox turns on
  punch_active_time: 80, // ms the hitbox is live
  punch_recovery: 180, // ms locked after the active window
  punch_reach: 16, // px the hitbox extends in front of the body
  missile_speed: 100, // px/s incoming (ESCALATE 0-1)
  missile_speed_slow: 65, // px/s — the slow variant at ESCALATE 2+
  missile_speed_fast: 150, // px/s — the fast variant at ESCALATE 2+
  missile_speed_per_speed_level: 0.5, // each SPEED score point multiplies the
  //   horizontal missile speed by an extra +0.5x (SPEED goes up each time
  //   ESCALATE wraps past its last authored tier). SPEED N -> x(1 + 0.5*N).
  missile_height: 150, // y of the missile's vertical centre (upper-torso band)
  missile_spawn_delay: 900, // ms between a cleared screen and the next missile

  // --- MISS aftermath (non-final miss): the fallen puncher keeps getting
  //     shelled; the "PUNCH" prompt appears (and accepts input) as soon as the
  //     killing blow's own explosion animation finishes (`explosion_ms`
  //     below) — no extra wait past that. Final miss skips this and goes
  //     straight to BAD END. ---
  downed_barrage_delay: 550, // ms between missiles raining on the corpse

  // --- Run-ending score limits (placeholder values, tune freely) ---
  limit_punch: 19, // PUNCH past this many -> TOO TIRED (run stops)
  limit_explode: 9, // EXPLODE (deflect) this many -> escalate a level
  limit_miss: 9, // get hit this many times -> bad ending
  escalation_screen_ms: 3000, // how long the CONGRATS interstitial holds
  end_prompt_delay: 3000, // ms before the BAD END "PUNCH" prompt shows / works

  // --- TOO TIRED: an inevitable punishment, not an escape hatch. The
  //     puncher is immobilized; "TOO TIRED" blinks for tired_warn_ms, then a
  //     laser locks on over tired_laser_ms, then a Dropper falls on the
  //     puncher's fixed x and always connects (see Game.update's "tired"
  //     branch + hud.ts drawTiredStrike). ---
  tired_warn_ms: 2200, // ms "TOO TIRED" blinks before the laser starts
  tired_laser_ms: 1200, // ms the laser takes to lock on before the drop

  // --- Feedback. Deliberately minimal: a brief hit-stop + a plain expanding
  //     explosion circle. NO shake / flash / shockwave / particles — they were
  //     removed on purpose, do not re-add. See src/game/effects.ts + MECHANICS §11.
  missile_reflect_speed_mult: 1.1, // speed multiplier applied on reflection
  hit_stop_duration: 70, // ms sim freeze on a punch connect
  hit_stop_on_reset: true, // whether a punch connect freezes at all
  explosion_hit_stop: 40, // ms freeze on failure
  success_hit_stop: 80, // ms freeze on the airburst

  // The reflected missile streaks back the way it came, then airbursts.
  punched_fuse: 360, // ms of return flight before it detonates
  explosion_ms: 240, // failure explosion-circle length
  explosion_radius: 18, // px failure explosion-circle radius
  success_explosion_ms: 360, // airburst explosion-circle length
  success_explosion_radius: 26, // px airburst explosion-circle radius

  // --- Layout ---
  ground_y: 184, // y of the ground surface (feet rest here)
  puncher_start_x: 90, // x the Puncher spawns / resets to (body left edge)
  puncher_width: 16, // body collider width
  puncher_height: 36, // body collider height (~32-40 px visual target)
  missile_width: 22,
  missile_height_px: 8, // collider height of the missile body

  // --- Anti-camp dropper: a vertical, UNPUNCHABLE hazard. Hold one x for
  //     `camp_time_ms` and a missile drops on that spot; a body hit is a MISS
  //     (→ downed / bad end, same as a cruise hit). Time spent mid-punch
  //     counts as standing still. Always on, ESCALATE 0+. Dodge = a small
  //     sidestep; moving also resets the camp timer. ---
  // The whole camp / dropper sequence stays DORMANT until the Puncher has
  // punched away one horizontal missile this life/level (re-arms each ESCALATE).
  camp_time_ms: 2600, // ms holding one x before a dropper triggers
  camp_move_grace_ms: 3000, // after any move (> tolerance) the camp timer stays
  //   paused this long before it starts accruing again
  camp_move_tolerance: 10, // px of drift that still counts as the "same spot"
  camp_warn_fraction: 0.25, // fraction of camp_time_ms the VISUAL warning starts
  //   at (~2 s of heads-up): an emitter at the top + a laser that descends the
  //   target column in `camp_warn_stages` steps toward the ground.
  camp_warn_stages: 6, // discrete steps the warning laser extends in
  camp_warn_sound_lead_ms: 450, // ms before the drop the warble tone kicks in
  //   (later than the visual — "it's really coming now")
  drop_speed: 90, // px/s — the INITIAL downward speed (then accelerates)
  drop_accel: 420, // px/s^2 — gravity; starts gentle, speeds up as it falls
  drop_spawn_y: -24, // y the dropper appears at (above the screen)
  drop_collider_w: 10, // falling hazard box width (tight — a sidestep clears it)
  drop_collider_h: 16, // falling hazard box height

  // --- Feel switches (flip freely) ---
  rooted_during_punch: true, // no movement / no facing change for the whole punch
  missile_draw_on_top: true, // render the missile above the Puncher

  // --- Background (procedural — drawn in render/background.ts). All live-
  //     tunable; a config edit hot-swaps and rebuilds the cached sky gradient.
  bg: {
    sky_top: "#8fb8d8", // sky gradient, horizon-up
    sky_bottom: "#e7d9bf",
    // Back-to-front mountain layers. `base` = px above ground_y the ridge line
    // sits; `height` = peak height; `period` = px between peaks; `phase` = px
    // horizontal shift so layers do not line up.
    mountains: [
      { color: "#9a8fa6", base: 8, height: 34, period: 46, phase: 0 },
      { color: "#7d7288", base: 4, height: 22, period: 60, phase: 30 },
    ] as Array<{
      color: string;
      base: number;
      height: number;
      period: number;
      phase: number;
    }>,
    ground: "#caa878", // ground fill below ground_y
    ground_edge: "#b9955f", // thin lip along the ground_y line
    ground_edge_h: 3,
    pebble: "#a9823f", // scattered ground speckle
    pebble_spacing: 37, // px between speckle clusters
    // Fixed prop positions: [x, shrub-sheet frame (0 sagebrush / 1 rock)].
    shrubs: [
      [28, 0],
      [70, 1],
      [140, 0],
      [205, 1],
      [262, 0],
      [296, 1],
    ] as Array<[number, 0 | 1]>,
  },

  // --- Audio (WebAudio synth) ---
  sfx_master_gain: 0.35,
  sfx_punch_gain: 0.9,
  sfx_explosion_gain: 1.0,
  sfx_reflect_gain: 0.5,
  sfx_drop_enabled: true, // the falling-dropper descent whine (toggle)
  sfx_drop_gain: 0.32,
  sfx_camp_warn_enabled: true, // the pre-drop "incoming" warble (toggle)
  sfx_camp_warn_gain: 0.14,

  // --- Input map. Entries match either KeyboardEvent.code or a lowercased
  //     KeyboardEvent.key, so both physical-layout and logical keys work. ---
  keys: {
    left: ["ArrowLeft", "KeyA", "arrowleft", "a"] as string[],
    right: ["ArrowRight", "KeyD", "arrowright", "d"] as string[],
    punch: ["KeyZ", "Space", "KeyJ", "z", "j", " ", "spacebar"] as string[],
    debug: ["Backquote", "`"] as string[],
    reset: ["KeyR", "r"] as string[],
  },
};

export type Config = typeof CONFIG;

// Self-accept so a live edit hot-swaps with NO page reload. `CONFIG` is mutated
// in place, so every module holding the reference (they all read `CONFIG.x`
// live) picks the change up on the next frame. Self-accepting also makes this
// file its own HMR boundary — without it, importers that do not accept (input,
// the renderers) would force a full reload. `render/background.ts` rebuilds its
// cached sky gradient on its own when a colour changes.
if (import.meta.hot) {
  import.meta.hot.accept((next) => {
    if (next) Object.assign(CONFIG, (next as unknown as { CONFIG: Config }).CONFIG);
  });
}
