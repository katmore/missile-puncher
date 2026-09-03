import { describe, expect, test } from "vitest";
import { CONFIG } from "../src/config";
import { makeSim } from "../src/harness/sim";

/**
 * A landed punch refunds the PUNCH it cost (Game.resolveCollisions) — only
 * whiffs actually drain toward TOO TIRED. limit_punch is tiny (4) precisely
 * because of this: without the refund, any sustained play would exhaust it
 * almost immediately.
 */
describe("PUNCH refund", () => {
  test("sustained accurate play cycles through escalations without ever exhausting PUNCH", () => {
    const sim = makeSim({ seed: 9, scene: "play" });
    sim.bot("perfect", 4);

    // Reaching ESCALATE 2 needs 2 * limit_explode (18) successful deflects —
    // far more punches than limit_punch (4) raw throws would allow without
    // the refund. deflects itself resets every escalation lap, so watch the
    // persistent ESCALATE counter instead.
    sim.runUntil((v) => v.escalate >= 2 || v.scene === "tired", 120_000);
    const v = sim.view();
    expect(v.scene).not.toBe("tired");
    expect(v.escalate).toBeGreaterThanOrEqual(2);
    expect(v.scores.punches).toBeLessThanOrEqual(CONFIG.limit_punch);
  });

  test("an idle puncher (no punches thrown) never drains PUNCH", () => {
    const sim = makeSim({ seed: 1, scene: "play" });
    expect(sim.view().scores.punches).toBe(0);
    sim.runFor(3000);
    expect(sim.view().scores.punches).toBe(0);
  });

  test("escalation resets PUNCH to its full value, not just EXPLODE", () => {
    const sim = makeSim({ seed: 3, scene: "play" });
    sim.game.punches = 2; // some whiffs already spent this level
    sim.game.deflects = CONFIG.limit_explode; // trigger escalation next tick

    sim.runUntil((v) => v.scene === "escalation", 2_000);
    sim.runUntil((v) => v.scene === "play", CONFIG.escalation_screen_ms + 2_000);

    expect(sim.view().scores.punches).toBe(0); // -> displays as the full 5
  });
});
