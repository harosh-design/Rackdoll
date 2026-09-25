import { MS_PER_FRAME } from './constants';

/**
 * A Flash `Timer(delay_ms, repeatCount)` re-expressed as frame counting.
 *
 * The original's timers run on wall clock, independent of the physics step. We
 * drive them from the frame counter instead, so the whole simulation is
 * deterministic and can be soaked headless (§17). At the original's steady
 * 30 fps the two are the same thing; 200 ms is 6 frames, 1000 ms is 30.
 */
export class FrameTimer {
  readonly delayFrames: number;
  readonly repeatCount: number;
  /** How many times it has fired since the last start/reset. */
  currentCount = 0;
  running = false;

  private acc = 0;
  private readonly onTick: (t: FrameTimer) => void;
  private readonly onComplete?: (t: FrameTimer) => void;

  constructor(
    delayMs: number,
    repeatCount: number,
    onTick: (t: FrameTimer) => void,
    onComplete?: (t: FrameTimer) => void,
  ) {
    this.delayFrames = Math.max(1, Math.round(delayMs / MS_PER_FRAME));
    this.repeatCount = repeatCount;
    this.onTick = onTick;
    this.onComplete = onComplete;
  }

  /** Flash's Timer.start(): resumes, does not rewind. */
  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  /** Flash's Timer.reset(): stops and rewinds currentCount to 0. */
  reset(): void {
    this.running = false;
    this.currentCount = 0;
    this.acc = 0;
  }

  /** stop + reset + start, the common "restart this timer" idiom. */
  restart(): void {
    this.reset();
    this.start();
  }

  step(): void {
    if (!this.running) return;
    this.acc += 1;
    if (this.acc < this.delayFrames) return;
    this.acc = 0;
    this.currentCount += 1;
    this.onTick(this);
    if (this.repeatCount > 0 && this.currentCount >= this.repeatCount) {
      this.running = false;
      this.onComplete?.(this);
    }
  }
}

/** Owns a set of timers so the world can step them all in one call. */
export class TimerSet {
  private readonly timers: FrameTimer[] = [];

  add(t: FrameTimer): FrameTimer {
    this.timers.push(t);
    return t;
  }

  remove(t: FrameTimer): void {
    const i = this.timers.indexOf(t);
    if (i >= 0) this.timers.splice(i, 1);
  }

  step(): void {
    // Copy: a tick may add or remove timers.
    for (const t of this.timers.slice()) t.step();
  }

  clear(): void {
    this.timers.length = 0;
  }
}
