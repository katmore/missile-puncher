import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CONFIG } from "../src/config";
import { makeSim } from "../src/harness/sim";

/**
 * `Audio.calls()` logs every sfx request regardless of whether a real
 * `AudioContext` exists — `makeSim()`'s `Audio` never unlocks, so this is the
 * only way headless tests can assert "the right sound fired at the right
 * moment" without actual WebAudio playback.
 */
describe("sound event log", () => {
  test("starts empty and clearCalls() resets it", () => {
    const sim = makeSim({ seed: 1, scene: "play" });
    expect(sim.game.audio.calls()).toEqual([]);
    sim.game.audio.punchConnect();
    expect(sim.game.audio.calls()).toEqual(["punchConnect"]);
    sim.game.audio.clearCalls();
    expect(sim.game.audio.calls()).toEqual([]);
  });

  test("a landed punch fires punchConnect + reflect, and the airburst fires explosion", () => {
    const sim = makeSim({ seed: 9, scene: "play" });
    sim.bot("perfect", 4);
    sim.runUntil((v) => v.scores.deflects > 0, 20_000);

    const calls = sim.game.audio.calls();
    const punchAt = calls.indexOf("punchConnect");
    const reflectAt = calls.indexOf("reflect");
    const explosionAt = calls.indexOf("explosion");
    expect(punchAt).toBeGreaterThanOrEqual(0);
    expect(reflectAt).toBeGreaterThanOrEqual(0);
    expect(explosionAt).toBeGreaterThan(reflectAt);
  });
});

describe("MISS sounds", () => {
  let savedSpawnDelay: number;
  beforeEach(() => {
    savedSpawnDelay = CONFIG.missile_spawn_delay;
    CONFIG.missile_spawn_delay = 9_999_999; // isolate the anti-camp dropper
  });
  afterEach(() => {
    CONFIG.missile_spawn_delay = savedSpawnDelay;
  });

  test("a dropper body hit fires explosion, then dropWhineStop in the same tick", () => {
    const sim = makeSim({ seed: 1, scene: "play" });
    sim.game.campArmed = true;
    sim.runUntil((v) => v.scores.hits > 0 || v.scene !== "play", 20_000);
    expect(sim.view().scene).toBe("downed");

    const calls = sim.game.audio.calls();
    const startAt = calls.indexOf("dropWhineStart");
    const explosionAt = calls.indexOf("explosion");
    const stopAt = calls.indexOf("dropWhineStop");
    expect(startAt).toBeGreaterThanOrEqual(0);
    expect(explosionAt).toBeGreaterThan(startAt);
    expect(stopAt).toBeGreaterThan(explosionAt); // clearDropper() stops it right after
  });
});

describe("anti-camp warble bracket", () => {
  let savedSpawnDelay: number;
  beforeEach(() => {
    savedSpawnDelay = CONFIG.missile_spawn_delay;
    CONFIG.missile_spawn_delay = 9_999_999;
  });
  afterEach(() => {
    CONFIG.missile_spawn_delay = savedSpawnDelay;
  });

  test("campWarnStart precedes campWarnStop, handed off to dropWhineStart as the dropper spawns", () => {
    const sim = makeSim({ seed: 1, scene: "play" });
    sim.game.campArmed = true;
    sim.runUntil((v) => v.dropper !== null, CONFIG.camp_time_ms + 2000);

    const calls = sim.game.audio.calls();
    const warnStartAt = calls.indexOf("campWarnStart");
    const warnStopAt = calls.indexOf("campWarnStop");
    const dropStartAt = calls.indexOf("dropWhineStart");
    expect(warnStartAt).toBeGreaterThanOrEqual(0);
    expect(warnStopAt).toBeGreaterThan(warnStartAt);
    // the dropper spawns and starts falling (and whining) the same tick the
    // warble notices it and stops — dropWhineStart is logged first, since
    // `syncDropAudio()` runs immediately before `syncCampAudio()` each tick.
    expect(dropStartAt).toBeGreaterThan(warnStartAt);
    expect(dropStartAt).toBeLessThan(warnStopAt);
  });
});

describe("drop-whine bracket", () => {
  let savedSpawnDelay: number;
  beforeEach(() => {
    savedSpawnDelay = CONFIG.missile_spawn_delay;
    CONFIG.missile_spawn_delay = 9_999_999;
  });
  afterEach(() => {
    CONFIG.missile_spawn_delay = savedSpawnDelay;
  });

  test("stepping aside lets the dropper land clean — whine still starts and stops", () => {
    const sim = makeSim({ seed: 1, scene: "play" });
    sim.game.campArmed = true;
    sim.runUntil((v) => v.dropper !== null, CONFIG.camp_time_ms + 2000);
    sim.harness.input.hold("right", true);
    sim.runFor(500);
    sim.harness.input.hold("right", false);
    sim.runUntil((v) => v.dropper === null, 3000);
    expect(sim.view().scores.hits).toBe(0);

    const calls = sim.game.audio.calls();
    const startAt = calls.indexOf("dropWhineStart");
    const stopAt = calls.indexOf("dropWhineStop");
    expect(startAt).toBeGreaterThanOrEqual(0);
    expect(stopAt).toBeGreaterThan(startAt);
    // a clean dodge never explodes on the puncher
    expect(calls.slice(startAt, stopAt + 1)).not.toContain("explosion");
  });
});
