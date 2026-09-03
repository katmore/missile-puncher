import { Audio } from "../engine/audio";
import { Input } from "../engine/input";
import { FIXED_DT_MS } from "../engine/loop";
import { Game } from "../game/game";
import type { BotKind } from "./bots";
import { Harness, type RunScenario } from "./harness";
import { readView, type View } from "./view";

/**
 * Headless simulation for playthrough / functional tests. No canvas, no loop,
 * no browser — construct `Game` with a purely-virtual `Input` and a muted
 * `Audio`, then step it at the real fixed timestep. Same `Harness` the browser
 * page uses, so bots + the event log behave identically.
 *
 *   const sim = makeSim({ seed: 7, escalate: 2 });
 *   sim.bot("perfect");
 *   sim.runFor(30_000);
 *   expect(sim.view().scores.hits).toBe(0);
 */
export interface Sim {
  game: Game;
  harness: Harness;
  view(): View;
  /** Advance `n` fixed steps (default 1). */
  step(n?: number): void;
  /** Advance ~`ms` of sim time. */
  runFor(ms: number): void;
  /** Step until `pred(view)` is true or `maxMs` elapses; returns ms elapsed. */
  runUntil(pred: (v: View) => boolean, maxMs?: number): number;
  /** Attach a rule-based bot (see `bots.ts`). */
  bot(kind: BotKind, seed?: number): void;
}

export function makeSim(scenario: RunScenario = {}): Sim {
  const input = new Input(); // no attach() -> pure virtual controller
  const audio = new Audio(); // no unlock() -> every method is a no-op
  const game = new Game(input, audio);
  const harness = new Harness(game, input);
  harness.configure(scenario);

  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      harness.tick(FIXED_DT_MS);
      input.sample();
      game.update(FIXED_DT_MS);
    }
  };

  return {
    game,
    harness,
    view: () => readView(game),
    step,
    runFor(ms) {
      step(Math.round(ms / FIXED_DT_MS));
    },
    runUntil(pred, maxMs = 120_000) {
      const maxSteps = Math.round(maxMs / FIXED_DT_MS);
      let n = 0;
      while (n < maxSteps && !pred(readView(game))) {
        step();
        n++;
      }
      return Math.round(n * FIXED_DT_MS);
    },
    bot(kind, seed) {
      harness.runBot(kind, seed);
    },
  };
}
