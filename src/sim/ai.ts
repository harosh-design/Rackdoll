import { Vec2, type Vec2Value } from 'planck';
import {
  BALL, CHAMPION, FLOOR_TOP_PX, GRAVITY, LEFT_WALL_INNER_PX, MAX_TOUCHES,
  NET_BOTTOM_PX, NET_TOP_PX, NET_X_PX, OPTIONS, RIGHT_WALL_INNER_PX,
  SERVE_CENTRE_M, TIMERS, TIME_STEP, toM,
} from './constants';
import type { Ball } from './ball';
import type { Player, SwingHand } from './player';
import { FrameTimer, type TimerSet } from './timer';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** The spec's "d.x in (lo, hi)" — an exclusive range. */
const between = (v: number, lo: number, hi: number) => v > lo && v < hi;

/** Forecast the first floor landing with gravity, walls and the net. */
export function predictLanding(position: Vec2Value, velocity: Vec2Value): { x: number; seconds: number } {
  let { x, y } = position;
  let { x: vx, y: vy } = velocity;
  const radius = toM(BALL.radiusPx);
  const floor = toM(FLOOR_TOP_PX) - radius;
  const left = toM(LEFT_WALL_INNER_PX) + radius;
  const right = toM(RIGHT_WALL_INNER_PX) - radius;
  const net = toM(NET_X_PX);
  const netTop = toM(NET_TOP_PX) - radius;
  const netBottom = toM(NET_BOTTOM_PX) + radius;
  if (y >= floor) return { x, seconds: 0 };
  for (let frame = 1; frame <= 150; frame++) {
    vy = clamp(vy + GRAVITY.y * TIME_STEP, -BALL.maxVy, BALL.maxVy);
    let nextX = x + vx * TIME_STEP;
    const nextY = y + vy * TIME_STEP;
    if (nextX < left) {
      nextX = left + (left - nextX);
      vx = Math.abs(vx);
    } else if (nextX > right) {
      nextX = right - (nextX - right);
      vx = -Math.abs(vx);
    }
    if (nextY > netTop && nextY < netBottom) {
      if (x < net && nextX >= net - radius) {
        nextX = net - radius;
        vx = -Math.abs(vx);
      } else if (x > net && nextX <= net + radius) {
        nextX = net + radius;
        vx = Math.abs(vx);
      }
    }
    if (nextY >= floor) return { x: nextX, seconds: frame * TIME_STEP };
    x = nextX;
    y = nextY;
  }
  return { x, seconds: 150 * TIME_STEP };
}

/**
 * §12 AI opponent. Drives player 2.
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

  private readonly computer: Player;
  private readonly ball: Ball;
  private readonly serve: (p: Player) => void;
  private readonly swing: (p: Player, power: number, hand: SwingHand) => void;
  private readonly canSwing: (p: Player) => boolean;
  private readonly pasTimer: FrameTimer;
  private championJumpCooldown = 0;

  constructor(
    timers: TimerSet,
    computer: Player,
    ball: Ball,
    serve: (p: Player) => void,
    swing: (p: Player, power: number, hand: SwingHand) => void = () => {},
    canSwing: (p: Player) => boolean = () => true,
  ) {
    this.computer = computer;
    this.ball = ball;
    this.serve = serve;
    this.swing = swing;
    this.canSwing = canSwing;
    this.pasTimer = timers.add(
      new FrameTimer(TIMERS.aiPasMs, TIMERS.aiPasRepeat, () => this.onPasTimer()),
    );
  }

  update(): void {
    if (this.DisableAI) return;
    if (this.championJumpCooldown > 0) this.championJumpCooldown -= 1;

    const c = this.computer;
    const ballPos = this.ball.body.getWorldCenter();
    const head = c.head.getWorldCenter();
    const d = Vec2(ballPos.x - head.x, ballPos.y - head.y);
    // Read once up front: the original re-reads it below, past a branch that
    // has already proved it is not 2, and we want to keep that check visible.
    const holder: number = this.ball.ballOfPlayer;

    if (this.ball.ballOfPlayer === 2) {
      // Holding the ball: shuffle into position, then run the serve routine.
      if (this.act_count === 0) {
        if (ballPos.x < 11) c.turn(Vec2(1, 0));
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
      if (head.x >= ballPos.x + 0.3) c.turnComp(Vec2(-speed, 0));
      else c.turnComp(Vec2(speed, 0));
    }

    // Ball is on the human's half: go home and be ready.
    if (ballPos.x < SERVE_CENTRE_M) {
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

    if (between(d.x, 0.5, 1.5) && ballPos.x > 9) c.turnComp(Vec2(1.5, 0));
    if (between(d.x, -1.5, 0) && between(d.y, -2.5, 0)) c.jump();
    if (between(d.x, -1.5, 0) && between(d.y, -5.5, 0)) c.jump();
    if (ballPos.x > 10 && d.y > -3 && holder !== 2) c.turnDown();
  }

  private updateChampion(): void {
    const c = this.computer;
    const ball = this.ball.position;
    const velocity = this.ball.velocity;
    const forecast = this.ball.ballOfPlayer === 0 ? predictLanding(ball, velocity) : null;
    const defending = forecast !== null && forecast.x >= toM(NET_X_PX);
    const landingX = forecast?.x ?? toM(430);
    const targetPx = defending
      ? clamp(landingX + (landingX > toM(735) ? -toM(40) : toM(45)),
        toM(CHAMPION.minHeadXpx), toM(CHAMPION.maxHeadXpx))
      : toM(430);
    const error = targetPx - c.head.getWorldCenter().x;
    if (Math.abs(error) > toM(8)) {
      const impulse = clamp(error * CHAMPION.aimGain,
        -CHAMPION.chaseImpulse, CHAMPION.chaseImpulse);
      c.turnComp(Vec2(impulse, 0));
    }
    if (!defending || this.ball.ballOfPlayer !== 0) return;

    const head = c.head.getWorldCenter();
    if (this.championJumpCooldown === 0 && velocity.y > 0 &&
        ball.y < head.y - toM(30) && ball.y > head.y - toM(160) &&
        Math.abs(ball.x - head.x) < toM(85)) {
      c.jump();
      this.championJumpCooldown = CHAMPION.jumpCooldownFrames;
    }
    if (!this.canSwing(c) || c.contact >= MAX_TOUCHES || velocity.y <= 0) return;
    const inside = c.swingFinger('inside').getWorldCenter();
    const outside = c.swingFinger('outside').getWorldCenter();
    const insideDist = Vec2.sub(ball, inside).length();
    const outsideDist = Vec2.sub(ball, outside).length();
    const hand: SwingHand = insideDist <= outsideDist ? 'inside' : 'outside';
    if (Math.min(insideDist, outsideDist) < toM(CHAMPION.swingReachPx)) {
      this.swing(c, 0.8, hand);
    }
  }

  private goToXPlace(x: number, speed: number): void {
    const hx = this.computer.head.getWorldCenter().x;
    if (hx > x) this.computer.turn(Vec2(-speed, 0));
    if (hx < x) this.computer.turn(Vec2(speed, 0));
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
    this.computer.turn(Vec2(16, 0));
    if (this.ball.ballOfPlayer !== 2) {
      this.DisableMoveAfterPas = true;
      this.pasTimer.reset();
      this.act_count = 0;
    }
  }

  reset(): void {
    this.pasTimer.reset();
    this.act_count = 0;
    this.DisableMoveAfterPas = false;
    this.championJumpCooldown = 0;
  }
}
