/**
 * Mulberry32 — a tiny, fast, deterministic PRNG.
 *
 * All simulation randomness (missile side / speed rolls, the start-screen coin
 * flip) goes through one `Rng` instance owned by `Game`, so a run is fully
 * reproducible from its seed. Cosmetic randomness (audio noise, the renderer's
 * hash) is left on `Math.random` / `Math.sin` — it never affects outcomes.
 */
export class Rng {
  /** The seed this generator was created / last reseeded with. */
  readonly seed: number;
  private state: number;

  constructor(seed: number = (Math.random() * 2 ** 32) >>> 0) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** True with probability `p`. */
  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** Jump the generator back to a known seed. */
  reseed(seed: number): void {
    (this as { seed: number }).seed = seed >>> 0;
    this.state = seed >>> 0;
  }
}
