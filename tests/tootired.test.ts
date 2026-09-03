import { describe, expect, test } from "vitest";
import { CONFIG } from "../src/config";
import { makeSim } from "../src/harness/sim";

describe("TOO TIRED", () => {
  test("forces a hit and costs a life, without resetting EXPLODE or ESCALATE", () => {
    const sim = makeSim({ seed: 1, escalate: 1, scene: "play" });
    sim.game.deflects = 4; // EXPLODE progress that should survive the sequence
    sim.game.puncher.x = 100;

    sim.game.punches = CONFIG.limit_punch + 1; // the trigger
    sim.step();
    expect(sim.view().scene).toBe("tired");
    expect(sim.view().dropper).toBeNull();

    // immobilized through the whole warn + laser window — no dropper yet
    sim.runFor(CONFIG.tired_warn_ms + CONFIG.tired_laser_ms - 100);
    expect(sim.view().scene).toBe("tired");
    expect(sim.view().dropper).toBeNull();

    // the dropper spawns and always connects — the puncher can't dodge
    const ms = sim.runUntil((v) => v.scene !== "tired", 6_000);
    expect(ms).toBeLessThan(6_000);

    const v = sim.view();
    expect(v.scene).toBe("downed"); // limit_miss not reached from a single hit
    expect(v.scores.hits).toBe(1);
    expect(v.scores.deflects).toBe(4); // unchanged — no reset to the level's start
    expect(v.scores.punches).toBe(0); // fresh stamina for the next attempt
    expect(v.escalate).toBe(1); // unchanged
  });

  test("TOO TIRED on the last life reaches BAD END, not a reset", () => {
    const sim = makeSim({ seed: 2, scene: "play" });
    sim.game.hits = CONFIG.limit_miss - 1; // one more hit ends the run
    sim.game.punches = CONFIG.limit_punch + 1;
    sim.step();
    expect(sim.view().scene).toBe("tired");

    sim.runUntil((v) => v.scene !== "tired", 6_000);
    expect(sim.view().scene).toBe("end");
    expect(sim.view().scores.hits).toBe(CONFIG.limit_miss);
  });
});
