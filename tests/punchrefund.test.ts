import { describe, expect, test } from "vitest";
import { CONFIG } from "../src/config";
import { makeSim } from "../src/harness/sim";
import { pnchRemaining } from "../src/render/hud";

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

  test("a body hit (MISS) resets PUNCH to full, like an escalation", () => {
    const savedSpawnDelay = CONFIG.missile_spawn_delay;
    CONFIG.missile_spawn_delay = 9_999_999; // isolate the anti-camp dropper hit
    try {
      const sim = makeSim({ seed: 1, scene: "play" });
      sim.game.campArmed = true;
      sim.game.punches = 2; // some whiffs already spent before the hit lands

      sim.runUntil((v) => v.scores.hits > 0 || v.scene !== "play", 20_000);
      expect(sim.view().scores.hits).toBe(1);
      expect(sim.view().scene).toBe("downed");
      expect(sim.view().scores.punches).toBe(0); // -> displays as the full 5
    } finally {
      CONFIG.missile_spawn_delay = savedSpawnDelay;
    }
  });

  test("the PNCH display doesn't blip down-then-up on a punch that's about to land", () => {
    const sim = makeSim({ seed: 2, scene: "play" });
    const g = sim.game;
    g.punches = 1;
    g.punchesBeforeSwing = 1;
    const settled = pnchRemaining(g); // the steady reading before the throw

    // The throw: punches increments, but the swing just started.
    g.puncher.state = "punch";
    g.puncher.phase = "startup";
    g.punchesBeforeSwing = 1;
    g.punches = 2;
    expect(pnchRemaining(g)).toBe(settled); // held — no blip yet

    // Still in the hitbox-active window, not yet resolved.
    g.puncher.phase = "active";
    expect(pnchRemaining(g)).toBe(settled); // still held

    // It connects: resolveCollisions refunds it mid-active.
    g.punches = 1;
    expect(pnchRemaining(g)).toBe(settled); // still held — never blipped at all

    // Recovery: the outcome (a refund) is settled, live punches matches
    // what was already showing, so nothing visibly changes.
    g.puncher.phase = "recovery";
    expect(pnchRemaining(g)).toBe(settled);
  });

  test("the PNCH display reveals a genuine whiff once its swing reaches recovery", () => {
    const sim = makeSim({ seed: 2, scene: "play" });
    const g = sim.game;
    g.punches = 1;
    g.punchesBeforeSwing = 1;
    const before = pnchRemaining(g);

    g.puncher.state = "punch";
    g.puncher.phase = "startup";
    g.punchesBeforeSwing = 1;
    g.punches = 2;
    expect(pnchRemaining(g)).toBe(before); // held through startup

    g.puncher.phase = "active";
    expect(pnchRemaining(g)).toBe(before); // held through active — never connected

    g.puncher.phase = "recovery"; // active closed with no refund: a real whiff
    expect(pnchRemaining(g)).toBe(before - 1);
  });

  test("the throw that pushes PUNCH over the limit doesn't trigger TOO TIRED mid-swing", () => {
    const sim = makeSim({ seed: 5, scene: "play" });
    const g = sim.game;

    // One whiff away from the limit, then the throw that crosses it.
    g.puncher.state = "punch";
    g.puncher.phase = "startup";
    g.puncher.phaseTimer = CONFIG.punch_startup;
    g.punches = CONFIG.limit_punch + 1;

    // Still mid-swing (well inside the startup window) — held off, since
    // this exact swing might still land and refund itself.
    sim.step(3);
    expect(sim.view().scene).toBe("play");

    // The swing lands: refunded back under the limit, resolved to idle.
    g.punches = CONFIG.limit_punch;
    g.puncher.state = "idle";
    sim.step();
    expect(sim.view().scene).toBe("play");

    // A genuine whiff (never refunded) still triggers it once resolved.
    g.punches = CONFIG.limit_punch + 1;
    g.puncher.state = "idle";
    sim.step();
    expect(sim.view().scene).toBe("tired");
  });
});
