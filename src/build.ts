/**
 * The switch that separates build flavours.
 *
 * This is a BUILD setting, not a tuning value: flip `mode` in this file and
 * reload the page. It is deliberately NOT hot-reloaded (editing this file
 * triggers a full reload). There is no CLI flag — it's a source constant.
 *
 *  - "dev"   — the default. Paints the red `DEV` badge (lower-left, every
 *              screen) AND exposes `window.__game` / `__renderer` / `__harness`
 *              / `__CONFIG` / `__applyConfigPatch` on the Vite dev server (the
 *              tuner / harness pages need these). This is what you run day to
 *              day.
 *  - "prod"  — clean reference build. No badge, no `window.__*` globals.
 *              Set this before `npm run build` to ship.
 *  - "debug" — PLANNED, not wired: badge only, no globals. Same as `prod` + a
 *              `DEBUG` watermark, for now.
 *
 * The `` ` `` collider overlay (`game.debug` / `drawDebug`) is key-toggled and
 * works in ANY mode — it is not gated here.
 *
 * Note: `import.meta.env.DEV` (Vite's flag — true only on the dev server) also
 * gates the globals in `main.ts`, so a production `vite build` never exposes
 * them even if `mode` is left at "dev". The badge, though, is `mode`-only.
 *
 * HARD RULE: every mode plays IDENTICALLY. `mode` may only gate
 * developer-facing signposts — never a mechanic, a tuning number, the scene
 * flow, or on-screen content the player is meant to read.
 */

export type BuildMode = "dev" | "prod" | "debug";

export const BUILD = {
  mode: "dev" as BuildMode,
};

/**
 * Whether to paint the build-flavour badge — steady red mode name in the
 * lower-left. Shown while running `vite dev` (unless `mode` is `"prod"`); a
 * `vite build` never shows it, so a demo / deliverable is clean without having
 * to remember to flip `mode`. (`import.meta.env.DEV` is Vite's dev-server flag.)
 */
export const showBuildBadge = (): boolean =>
  import.meta.env.DEV && BUILD.mode !== "prod";
