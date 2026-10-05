import { BALL, BEES, VIEW, clamp01 } from './constants';
import type { PlayerId } from './player';
import { POWERS, type PowerId, type PowerUps } from './powerUps';

export type BeeStyle = 'bob' | 'hop' | 'jitter';

export interface BeeFlight {
  /** Drawn size and hit radius, 1 for an ordinary bee. */
  scale: number;
  /** Cruising speed, px per physics second. */
  speed: number;
  style: BeeStyle;
  /** Vertical wobble, px, and its rate, rad per physics second. */
  amp: number;
  freq: number;
}

/**
 * How each power's bee flies, so the gift can be read before it is hit: the
 * giant's bee is big and lumbering, the tiny's small and jittery, the high
 * jump's bounces along and the speed's races across. What each one carries
 * is drawn by the renderer.
 */
export const BEE_FLIGHT: Record<PowerId, BeeFlight> = {
  giant: { scale: 1.6, speed: 90, style: 'bob', amp: 14, freq: 1.6 },
  tiny: { scale: 0.6, speed: 130, style: 'jitter', amp: 12, freq: 4 },
  feather: { scale: 1, speed: 85, style: 'bob', amp: 26, freq: 1.1 },
  highJump: { scale: 1, speed: 110, style: 'hop', amp: 48, freq: 2.4 },
  speed: { scale: 1, speed: 210, style: 'bob', amp: 7, freq: 3 },
  magnet: { scale: 1, speed: 115, style: 'bob', amp: 18, freq: 2.2 },
  shield: { scale: 1, speed: 110, style: 'bob', amp: 18, freq: 2 },
};

export interface Bee {
  readonly kind: PowerId;
  /** +1 flies left to right. */
  readonly dir: 1 | -1;
  readonly startXPx: number;
  readonly baseYPx: number;
  readonly phase: number;
  /** Physics seconds in flight, so it slows with the goal replay and the windup. */
  age: number;
  /** Its age a frame ago: the hit sweep and the renderer go from here to `age`. */
  prevAge: number;
}

export interface BeePop {
  kind: PowerId;
  owner: PlayerId;
  xPx: number;
  yPx: number;
  frame: number;
}

export const beeRadiusPx = (kind: PowerId): number => BEES.radiusPx * BEE_FLIGHT[kind].scale;

/** Where bees come in and go out: just beyond the screen's left and right edges. */
export const BEE_LANES = {
  left: -VIEW.offsetX / VIEW.scale - BEES.edgeMarginPx,
  right: (VIEW.stageW - VIEW.offsetX) / VIEW.scale + BEES.edgeMarginPx,
} as const;

/** The flight is a closed form of age, so it can be swept and interpolated. */
export function beePosition(bee: Bee, age = bee.age): { xPx: number; yPx: number } {
  const f = BEE_FLIGHT[bee.kind];
  const w = f.freq * age + bee.phase;
  let dy: number;
  switch (f.style) {
    // Bounces off an invisible floor: sharp at the bottom, rounded at the top.
    case 'hop': dy = f.amp / 2 - f.amp * Math.abs(Math.sin(w)); break;
    case 'jitter': dy = f.amp * Math.sin(w) + 0.4 * f.amp * Math.sin(3.7 * w + 1); break;
    default: dy = f.amp * Math.sin(w) + 0.3 * f.amp * Math.sin(2.3 * w + 0.7);
  }
  return { xPx: bee.startXPx + bee.dir * f.speed * age, yPx: bee.baseYPx + dy };
}

/**
 * Match-owned bee lifecycle: launches, flight, and the ball meeting a bee.
 * A hit goes through `PowerUps.activate`, replacing any current ability.
 */
export class Bees {
  readonly bees: Bee[] = [];
  /** Bees popped in the last `BEES.popFrames`, for the renderer. */
  readonly pops: BeePop[] = [];
  launches = 0;
  private playFrames = 0;
  private nextLaunchAt: number = BEES.firstFrames;
  private readonly upcoming: PowerId[] = [];
  private lastKind: PowerId | null = null;
  private cursor = 0;
  private lastBall: { xPx: number; yPx: number } | null = null;

  constructor(
    private readonly powerUps: PowerUps,
    private readonly random: () => number,
    /** Off, no bee launches on its own; `spawn` still works. */
    private readonly autoLaunch = true,
    /** A fixed, repeating order instead of the shuffle, for tests. */
    private readonly order?: readonly PowerId[],
  ) {}

  /**
   * One frame, after the rules. `dt` is the frame's physics step, `ball` the
   * ball's centre, and `owner` whoever holds it or touched it last.
   */
  update(dt: number, frame: number, inPlay: boolean, ball: { xPx: number; yPx: number }, owner: PlayerId | null): void {
    while (this.pops.length > 0 && frame - this.pops[0].frame >= BEES.popFrames) this.pops.shift();

    if (inPlay && this.autoLaunch) {
      this.playFrames += 1;
      if (this.playFrames >= this.nextLaunchAt && this.bees.length < BEES.maxAlive) {
        this.spawn(this.nextKind());
        const { min, max } = BEES.intervalFrames;
        this.nextLaunchAt = this.playFrames + min + Math.floor(this.random() * (max - min + 1));
      }
    }

    for (let i = this.bees.length - 1; i >= 0; i--) {
      const bee = this.bees[i];
      bee.prevAge = bee.age;
      bee.age += dt;
      const { xPx } = beePosition(bee);
      if (bee.dir === 1 ? xPx > BEE_LANES.right : xPx < BEE_LANES.left) this.bees.splice(i, 1);
    }

    let from = this.lastBall ?? ball;
    this.lastBall = { ...ball };
    if (Math.hypot(ball.xPx - from.xPx, ball.yPx - from.yPx) > BEES.maxSweepPx) from = ball;
    if (!inPlay || owner === null) return;
    for (let i = this.bees.length - 1; i >= 0; i--) {
      const bee = this.bees[i];
      if (!this.ballMeets(bee, from, ball)) continue;
      const at = beePosition(bee);
      this.bees.splice(i, 1);
      this.pops.push({ kind: bee.kind, owner, xPx: at.xPx, yPx: at.yPx, frame });
      this.powerUps.activate(owner, bee.kind, frame);
    }
  }

  /** Send a bee in from one edge. Random side and height unless given. */
  spawn(
    kind: PowerId,
    dir: 1 | -1 = this.random() < 0.5 ? 1 : -1,
    baseYPx = BEES.altitudePx.top + this.random() * (BEES.altitudePx.bottom - BEES.altitudePx.top),
  ): Bee {
    const bee: Bee = {
      kind,
      dir,
      startXPx: dir === 1 ? BEE_LANES.left : BEE_LANES.right,
      baseYPx,
      phase: this.random() * Math.PI * 2,
      age: 0,
      prevAge: 0,
    };
    this.bees.push(bee);
    this.launches += 1;
    return bee;
  }

  /** A new match: no bees, and the clock and order start over. */
  reset(): void {
    this.bees.length = 0;
    this.pops.length = 0;
    this.launches = 0;
    this.playFrames = 0;
    this.nextLaunchAt = BEES.firstFrames;
    this.upcoming.length = 0;
    this.lastKind = null;
    this.cursor = 0;
    this.lastBall = null;
  }

  /**
   * Both moved this frame, so sweep the ball relative to the bee: the
   * closest approach on that segment, against the two radii.
   */
  private ballMeets(bee: Bee, from: { xPx: number; yPx: number }, to: { xPx: number; yPx: number }): boolean {
    const a = beePosition(bee, bee.prevAge);
    const b = beePosition(bee);
    const rx = from.xPx - a.xPx;
    const ry = from.yPx - a.yPx;
    const dx = to.xPx - b.xPx - rx;
    const dy = to.yPx - b.yPx - ry;
    const len2 = dx * dx + dy * dy;
    const s = len2 > 0 ? clamp01(-(rx * dx + ry * dy) / len2) : 0;
    const reach = BALL.radiusPx + beeRadiusPx(bee.kind);
    return (rx + s * dx) ** 2 + (ry + s * dy) ** 2 <= reach * reach;
  }

  /** Every power once per run of seven, in a fresh order, never twice in a row. */
  private nextKind(): PowerId {
    if (this.order?.length) return this.order[this.cursor++ % this.order.length];
    if (this.upcoming.length === 0) {
      const run = [...POWERS];
      for (let i = run.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [run[i], run[j]] = [run[j], run[i]];
      }
      if (run[0] === this.lastKind) [run[0], run[1]] = [run[1], run[0]];
      this.upcoming.push(...run);
    }
    const kind = this.upcoming.shift()!;
    this.lastKind = kind;
    return kind;
  }
}
