import { describe, expect, test } from "vitest";
import { CONFIG } from "../src/config";
import { MAX_ESCALATION_TIER } from "../src/game/game";
import { makeSim } from "../src/harness/sim";

/**
 * Starter playthrough tests — proof the headless harness works. Flesh this out
 * later: assert bot survival per ESCALATE tier, tune the limit economy, etc.
 */

describe("headless sim", () => {
  test("determinism: same seed → identical run", () => {
    const trace = (seed: number): string => {
      const sim = makeSim({ seed, escalate: 2, scene: "play" });
      sim.bot("perfect");
      sim.runFor(20_000);
      const v = sim.view();
      return JSON.stringify([v.scene, v.scores, v.escalate]);
    };
    expect(trace(42)).toBe(trace(42));
  });

  test("a missile spawns and the loop advances", () => {
    const sim = makeSim({ seed: 1, scene: "play" });
    const ms = sim.runUntil((v) => v.missile !== null, 5_000);
    expect(ms).toBeLessThan(5_000);
    expect(sim.view().missile?.state).toBe("incoming");
  });
});

describe("bots vs ESCALATE tiers", () => {
  for (const tier of [0, 1, 2]) {
    test(`perfect bot survives a while at tier ${tier}`, () => {
      const sim = makeSim({ seed: 7, escalate: tier, scene: "play" });
      sim.bot("perfect", 3);
      sim.runUntil(
        (v) => v.scene !== "play" && v.scene !== "escalation",
        45_000,
      );
      const v = sim.view();
      // it should be racking up deflects, not dying immediately
      expect(v.scores.deflects + v.escalate * sim.view().limits.explode).toBeGreaterThan(0);
      expect(v.scores.hits).toBeLessThan(v.limits.miss);
    });
  }

  test("idle bot gets hit", () => {
    const sim = makeSim({ seed: 3, escalate: 0, scene: "play" });
    sim.bot("idle");
    sim.runUntil((v) => v.scores.hits > 0, 20_000);
    expect(sim.view().scores.hits).toBeGreaterThan(0);
  });

  test("a bot punches through the select screen every time it returns there, not just the first", () => {
    // idle never dodges or punches during play, so it dies again and again
    // — each death cycles play -> downed -> select -> play. select's punch
    // is a bare `true` every tick with no edge of its own (unlike downed /
    // end, which gate on a time threshold), so the harness's tap-debounce
    // used to get stuck sitting on `true` after the first successful tap,
    // leaving the bot frozen on select forever from its second visit on.
    const sim = makeSim({ seed: 1, scene: "play" });
    sim.bot("idle");
    sim.runUntil((v) => v.scores.hits >= 3, 40_000);
    expect(sim.view().scores.hits).toBeGreaterThanOrEqual(3);
  });
});

describe("SPEED score", () => {
  test("ESCALATE wrapping past the last tier bumps SPEED and speeds missiles", () => {
    const sim = makeSim({ seed: 5, escalate: MAX_ESCALATION_TIER, scene: "play" });
    expect(sim.view().speedLevel).toBe(0);

    // force the last deflect of this tier
    sim.game.deflects = CONFIG.limit_explode;
    sim.runUntil((v) => v.scene === "escalation", 3_000);
    sim.runUntil((v) => v.scene === "play", CONFIG.escalation_screen_ms + 2_000);

    expect(sim.view().speedLevel).toBe(1);
    expect(sim.view().escalate).toBe(0); // wrapped

    // the next horizontal missile is 1.5x the tier-0 base speed
    sim.runUntil((v) => v.missile !== null, 6_000);
    const speed = Math.abs(sim.view().missile!.vx);
    const expected = CONFIG.missile_speed * (1 + CONFIG.missile_speed_per_speed_level);
    expect(speed).toBeCloseTo(expected, 1);
  });

  test("SPEED persists through the escalation loop", () => {
    const sim = makeSim({ seed: 5, escalate: MAX_ESCALATION_TIER, speedLevel: 2, scene: "play" });
    sim.game.deflects = CONFIG.limit_explode;
    sim.runUntil((v) => v.scene === "play" && v.speedLevel === 3, CONFIG.escalation_screen_ms + 4_000);
    expect(sim.view().speedLevel).toBe(3);
  });
});

describe("BAD END new game", () => {
  test("resets ESCALATE to 0 but keeps SPEED", () => {
    const sim = makeSim({ seed: 5, escalate: 3, speedLevel: 2, scene: "end" });
    sim.game.endMs = CONFIG.end_prompt_delay + 1; // past the prompt delay, input now accepted
    sim.harness.input.tap("punch");
    sim.step();

    const v = sim.view();
    expect(v.scene).toBe("select");
    expect(v.escalate).toBe(0);
    expect(v.speedLevel).toBe(2);
  });
});
