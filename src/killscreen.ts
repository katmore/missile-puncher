/**
 * Kill-screen timing, shared by the renderer (which draws the overflowed
 * variable endlessly cycling through distortion colours) and the game (which
 * refuses restart input for the first few cycles).
 */

/** One colour step of the distorting variable text. */
export const KILL_DISTORT_CYCLE_MS = 440;
/** Cycles the player must sit through before a restart is accepted. */
export const KILL_DISTORT_CYCLES = 5;

/** True once enough cycles have passed that punch/R may restart the game. */
export function killRestartReady(killMs: number): boolean {
  return killMs >= KILL_DISTORT_CYCLE_MS * KILL_DISTORT_CYCLES;
}
