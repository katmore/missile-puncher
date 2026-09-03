/**
 * Fixed-timestep game loop with an accumulator.
 *
 *  - `update(FIXED_DT_MS)` is called zero or more times per frame so simulation
 *    timing is identical regardless of display refresh rate.
 *  - `render(realDtMs)` is called exactly once per frame; it also receives the
 *    real elapsed time for wall-clock animation (the explosion circle, blinks).
 *
 * `startLoop` returns a `LoopControl` for the dev harness: pause / resume /
 * single-step / speed multiplier. Normal play never touches it.
 */

export const FIXED_HZ = 120;
export const FIXED_DT_MS = 1000 / FIXED_HZ;

const MAX_FRAME_MS = 250; // clamp to avoid the spiral of death after a stall

export interface LoopCallbacks {
  update(dtMs: number): void;
  render(realDtMs: number): void;
}

export interface LoopControl {
  stop(): void;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /** Run `steps` fixed updates now (works whether paused or not). */
  step(steps?: number): void;
  /** Sim speed multiplier: 1 = realtime, 2 = double, 0.25 = quarter. */
  setSpeed(mult: number): void;
  readonly speed: number;
}

export function startLoop(cb: LoopCallbacks): LoopControl {
  let last = performance.now();
  let acc = 0;
  let running = true;
  let paused = false;
  let speed = 1;

  const frame = (now: number): void => {
    if (!running) return;
    let elapsed = now - last;
    last = now;
    if (elapsed > MAX_FRAME_MS) elapsed = MAX_FRAME_MS;

    if (!paused) {
      acc += elapsed * speed;
      while (acc >= FIXED_DT_MS) {
        cb.update(FIXED_DT_MS);
        acc -= FIXED_DT_MS;
      }
    }

    cb.render(paused ? 0 : elapsed);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
    },
    pause() {
      paused = true;
      acc = 0;
    },
    resume() {
      paused = false;
      acc = 0;
      last = performance.now();
    },
    get paused() {
      return paused;
    },
    step(steps = 1) {
      for (let i = 0; i < steps; i++) cb.update(FIXED_DT_MS);
      cb.render(0);
    },
    setSpeed(mult: number) {
      speed = Math.max(0, mult);
    },
    get speed() {
      return speed;
    },
  };
}
