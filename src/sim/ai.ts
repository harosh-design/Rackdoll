import { Vec2, type Vec2Value } from 'planck';
import {
  BALL, BALL_VX_SCALE_WALL, CHAMPION, DEG, FEATHER, FLOOR_TOP_PX, GRAVITY, LANDING_CENTRE_M,
  LEFT_WALL_INNER_PX, MAX_TOUCHES, NET_BOTTOM_PX, NET_TOP_PX, NET_X_PX, OPTIONS,
  RIGHT_WALL_INNER_PX, SERVE_CENTRE_M, TIMERS, TIME_STEP, TOUCH_IMPULSE, toM, toPx,
} from './constants';
import type { Ball } from './ball';
import type { Player, SwingHand } from './player';
import { FrameTimer, type TimerSet } from './timer';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** The spec's "d.x in (lo, hi)" — an exclusive range. */
const between = (v: number, lo: number, hi: number) => v > lo && v < hi;

export interface BallSample {
  /** Frames from now. */
  frame: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Step a free ball forward with gravity, the walls and the net, frame by frame,
 * until it reaches the floor. Walls and the net keep 60% of vx (§10). Players
 * are ignored. `gravityScaleAt` is the feather ball's slow fall over one half.
 */
export function forecastBall(
  position: Vec2Value,
  velocity: Vec2Value,
  maxFrames = 150,
  gravityScaleAt: (x: number) => number = () => 1,
): BallSample[] {
  let { x, y } = position;
  let { x: vx, y: vy } = velocity;
  const radius = toM(BALL.radiusPx);
  const floor = toM(FLOOR_TOP_PX) - radius;
  const left = toM(LEFT_WALL_INNER_PX) + radius;
  const right = toM(RIGHT_WALL_INNER_PX) - radius;
  const net = toM(NET_X_PX);
  const netTop = toM(NET_TOP_PX) - radius;
  const netBottom = toM(NET_BOTTOM_PX) + radius;
  const samples: BallSample[] = [];
  if (y >= floor) return samples;
  for (let frame = 1; frame <= maxFrames; frame++) {
    vy = clamp(vy + GRAVITY.y * gravityScaleAt(x) * TIME_STEP, -BALL.maxVy, BALL.maxVy);
    let nextX = x + vx * TIME_STEP;
    const nextY = y + vy * TIME_STEP;
    if (nextX < left) {
      nextX = left + (left - nextX);
      vx = Math.abs(vx) * BALL_VX_SCALE_WALL;
    } else if (nextX > right) {
      nextX = right - (nextX - right);
      vx = -Math.abs(vx) * BALL_VX_SCALE_WALL;
    }
    if (nextY > netTop && nextY < netBottom) {
      if (x < net && nextX >= net - radius) {
        nextX = net - radius;
        vx = -Math.abs(vx) * BALL_VX_SCALE_WALL;
      } else if (x > net && nextX <= net + radius) {
        nextX = net + radius;
        vx = Math.abs(vx) * BALL_VX_SCALE_WALL;
      }
    }
    x = nextX;
    y = Math.min(nextY, floor);
    samples.push({ frame, x, y, vx, vy });
    if (nextY >= floor) break;
  }
  return samples;
}

/** Forecast the first floor landing with gravity, walls and the net. */
export function predictLanding(
  position: Vec2Value,
  velocity: Vec2Value,
  gravityScaleAt?: (x: number) => number,
): { x: number; seconds: number } {
  const samples = forecastBall(position, velocity, 150, gravityScaleAt);
  const last = samples.at(-1);
  if (!last) return { x: position.x, seconds: 0 };
  return { x: last.x, seconds: last.frame * TIME_STEP };
}

const NET_M = toM(NET_X_PX);
/**
 * Measured over 1200 trial swings: with the ball in this box when the swing
 * starts (relative to the head, toward the net), the net-side hand connects
 * 75–98% of the time. Full-size px; negative "below" is above the head.
 */
const SWING_ZONE = { aheadPx: [18, 72], belowPx: [-42, 22] } as const;
/** Where the champion lines the ball up for a deliberate swing: mid-zone. */
const SWING_AIM = { aheadPx: 45, belowPx: -10 } as const;

/** The champion's current intention, in its own frame (itself on the right). */
export interface ReturnPlan {
  score: number;
  /** Where its head should be when the ball arrives. */
  headX: number;
  /** Frames until the ball reaches head height. */
  frame: number;
  /** Contact angle, degrees; positive puts the ball on the net side of the head. */
  deg: number;
  /** Forecast landing on the far side, metres. */
  landX: number;
}

/**
 * §12 AI opponent. Written, as in the original, for player 2 on the right.
 * Driving player 1 it sees the court mirrored about the net: positions go
 * through mx() on the way in and pushes through side() on the way out.
 *
 * The spec notes that the exact branch nesting here was reconstructed from a
 * stack-machine trace rather than read off cleanly: the thresholds are exact,
 * the control flow is very close.
 */
export class AI {
  DisableAI = false;
  DisableMoveAfterPas = false;
  champion = false;
  maxSpeed: number = OPTIONS.AImaxSpeed;
  act_count = 0;
  /** The champion's plan this frame, for tests and debugging. */
  plan: ReturnPlan | null = null;

  private readonly computer: Player;
  private readonly ball: Ball;
  private readonly serve: (p: Player) => void;
  private readonly swing: (p: Player, power: number, hand: SwingHand) => void;
  private readonly canSwing: (p: Player) => boolean;
  private readonly pasTimer: FrameTimer;
  /** True when driving player 1, whose court is the mirror image. */
  private readonly flip: boolean;

  constructor(
    timers: TimerSet,
    computer: Player,
    ball: Ball,
    serve: (p: Player) => void,
    swing: (p: Player, power: number, hand: SwingHand) => void = () => {},
    canSwing: (p: Player) => boolean = () => true,
    private readonly opponent: Player | null = null,
  ) {
    this.computer = computer;
    this.ball = ball;
    this.serve = serve;
    this.swing = swing;
    this.canSwing = canSwing;
    this.flip = computer.id === 1;
    this.pasTimer = timers.add(
      new FrameTimer(TIMERS.aiPasMs, TIMERS.aiPasRepeat, () => this.onPasTimer()),
    );
  }

  update(): void {
    if (this.DisableAI) return;

    const c = this.computer;
    const ballPos = this.local(this.ball.body.getWorldCenter());
    const head = this.local(c.head.getWorldCenter());
    const d = Vec2(ballPos.x - head.x, ballPos.y - head.y);
    // Read once up front: the original re-reads it below, past a branch that
    // has already proved it is not ours, and we want to keep that check visible.
    const holder: number = this.ball.ballOfPlayer;

    if (this.ball.ballOfPlayer === c.id) {
      // Holding the ball: shuffle into position, then run the serve routine.
      if (this.act_count === 0) {
        if (ballPos.x < 11) c.turn(this.side(1));
        else this.pasTimer.start();
      }
      return;
    }

    // The ball has left: rewind the serve sequencer.
    if (this.pasTimer.running || this.act_count !== 0) {
      this.pasTimer.reset();
      this.act_count = 0;
    }

    if (this.champion) {
      this.updateChampion();
      return;
    }

    // Chase the ball while it is on this side.
    if (ballPos.x > 10 && !this.DisableMoveAfterPas) {
      let speed = this.maxSpeed;
      const vx = this.ball.body.getLinearVelocity().x;
      if (Math.abs(d.x) > 1 && Math.abs(vx) < 4) {
        speed = clamp(Math.abs(vx) * 2, -this.maxSpeed, this.maxSpeed);
      }
      if (head.x >= ballPos.x + 0.3) c.turnComp(this.side(-speed));
      else c.turnComp(this.side(speed));
    }

    // Ball is on the opponent's half: go home and be ready.
    if (ballPos.x < this.mx(SERVE_CENTRE_M)) {
      // The flag exists so the AI does not chase its own serve; once the ball
      // is on the far side that job is done.
      this.DisableMoveAfterPas = false;
      this.goToXPlace(12.7, 2);
      if (
        between(d.x, -7, 0) &&
        between(d.y, -7, 0) &&
        this.ball.ballOfPlayer === 0
      ) {
        c.jump();
      }
    }

    if (between(d.x, 0.5, 1.5) && ballPos.x > 9) c.turnComp(this.side(1.5));
    if (between(d.x, -1.5, 0) && between(d.y, -2.5, 0)) c.jump();
    if (between(d.x, -1.5, 0) && between(d.y, -5.5, 0)) c.jump();
    if (ballPos.x > 10 && d.y > -3 && holder !== c.id) c.turnDown();
  }

  /** World x to the AI's own frame (itself on the right), and back. */
  private mx(x: number): number {
    return this.flip ? 2 * NET_M - x : x;
  }

  private local(p: Vec2Value): Vec2 {
    return Vec2(this.mx(p.x), p.y);
  }

  /** A sideways push given in the AI's frame. */
  private side(x: number): Vec2 {
    return Vec2(this.flip ? -x : x, 0);
  }

  /**
   * The champion. Each frame it forecasts the ball, finds where it will drop
   * onto its head, and picks the contact angle whose rebound (plus the touch
   * pop) lands farthest from the opponent's reach. Then it walks its head to
   * that spot, jumps for balls it cannot otherwise get under, and spends its
   * swing on a ball that is falling onto its hand. Same physics and rules.
   */
  private updateChampion(): void {
    const c = this.computer;
    this.plan = null;
    if (this.ball.ballOfPlayer !== 0) {
      // The opponent is about to serve.
      this.steer(toM(CHAMPION.readyXpx));
      return;
    }
    if (c.contact >= MAX_TOUCHES) {
      // A fourth touch loses the point outright; let the ball go.
      this.dodge();
      return;
    }
    const plan = this.planSwing() ?? this.planReturn();
    this.plan = plan;
    if (!plan) {
      this.steer(toM(CHAMPION.readyXpx));
      return;
    }
    this.steer(plan.headX, plan.frame);
    this.championSwing();
  }

  /** Where the ball meets the head next, and the best way to send it back. */
  private planReturn(): ReturnPlan | null {
    const c = this.computer;
    const s = c.sizeScale;
    const samples = forecastBall(this.ball.position, this.ball.velocity, CHAMPION.horizonFrames, this.gravityScaleAt);
    const restY = toM(FLOOR_TOP_PX - (FLOOR_TOP_PX - CHAMPION.headRestPx) * s);
    const reach = toM(CHAMPION.headRadiusPx * s + BALL.radiusPx);
    const ourSide = toM(NET_X_PX + BALL.radiusPx);
    const sample = samples.find((q) => this.mx(q.x) > ourSide && q.vy > 0 && q.y >= restY - reach);
    if (!sample) return null;

    const bx = this.mx(sample.x);
    const bvx = this.flip ? -sample.vx : sample.vx;
    const headX = this.mx(c.head.getWorldCenter().x);
    const opponentX = this.opponent ? this.mx(this.opponent.head.getWorldCenter().x) : toM(NET_X_PX - 220);
    const maxTravel = toM(CHAMPION.maxStepPx) * Math.max(0, sample.frame - 2);
    const minX = toM(CHAMPION.minHeadXpx);
    const maxX = this.maxHeadX();
    const netClear = toM(NET_TOP_PX - BALL.radiusPx - CHAMPION.netClearancePx);
    // The ball's spin survives its flight (no damping) and decides how much
    // sideways speed the head's friction leaves it. Mirroring reverses it.
    const spin = (this.flip ? -1 : 1) * this.ball.body.getAngularVelocity();
    const r = toM(BALL.radiusPx);
    const rollMass = 1 + BALL.mass * r * r / BALL.inertia;
    let best: ReturnPlan | null = null;
    for (let deg = CHAMPION.minAngleDeg; deg <= CHAMPION.maxAngleDeg; deg += 2) {
      const th = deg * DEG;
      // Contact normal, head centre to ball centre. Positive angles put the
      // ball on the net side of the head.
      const nx = -Math.sin(th);
      const ny = -Math.cos(th);
      const vn = bvx * nx + sample.vy * ny;
      if (vn >= 0) continue;
      // Bounce along the normal; friction along the tangent stops the
      // contact point slipping (spin included), up to its Coulomb limit.
      const pn = -(1 + CHAMPION.headBounce) * vn;
      const tx = -ny;
      const ty = nx;
      const slip = bvx * tx + sample.vy * ty - spin * r;
      const pt = clamp(slip / rollMass, -CHAMPION.headFriction * pn, CHAMPION.headFriction * pn);
      const ox = clamp(bvx + pn * nx - pt * tx, -BALL.maxVx, BALL.maxVx);
      const oy = clamp(sample.vy + pn * ny - pt * ty + TOUCH_IMPULSE.y / BALL.mass, -BALL.maxVy, BALL.maxVy);
      const path = forecastBall(Vec2(sample.x, sample.y), Vec2(this.flip ? -ox : ox, oy), 150, this.gravityScaleAt);
      const crossing = path.find((q) => this.mx(q.x) < NET_M);
      // It must pass well over the net: the bounce model is only approximate.
      if (!crossing || crossing.y > netClear) continue;
      const end = path.at(-1)!;
      const land = { x: end.x, seconds: end.frame * TIME_STEP };
      const landX = this.mx(land.x);
      if (landX > toM(NET_X_PX - CHAMPION.netMarginPx)) continue;
      const target = bx + reach * Math.sin(th);
      // The rails stop the head short of the net and the wall.
      if (target < minX || target > maxX) continue;
      const late = Math.max(0, Math.abs(target - headX) - maxTravel);
      // The opponent's problem: how far they must run, and how little time.
      // Right by the net is out of reach of any head.
      const spread = Math.min(Math.abs(landX - opponentX), toM(CHAMPION.aimCapPx));
      const deadZone = landX > toM(NET_X_PX - CHAMPION.deadZonePx) ? CHAMPION.deadZoneBonus : 0;
      const score = (toPx(spread) + deadZone) / (land.seconds + CHAMPION.timeBias)
        - CHAMPION.anglePenalty * Math.abs(deg)
        - CHAMPION.latePenalty * toPx(late);
      if (!best || score > best.score) best = { score, headX: target, frame: sample.frame, deg, landX };
    }
    // Nothing clears the net from here: get under it anyway, net side of the
    // head, and let the next touch try again.
    return best ?? {
      score: -Infinity, headX: clamp(bx + reach * 0.5, minX, maxX), frame: sample.frame, deg: 30, landX: NaN,
    };
  }

  /**
   * With the swing ready, stand so the ball drops through the middle of the
   * swing zone rather than onto the head; championSwing() then strikes.
   */
  private planSwing(): ReturnPlan | null {
    const c = this.computer;
    if (!this.canSwing(c) || c.contact >= MAX_TOUCHES) return null;
    const s = c.sizeScale;
    const restY = toM(FLOOR_TOP_PX - (FLOOR_TOP_PX - CHAMPION.headRestPx) * s);
    const strikeY = restY + toM(SWING_AIM.belowPx * s);
    const samples = forecastBall(this.ball.position, this.ball.velocity, CHAMPION.horizonFrames, this.gravityScaleAt);
    const ourSide = toM(NET_X_PX + BALL.radiusPx);
    const sample = samples.find((q) => this.mx(q.x) > ourSide && q.vy > 0 && q.y >= strikeY);
    if (!sample) return null;
    const headX = this.mx(sample.x) + toM(SWING_AIM.aheadPx * s);
    if (headX < toM(CHAMPION.minHeadXpx) || headX > this.maxHeadX()) return null;
    const travel = Math.abs(headX - this.mx(c.head.getWorldCenter().x));
    if (travel > toM(CHAMPION.maxStepPx) * Math.max(0, sample.frame - 3)) return null;
    return { score: 0, headX, frame: sample.frame, deg: NaN, landX: NaN };
  }

  /** The far wall stops the head, in the AI's frame. */
  private maxHeadX(): number {
    const wall = this.flip ? this.mx(toM(LEFT_WALL_INNER_PX)) : toM(RIGHT_WALL_INNER_PX);
    return wall - toM(CHAMPION.headRadiusPx * this.computer.sizeScale + 2);
  }

  /** Velocity-style steering: turnComp sets the doll's speed, so aim for a fraction of the gap. */
  private steer(targetX: number, framesLeft = 30): void {
    const c = this.computer;
    if (!c.grounded) return; // turnComp would cancel a jump in flight
    const err = toPx(targetX - this.mx(c.head.getWorldCenter().x));
    if (Math.abs(err) < CHAMPION.deadbandPx) return;
    const stepPx = clamp(err / clamp(framesLeft / 2, 1, 3), -CHAMPION.maxStepPx, CHAMPION.maxStepPx);
    c.turnComp(this.side(stepPx / CHAMPION.pxPerImpulse));
  }

  /** Out of touches: stand clear of where the ball is coming down. */
  private dodge(): void {
    const samples = forecastBall(this.ball.position, this.ball.velocity, CHAMPION.horizonFrames, this.gravityScaleAt);
    const last = samples.at(-1);
    const head = this.mx(this.computer.head.getWorldCenter().x);
    if (!last) return;
    const x = this.mx(last.x);
    const away = head >= x ? x + toM(CHAMPION.dodgePx) : x - toM(CHAMPION.dodgePx);
    this.steer(clamp(away, toM(CHAMPION.minHeadXpx), this.maxHeadX()));
  }

  /**
   * One swing per round. The net-side hand whips through a box just in front
   * of the head, so swing the moment the ball is in it: the hit sends it over
   * fast.
   */
  private championSwing(): void {
    const c = this.computer;
    if (!this.canSwing(c) || c.contact >= MAX_TOUCHES) return;
    const s = c.sizeScale;
    const head = this.local(c.head.getWorldCenter());
    const ball = this.local(this.ball.position);
    if (ball.x < NET_M) return;
    const ahead = toPx(head.x - ball.x) / s;
    const below = toPx(ball.y - head.y) / s;
    if (ahead >= SWING_ZONE.aheadPx[0] && ahead <= SWING_ZONE.aheadPx[1] &&
        below >= SWING_ZONE.belowPx[0] && below <= SWING_ZONE.belowPx[1]) {
      this.swing(c, CHAMPION.swingPower, 'inside');
    }
  }

  /** The feather ball falls slower over a feathered player's half. */
  private gravityScaleAt = (x: number): number => {
    const ownerId = x < LANDING_CENTRE_M ? 1 : 2;
    const owner = ownerId === this.computer.id ? this.computer : this.opponent;
    return owner?.power === 'feather' ? FEATHER.gravityScale : 1;
  };

  private goToXPlace(x: number, speed: number): void {
    const hx = this.mx(this.computer.head.getWorldCenter().x);
    if (hx > x) this.computer.turn(this.side(-speed));
    if (hx < x) this.computer.turn(this.side(speed));
  }

  /**
   * Fires up to 5 times, 700 ms apart. First tick jumps; later ticks serve and
   * swing the arm through the ball, retrying while the ball is still held.
   */
  private onPasTimer(): void {
    this.act_count += 1;
    if (this.act_count === 1) {
      this.computer.jump();
      return;
    }
    this.serve(this.computer);
    this.computer.turn(this.side(16));
    if (this.ball.ballOfPlayer !== this.computer.id) {
      this.DisableMoveAfterPas = true;
      this.pasTimer.reset();
      this.act_count = 0;
    }
  }

  reset(): void {
    this.pasTimer.reset();
    this.act_count = 0;
    this.DisableMoveAfterPas = false;
    this.plan = null;
  }
}
