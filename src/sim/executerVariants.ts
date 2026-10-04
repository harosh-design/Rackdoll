/**
 * The four hazards. Physical tuning lives here; how each one attacks lives in
 * executer.ts, with its numbers in constants.ts (MAGNET, BOXER, COMET, SPRING).
 * `speed` scales the base hunting speed, `launch` the speed it leaves the
 * button at, and `force` its steering force budget.
 */
export const EXECUTER_VARIANTS = [
  { id: 'magnet', label: 'MAGNET', mass: 6, speed: 1.1, launch: 0.6, force: 1.8, friction: 0.45, restitution: 0.3 },
  { id: 'boxer', label: 'BOXER', mass: 5.5, speed: 1.08, launch: 1.05, force: 1.05, friction: 0.3, restitution: 0.8 },
  { id: 'comet', label: 'COMET', mass: 3.7, speed: 1, launch: 1.6, force: 1, friction: 0.2, restitution: 0.6 },
  { id: 'spring', label: 'SPRING', mass: 3.2, speed: 1, launch: 1, force: 1, friction: 0.18, restitution: 1 },
] as const;

export type ExecuterVariant = (typeof EXECUTER_VARIANTS)[number];
export type ExecuterId = ExecuterVariant['id'];

export function executerVariant(id: ExecuterId): ExecuterVariant {
  return EXECUTER_VARIANTS.find((v) => v.id === id)!;
}

/** Seeded LCG, so a match's hazard order and the boxer's aim are reproducible. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000;
}

/**
 * The order hazards come out in, shared by both buttons. Each run of four is
 * a fresh shuffle of all four, so every hazard turns up once per run, and a
 * run never starts with the one the last run ended on. `order` replaces the
 * shuffle with a fixed, repeating order, for tuning and tests.
 */
export class ExecuterQueue {
  private readonly upcoming: ExecuterVariant[] = [];
  private last: ExecuterVariant | null = null;
  private cursor = 0;

  constructor(
    private readonly random: () => number,
    private readonly order?: readonly ExecuterId[],
  ) {}

  /** The next `n` hazards, in the order they will come out. */
  peek(n: number): readonly ExecuterVariant[] {
    this.fill(n);
    return this.upcoming.slice(0, n);
  }

  /** Take the next hazard off the front. */
  next(): ExecuterVariant {
    this.fill(1);
    return this.upcoming.shift()!;
  }

  /** A new match: a fresh order (or the fixed order from the top). */
  reset(): void {
    this.upcoming.length = 0;
    this.last = null;
    this.cursor = 0;
  }

  private fill(n: number): void {
    while (this.upcoming.length < n) {
      if (this.order?.length) {
        this.upcoming.push(executerVariant(this.order[this.cursor++ % this.order.length]));
        continue;
      }
      const run: ExecuterVariant[] = [...EXECUTER_VARIANTS];
      for (let i = run.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [run[i], run[j]] = [run[j], run[i]];
      }
      if (run[0] === this.last) [run[0], run[1]] = [run[1], run[0]];
      this.last = run[run.length - 1];
      this.upcoming.push(...run);
    }
  }
}
