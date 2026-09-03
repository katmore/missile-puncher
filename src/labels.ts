/**
 * All on-screen wording in one place. Edit freely — this hot-reloads like
 * `config.ts` (no page reload, current attempt is kept).
 *
 * Rules:
 *  - The bitmap font is UPPERCASE + digits + `: . ! - _ = # / ← →` only.
 *    `drawText` upper-cases input, so casing here is just for readability.
 *  - Keep it terse (saved preference: brevity in UI copy).
 *  - Other modules read `LABELS.x` live every frame — never destructure or
 *    cache at module load.
 */

export const LABELS = {
  /**
   * Running scoreboard along the top during play: a fist icon + N, a head
   * icon + N, an EXPL missile icon + N, then a plain "S-E" level readout
   * (SPEED+1 - ESCALATE+1, no label) right-justified at the far edge (see
   * hud.ts drawHud). `punch` / `miss` / `explode` no longer appear as text
   * there — they're read here only for the kill-screen counters (ROT13'd
   * there), which still label everything by these strings.
   */
  hud: {
    punch: "PNCH", //     counts DOWN from limit_punch+1 to 0, so it's 1 on the
    //                    last allowed punch, not 0 a punch early (see hud.ts
    //                    pnchRemaining) (kill-screen limit)
    explode: "EXPL", // counts DOWN from limit_explode to 0 (escalate limit)
    miss: "DED", //        counts DOWN from limit_miss to 0 (bad-end limit)
    sep: "  ", //          gap between the badge entries
  },

  /** Start screen. */
  start: {
    title: "MISSILE PUNCH",
    prompt: "CHOOSE PUNCHER",
    guy: "GUY",
    gal: "GAL",
    begin: "PUNCH!!!", //     blinks under the roster
  },

  /**
   * MISS aftermath — the blinking prompt over the shelled corpse. Edit freely
   * (it appears once the killing blow's `explosion_ms` animation finishes).
   * "!" renders; lowercase does not.
   */
  downed: "PUNCH!!!",

  /**
   * Bad ending — frozen frame. `title` is the headline; `prompt` is the
   * blinking bottom call-to-action that appears after `end_prompt_delay`.
   */
  end: {
    title: "BAD END",
    prompt: "PUNCH!",
  },

  /**
   * PUNCH-limit stop — the blinking centre-screen line while the puncher is
   * immobilized and the strike locks on (see hud.ts drawTiredStrike). Edit
   * freely (UPPERCASE + digits + `: . ! - _ = #`).
   */
  tired: {
    title: "TOO TIRED",
  },

  /** Escalation interstitial — steady line, then a blinking line. */
  escalation: {
    congrats: "CONGRATS",
    prepare: "PREPARE FOR ESCALATION",
  },
};

export type Labels = typeof LABELS;

// Self-accept (see the note in `config.ts`): hot-swap wording with no reload,
// merging one level of nested groups deep so `LABELS` stays the same reference.
if (import.meta.hot) {
  import.meta.hot.accept((next) => {
    if (!next) return;
    const incoming = (next as unknown as { LABELS: Record<string, unknown> }).LABELS;
    for (const [k, v] of Object.entries(incoming)) {
      const cur = (LABELS as Record<string, unknown>)[k];
      if (cur && typeof cur === "object" && typeof v === "object") {
        Object.assign(cur as object, v as object);
      } else {
        (LABELS as Record<string, unknown>)[k] = v;
      }
    }
  });
}
