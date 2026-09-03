import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CONFIG } from "../src/config";
import { makeSim } from "../src/harness/sim";
import type { Sim } from "../src/harness/sim";

/**
 * Anti-camp dropper. Most of these suppress cruise missiles (huge spawn delay)
 * and force `campArmed` so they isolate the camp timer / dropper; "camping into
 * a cruise missile" and "the arming gate" are covered separately.
 */
let savedSpawnDelay: number;
beforeEach(() => {
  savedSpawnDelay = CONFIG.missile_spawn_delay;
  CONFIG.missile_spawn_delay = 9_999_999;
});
afterEach(() => {
  CONFIG.missile_spawn_delay = savedSpawnDelay;
});

/** A sim with cruise missiles off and the camp sequence already armed. */
function armedSim(seed = 1): Sim {
  const sim = makeSim({ seed, scene: "play" });
  sim.game.campArmed = true;
  return sim;
}

describe("arming gate", () => {
  test("the camp sequence is inert until a missile is punched away", () => {
    CONFIG.missile_spawn_delay = savedSpawnDelay; // let cruise missiles spawn
    const sim = makeSim({ seed: 7, scene: "play" });
    sim.bot("perfect");

    // before the first deflect: disarmed, no camp accrual, no dropper
    sim.runUntil((v) => v.scores.deflects > 0 || v.scene !== "play", 30_000);
    // (perfect bot doesn't camp anyway, but assert the gate held up to here)
    const beforeArm = sim.harness
      .api.events()
      .filter((e) => e.type === "camp" || e.type === "drop");
    const armAt = beforeArm.find((e) => e.detail === "armed")?.tMs ?? -1;
    const firstDeflect = sim.harness
      .api.events()
      .find((e) => e.type === "deflect")?.tMs ?? -1;
    expect(armAt).toBeGreaterThanOrEqual(firstDeflect);
    expect(sim.view().camp.armed).toBe(true);
  });

  test("a new escalation re-disarms it", () => {
    const sim = makeSim({ seed: 4, escalate: 1, scene: "play" });
    sim.game.campArmed = true;
    sim.game.deflects = CONFIG.limit_explode; // trip escalation next tick
    sim.runUntil((v) => v.scene === "escalation", 5_000);
    sim.runUntil((v) => v.scene === "play", CONFIG.escalation_screen_ms + 2_000);
    expect(sim.view().camp.armed).toBe(false);
    // stand still a long time — still no dropper, because it's disarmed
    sim.runFor(CONFIG.camp_time_ms + 3_000);
    expect(sim.view().dropper).toBeNull();
    expect(sim.view().camp.ms).toBe(0);
  });
});

describe("camp timer (armed)", () => {
  test("standing still triggers a dropper after ~camp_time_ms", () => {
    const sim = armedSim(1);
    const ms = sim.runUntil((v) => v.dropper !== null, CONFIG.camp_time_ms + 2000);
    expect(ms).toBeGreaterThan(CONFIG.camp_time_ms - 200);
    expect(ms).toBeLessThan(CONFIG.camp_time_ms + 400);
    expect(sim.view().dropper?.state).toBe("falling");
  });

  test("moving keeps resetting the timer — no dropper", () => {
    const sim = armedSim(1);
    for (let i = 0; i < 40; i++) {
      sim.harness.input.hold("left", i % 2 === 0);
      sim.harness.input.hold("right", i % 2 === 1);
      sim.step(20);
    }
    expect(sim.view().dropper).toBeNull();
    expect(sim.view().camp.fraction).toBeLessThan(0.5);
  });

  test("after a move the timer waits out camp_move_grace_ms", () => {
    const sim = armedSim(1);
    sim.harness.input.hold("right", true);
    sim.runFor(300);
    sim.harness.input.hold("right", false);
    expect(sim.view().camp.graceMs).toBeGreaterThan(CONFIG.camp_move_grace_ms - 400);
    sim.runFor(CONFIG.camp_move_grace_ms - 500);
    expect(sim.view().camp.ms).toBe(0);
    sim.runFor(1_000);
    expect(sim.view().camp.ms).toBeGreaterThan(300);
  });

  test("the warning telegraph precedes the drop", () => {
    const sim = armedSim(1);
    let sawWarn = false;
    sim.runUntil((v) => {
      if (v.camp.warnLevel > 0 && !v.dropper) sawWarn = true;
      return v.dropper !== null;
    }, CONFIG.camp_time_ms + 2000);
    expect(sawWarn).toBe(true);
  });

  test("punching in place still accrues camp time", () => {
    const sim = armedSim(1);
    let punchedInPlace = false;
    // A landed punch refunds itself, but these are pure whiffs (no missile to
    // hit) — stop short of limit_punch so the run doesn't hit TOO TIRED
    // before the camp timer gets a chance to accrue; the point here is just
    // that being rooted mid-punch doesn't stall the anti-camp timer.
    sim.runUntil((v) => {
      if (v.puncher.state === "punch") punchedInPlace = true;
      if (v.scores.punches < CONFIG.limit_punch) sim.harness.input.tap("punch");
      return v.dropper !== null || v.scene !== "play";
    }, CONFIG.camp_time_ms + 6000);
    expect(punchedInPlace).toBe(true);
    expect(sim.view().dropper !== null || sim.view().scores.hits > 0).toBe(true);
  });
});

describe("dropper resolution", () => {
  test("a camped puncher gets hit → downed", () => {
    const sim = armedSim(1);
    sim.runUntil((v) => v.scores.hits > 0 || v.scene !== "play", 20_000);
    expect(sim.view().scores.hits).toBe(1);
    expect(sim.view().scene).toBe("downed");
  });

  test("stepping aside clears it with no hit", () => {
    const sim = armedSim(1);
    sim.runUntil((v) => v.dropper !== null, CONFIG.camp_time_ms + 2000);
    sim.harness.input.hold("right", true);
    sim.runFor(500);
    sim.harness.input.hold("right", false);
    sim.runUntil((v) => v.dropper === null, 3000);
    expect(sim.view().scores.hits).toBe(0);
    expect(sim.view().scene).toBe("play");
  });
});
