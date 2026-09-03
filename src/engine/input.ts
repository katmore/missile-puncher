import { CONFIG } from "../config";

type Action = "left" | "right" | "punch" | "debug" | "reset";

/** Identifiers a key event can be matched against (physical code + logical key). */
function idsOf(ev: KeyboardEvent): string[] {
  const ids: string[] = [];
  if (ev.code) ids.push(ev.code);
  if (ev.key) ids.push(ev.key.toLowerCase());
  return ids;
}

/**
 * Tracks held keys and exposes edge-triggered helpers. `sample()` must be called
 * once at the top of each simulation tick to roll "just pressed" state forward.
 *
 * A parallel VIRTUAL layer (`hold` / `tap` / `clearVirtual`) is OR-ed into every
 * query so the test harness / bots can drive the Puncher without synthesising
 * DOM key events. `attach()` is optional — construct an `Input`, never call
 * `attach()`, and it works as a purely virtual controller (used by headless
 * tests).
 */
export class Input {
  private held = new Set<string>();
  private pressedThisTick = new Set<string>();
  private queued = new Set<string>();

  // Virtual layer — keyed by ACTION name, not raw key id.
  private vHeld = new Set<Action>();
  private vPressed = new Set<Action>();
  private vQueued = new Set<Action>();

  /** Fired the first time any input happens — used to unlock the AudioContext. */
  onFirstInput: (() => void) | null = null;
  private gotFirst = false;

  /** Idempotent — call from any input path (keyboard, touch). */
  firstInput(): void {
    if (this.gotFirst) return;
    this.gotFirst = true;
    this.onFirstInput?.();
  }

  attach(target: EventTarget = window): void {
    target.addEventListener("keydown", (e) => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      for (const id of idsOf(ev)) {
        this.held.add(id);
        this.queued.add(id);
        if (this.isAction(id)) ev.preventDefault();
      }
      this.firstInput();
    });
    target.addEventListener("keyup", (e) => {
      for (const id of idsOf(e as KeyboardEvent)) this.held.delete(id);
    });
    window.addEventListener("blur", () => {
      this.held.clear();
      this.queued.clear();
      this.vHeld.clear();
    });
  }

  sample(): void {
    this.pressedThisTick = this.queued;
    this.queued = new Set();
    this.vPressed = this.vQueued;
    this.vQueued = new Set();
  }

  // --- virtual controller (harness / bots) ------------------------------

  /** Hold or release a virtual action (like keydown / keyup). */
  hold(action: Action, on: boolean): void {
    if (on) this.vHeld.add(action);
    else this.vHeld.delete(action);
  }

  /** Edge-trigger a virtual action for exactly the next `sample()` window. */
  tap(action: Action): void {
    this.vQueued.add(action);
  }

  /** Drop every virtual hold + pending tap. */
  clearVirtual(): void {
    this.vHeld.clear();
    this.vQueued.clear();
    this.vPressed.clear();
  }

  // --- queries --------------------------------------------------------

  private codes(action: Action): readonly string[] {
    return CONFIG.keys[action];
  }

  private isAction(code: string): boolean {
    return (Object.keys(CONFIG.keys) as Action[]).some((a) =>
      this.codes(a).includes(code),
    );
  }

  down(action: Action): boolean {
    return (
      this.vHeld.has(action) ||
      this.codes(action).some((c) => this.held.has(c))
    );
  }

  pressed(action: Action): boolean {
    return (
      this.vPressed.has(action) ||
      this.codes(action).some((c) => this.pressedThisTick.has(c))
    );
  }
}
