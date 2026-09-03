/**
 * Which control to show for each value in `src/config.ts`, and its range.
 *
 * `path` is the key path into `CONFIG` (`["punch_startup"]`,
 * `["bg", "sky_top"]`). Anything numeric not listed here still gets a slider via
 * `autoRange()`. `bg.mountains`, `bg.shrubs` and `keys` are structural and get
 * bespoke editors in `main.ts`.
 */

export type Control =
  | { kind: "num"; min: number; max: number; step: number }
  | { kind: "bool" }
  | { kind: "color" };

export interface Field {
  path: string[];
  label: string;
  control: Control;
}

export interface Group {
  title: string;
  fields: Field[];
}

const n = (min: number, max: number, step: number): Control => ({
  kind: "num",
  min,
  max,
  step,
});
const ms = (max = 800): Control => n(0, max, 10);
const px = (max = 64): Control => n(0, max, 1);
const gain = (): Control => n(0, 2, 0.05);
const unit = (): Control => n(0, 1, 0.02);
const bool: Control = { kind: "bool" };
const color: Control = { kind: "color" };

/** Numeric fallback when a key is not in a group below. */
export function autoRange(value: number): Control {
  if (value > 0 && value <= 1) return unit();
  const max = Math.max(10, Math.ceil((value * 3) / 5) * 5);
  return n(0, max, value < 5 ? 0.1 : 1);
}

export const GROUPS: Group[] = [
  {
    title: "Movement & punch",
    fields: [
      { path: ["player_speed"], label: "player speed", control: n(0, 400, 5) },
      { path: ["punch_startup"], label: "punch startup", control: ms(600) },
      { path: ["punch_active_time"], label: "punch active", control: ms(400) },
      { path: ["punch_recovery"], label: "punch recovery", control: ms(600) },
      { path: ["punch_reach"], label: "punch reach", control: px(64) },
      { path: ["rooted_during_punch"], label: "rooted during punch", control: bool },
    ],
  },
  {
    title: "Missile",
    fields: [
      { path: ["missile_speed"], label: "speed (tier 0-1)", control: n(0, 400, 5) },
      { path: ["missile_speed_slow"], label: "speed slow (2+)", control: n(0, 400, 5) },
      { path: ["missile_speed_fast"], label: "speed fast (2+)", control: n(0, 500, 5) },
      { path: ["missile_speed_per_speed_level"], label: "+ per SPEED pt", control: n(0, 2, 0.05) },
      { path: ["missile_height"], label: "flight height (y)", control: px(224) },
      { path: ["missile_spawn_delay"], label: "spawn delay", control: n(0, 3000, 25) },
      { path: ["missile_reflect_speed_mult"], label: "reflect speed ×", control: n(0.5, 3, 0.05) },
      { path: ["punched_fuse"], label: "return fuse", control: ms(1500) },
      { path: ["missile_draw_on_top"], label: "draw over puncher", control: bool },
    ],
  },
  {
    title: "Run limits & escalation",
    fields: [
      { path: ["limit_punch"], label: "PUNCH → too tired", control: n(0, 60, 1) },
      { path: ["limit_explode"], label: "EXPLODE → escalate", control: n(1, 20, 1) },
      { path: ["limit_miss"], label: "MISS → bad end", control: n(1, 10, 1) },
      { path: ["escalation_screen_ms"], label: "escalation screen", control: ms(8000) },
      { path: ["end_prompt_delay"], label: "bad-end prompt delay", control: ms(8000) },
      { path: ["tired_prompt_delay"], label: "tired prompt delay", control: ms(8000) },
    ],
  },
  {
    // Feedback is deliberately minimal — hit-stop + a plain explosion circle.
    // No shake / flash / shockwave knobs; do not re-add. See game/effects.ts.
    title: "Hit-stop & explosions",
    fields: [
      { path: ["hit_stop_duration"], label: "punch hit-stop", control: ms(300) },
      { path: ["hit_stop_on_reset"], label: "hit-stop on reset", control: bool },
      { path: ["explosion_hit_stop"], label: "failure hit-stop", control: ms(300) },
      { path: ["success_hit_stop"], label: "airburst hit-stop", control: ms(300) },
      { path: ["explosion_ms"], label: "failure explosion ms", control: ms(800) },
      { path: ["explosion_radius"], label: "failure radius", control: px(80) },
      { path: ["success_explosion_ms"], label: "airburst ms", control: ms(1000) },
      { path: ["success_explosion_radius"], label: "airburst radius", control: px(80) },
    ],
  },
  {
    title: "Layout",
    fields: [
      { path: ["ground_y"], label: "ground y", control: px(224) },
      { path: ["puncher_start_x"], label: "puncher start x", control: px(320) },
      { path: ["puncher_width"], label: "puncher collider w", control: n(1, 48, 1) },
      { path: ["puncher_height"], label: "puncher collider h", control: n(1, 64, 1) },
      { path: ["missile_width"], label: "missile collider w", control: n(1, 64, 1) },
      { path: ["missile_height_px"], label: "missile collider h", control: n(1, 32, 1) },
    ],
  },
  {
    title: "Anti-camp dropper",
    fields: [
      { path: ["camp_time_ms"], label: "camp time", control: n(500, 8000, 50) },
      { path: ["camp_move_grace_ms"], label: "grace after move", control: n(0, 10000, 100) },
      { path: ["camp_move_tolerance"], label: "move tolerance", control: px(48) },
      { path: ["camp_warn_fraction"], label: "warn at (frac)", control: unit() },
      { path: ["camp_warn_stages"], label: "laser stages", control: n(1, 20, 1) },
      { path: ["camp_warn_sound_lead_ms"], label: "warble lead ms", control: n(0, 2600, 25) },
      { path: ["drop_speed"], label: "drop init speed", control: n(0, 400, 5) },
      { path: ["drop_accel"], label: "drop gravity", control: n(0, 1400, 20) },
      { path: ["drop_spawn_y"], label: "spawn y", control: n(-96, 40, 2) },
      { path: ["drop_collider_w"], label: "collider w", control: n(2, 48, 1) },
      { path: ["drop_collider_h"], label: "collider h", control: n(2, 48, 1) },
    ],
  },
  {
    title: "Audio",
    fields: [
      { path: ["sfx_master_gain"], label: "master gain", control: unit() },
      { path: ["sfx_punch_gain"], label: "punch gain", control: gain() },
      { path: ["sfx_explosion_gain"], label: "explosion gain", control: gain() },
      { path: ["sfx_reflect_gain"], label: "reflect gain", control: gain() },
      { path: ["sfx_drop_enabled"], label: "dropper whine", control: bool },
      { path: ["sfx_drop_gain"], label: "whine gain", control: gain() },
      { path: ["sfx_camp_warn_enabled"], label: "camp warble", control: bool },
      { path: ["sfx_camp_warn_gain"], label: "warble gain", control: gain() },
    ],
  },
  {
    title: "Background",
    fields: [
      { path: ["bg", "sky_top"], label: "sky top", control: color },
      { path: ["bg", "sky_bottom"], label: "sky bottom", control: color },
      { path: ["bg", "ground"], label: "ground", control: color },
      { path: ["bg", "ground_edge"], label: "ground edge", control: color },
      { path: ["bg", "ground_edge_h"], label: "ground edge h", control: px(20) },
      { path: ["bg", "pebble"], label: "pebble", control: color },
      { path: ["bg", "pebble_spacing"], label: "pebble spacing", control: n(4, 120, 1) },
    ],
  },
];
