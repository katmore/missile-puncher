import { CONFIG, type Gender } from "../config";
import type { Input } from "../engine/input";
import type { LoopControl } from "../engine/loop";
import type { Game, Scene } from "../game/game";
import { Missile } from "../game/missile";
import { makeBot, type Bot, type BotAction, type BotKind, BOT_KINDS } from "./bots";
import { readView, type View } from "./view";

type ActionName = "left" | "right" | "punch" | "reset";

export interface HarnessEvent {
  /** sim-clock ms when it happened. */
  tMs: number;
  type:
    | "scene"
    | "missileSpawn"
    | "punch"
    | "deflect"
    | "hit"
    | "escalate"
    | "speed"
    | "camp"
    | "drop"
    | "botStart"
    | "botStop";
  detail: string;
}

export interface RunScenario {
  seed?: number;
  escalate?: number;
  speedLevel?: number;
  gender?: Gender;
  scene?: Scene;
}

/**
 * The programmatic control surface for the game — exposed as `window.__harness`
 * (dev builds) and imported directly by headless tests. Same API both ways:
 * virtual input, loop transport, scenario setup, a serialisable `view()`, an
 * event log, and the rule-based bot runner.
 */
export class Harness {
  private simMs = 0;
  private prev: View | null = null;
  private log: HarnessEvent[] = [];
  private listeners = new Set<(e: HarnessEvent) => void>();

  private bot: Bot | null = null;
  private botPrevPunch = false;
  private botPrevReset = false;

  private loop: LoopControl | null = null;

  constructor(
    readonly game: Game,
    readonly input: Input,
  ) {}

  bindLoop(loop: LoopControl): void {
    this.loop = loop;
  }

  /**
   * Called once per fixed step, BEFORE `input.sample()` + `game.update()`, so
   * taps land in the same tick. Drives the bot and the event log.
   */
  tick(dtMs: number): void {
    this.simMs += dtMs;
    const v = readView(this.game);
    this.detectEvents(v);
    this.prev = v;

    if (this.bot) this.applyAction(this.bot.decide(v, dtMs));
  }

  private applyAction(a: BotAction): void {
    this.input.hold("left", a.move < 0);
    this.input.hold("right", a.move > 0);
    if (a.punch && !this.botPrevPunch) this.input.tap("punch");
    if (a.reset && !this.botPrevReset) this.input.tap("reset");
    this.botPrevPunch = a.punch;
    this.botPrevReset = a.reset;
  }

  private detectEvents(v: View): void {
    const p = this.prev;
    if (!p) return;
    if (v.scene !== p.scene) this.emit("scene", `${p.scene} → ${v.scene}`);
    if (v.escalate > p.escalate) this.emit("escalate", `ESCALATE ${v.escalate}`);
    if (v.speedLevel > p.speedLevel) this.emit("speed", `SPEED ${v.speedLevel}`);
    if (v.scores.punches > p.scores.punches) this.emit("punch", `#${v.scores.punches}`);
    if (v.scores.deflects > p.scores.deflects) this.emit("deflect", `#${v.scores.deflects}`);
    if (v.scores.hits > p.scores.hits) this.emit("hit", `#${v.scores.hits}`);
    const had = p.missile && p.missile.state !== "gone";
    const has = v.missile && v.missile.state !== "gone";
    if (!had && has && v.missile) {
      this.emit("missileSpawn", `${v.missile.dir === -1 ? "←" : "→"} v=${Math.round(v.missile.vx)}`);
    }

    // anti-camp: arm, warn crossing, warble start, spawn, and the resolution
    if (!p.camp.armed && v.camp.armed) this.emit("camp", "armed");
    if (p.camp.warnLevel === 0 && v.camp.warnLevel > 0) {
      this.emit("camp", `warning @ x=${Math.round(v.camp.threatX)}`);
    }
    if (!p.camp.soundOn && v.camp.soundOn) this.emit("camp", "warble");
    if (!p.dropper && v.dropper) {
      this.emit("drop", `x=${Math.round(v.dropper.x)}`);
    }
    if (
      p.dropper?.state === "falling" &&
      (!v.dropper || v.dropper.state !== "falling") &&
      v.scores.hits === p.scores.hits
    ) {
      this.emit("drop", "dodged");
    }
  }

  private emit(type: HarnessEvent["type"], detail: string): void {
    const e: HarnessEvent = { tMs: Math.round(this.simMs), type, detail };
    this.log.push(e);
    if (this.log.length > 500) this.log.shift();
    for (const fn of this.listeners) fn(e);
  }

  // --- the public API object ------------------------------------------

  get api() {
    const h = this;
    return {
      // observe
      view: (): View => readView(h.game),
      events: (): HarnessEvent[] => h.log.slice(),
      clearEvents: (): void => void (h.log = []),
      onEvent: (fn: (e: HarnessEvent) => void): (() => void) => {
        h.listeners.add(fn);
        return () => h.listeners.delete(fn);
      },
      get simMs() {
        return h.simMs;
      },

      // virtual input
      hold: (a: ActionName, on = true): void => h.input.hold(a, on),
      tap: (a: ActionName): void => h.input.tap(a),
      releaseAll: (): void => h.input.clearVirtual(),

      // loop transport
      pause: (): void => h.loop?.pause(),
      resume: (): void => h.loop?.resume(),
      step: (n = 1): void => h.loop?.step(n),
      setSpeed: (x: number): void => h.loop?.setSpeed(x),
      get paused() {
        return h.loop?.paused ?? false;
      },
      get speed() {
        return h.loop?.speed ?? 1;
      },

      // scenario setup
      reseed: (seed: number): void => h.game.rng.reseed(seed),
      configure: (s: RunScenario = {}): void => h.configure(s),
      spawnMissile: (opts: { fromRight?: boolean; speed?: number } = {}): void => {
        h.game.missile = new Missile(
          opts.fromRight ?? true,
          opts.speed ?? CONFIG.missile_speed,
        );
      },

      // bots
      botKinds: BOT_KINDS as readonly BotKind[],
      runBot: (kind: BotKind, seed?: number): void => h.runBot(kind, seed),
      stopBot: (): void => h.stopBot(),
      get bot(): BotKind | null {
        return h.bot?.kind ?? null;
      },
    };
  }

  configure(s: RunScenario): void {
    if (s.seed !== undefined) this.game.rng.reseed(s.seed);
    this.game.reset();
    this.game.punches = 0;
    this.game.deflects = 0;
    this.game.hits = 0;
    if (s.escalate !== undefined) this.game.escalate = s.escalate;
    if (s.speedLevel !== undefined) this.game.speedLevel = s.speedLevel;
    if (s.gender !== undefined) {
      this.game.gender = s.gender;
      this.game.leftGender = s.gender;
    }
    this.game.scene = s.scene ?? "play";
    this.simMs = 0;
    this.prev = null;
    this.log = [];
  }

  runBot(kind: BotKind, seed = 1): void {
    this.bot = makeBot(kind, seed);
    this.botPrevPunch = false;
    this.botPrevReset = false;
    this.emit("botStart", kind);
  }

  stopBot(): void {
    if (!this.bot) return;
    this.emit("botStop", this.bot.kind);
    this.bot = null;
    this.input.clearVirtual();
  }

  get activeBot(): Bot | null {
    return this.bot;
  }
}

export type HarnessApi = Harness["api"];
