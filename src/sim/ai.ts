import { Vec2 } from 'planck';
import { CHAMPION, FLOOR_TOP_PX, OPTIONS, SERVE_CENTRE_M, TIMERS, toM } from './constants';
import type { Ball } from './ball';
import type { Player } from './player';
import { FrameTimer, type TimerSet } from './timer';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** The spec's "d.x in (lo, hi)" — an exclusive range. */
const between = (v: number, lo: number, hi: number) => v > lo && v < hi;

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
  private readonly pasTimer: FrameTimer;

  constructor(
    timers: TimerSet,
    computer: Player,
    ball: Ball,
    serve: (p: Player) => void,
  ) {
    this.computer = computer;
    this.ball = ball;
    this.serve = serve;
    this.pasTimer = timers.add(
      new FrameTimer(TIMERS.aiPasMs, TIMERS.aiPasRepeat, () => this.onPasTimer()),
    );
  }

  update(): void {
    if (this.DisableAI) return;

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

    // Chase the ball while it is on this side.
    if (ballPos.x > 10 && (!this.DisableMoveAfterPas || this.champion)) {
      let speed = this.champion ? CHAMPION.chaseImpulse : this.maxSpeed;
      const vx = this.ball.body.getLinearVelocity().x;
      const vy = this.ball.body.getLinearVelocity().y;
      let aimX = ballPos.x;
      if (this.champion && vy > 0) {
        const flight = clamp((toM(FLOOR_TOP_PX) - ballPos.y) / vy, 0, 0.75);
        aimX = clamp(ballPos.x + vx * flight,
          toM(CHAMPION.minHeadXpx), toM(CHAMPION.maxHeadXpx));
      } else if (!this.champion && Math.abs(d.x) > 1 && Math.abs(vx) < 4) {
        speed = clamp(Math.abs(vx) * 2, -this.maxSpeed, this.maxSpeed);
      }
      if (head.x >= aimX + 0.3) c.turnComp(Vec2(-speed, 0));
      else if (head.x < aimX - 0.3) c.turnComp(Vec2(speed, 0));
      if (this.champion && Math.abs(aimX - head.x) < toM(65) &&
          ballPos.y < head.y - toM(45) && ballPos.y > head.y - toM(170)) c.jump();
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
  }
}
