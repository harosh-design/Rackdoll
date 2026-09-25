import { Vec2, type World } from 'planck';
import {
  LANDING_CENTRE_M, MAX_TOUCHES, OPTIONS, PLAYER_FRICTION, SERVE_CENTRE_M,
  SPAWN_P1_PX, SPAWN_P2_PX, TIMERS, TIME_STEP, TIME_STEP_GOAL, TOUCH_IMPULSE,
} from './constants';
import type { Ball } from './ball';
import type { ContactFlags } from './contacts';
import type { Player, PlayerId } from './player';
import { FrameTimer, type TimerSet } from './timer';

export type Phase = 'play' | 'goal' | 'matchOver';

export interface GameEvents {
  onPoint?: (winner: PlayerId, reason: PointReason) => void;
  onNewRound?: () => void;
  onMatchOver?: (winner: PlayerId) => void;
}

export type PointReason = 'floor' | 'touches' | 'serveClock';

/** §11 Game rules. */
export class Game {
  score: Record<PlayerId, number> = { 1: 0, 2: 0 };
  phase: Phase = 'play';
  /** Who won the last point; they take the ball next round (§11). */
  win1 = true;
  /** Seconds left on the serve clock, for the HUD. */
  serveSecondsLeft: number = TIMERS.delayRepeat;
  /** Campaign scoring: points per goal scale with the opponent's level. */
  level: number = OPTIONS.currentLevel;
  campaignScore = 0;
  lastPointReason: PointReason | null = null;
  matchWinner: PlayerId | null = null;

  /** The current physics step — the goal replay runs at 0.005 (§3). */
  timeStep = TIME_STEP;

  private readonly world: World;
  private readonly p1: Player;
  private readonly p2: Player;
  private readonly ball: Ball;
  private readonly flags: ContactFlags;
  private readonly events: GameEvents;

  private readonly contactTimers: Record<PlayerId, FrameTimer>;
  private readonly goalTimer: FrameTimer;
  private readonly delayTimer: FrameTimer;
  private readonly timers: TimerSet;

  constructor(
    world: World,
    timers: TimerSet,
    p1: Player,
    p2: Player,
    ball: Ball,
    flags: ContactFlags,
    events: GameEvents = {},
  ) {
    this.world = world;
    this.timers = timers;
    this.p1 = p1;
    this.p2 = p2;
    this.ball = ball;
    this.flags = flags;
    this.events = events;

    // 200 ms debounce so one hit counts once.
    this.contactTimers = {
      1: timers.add(new FrameTimer(TIMERS.contactMs, 1, () => { p1.bContact = false; })),
      2: timers.add(new FrameTimer(TIMERS.contactMs, 1, () => { p2.bContact = false; })),
    };

    // 2 s goal replay before the next round.
    this.goalTimer = timers.add(
      new FrameTimer(TIMERS.goalMs, 1, () => this.afterGoal()),
    );

    // The six-second serve clock.
    this.delayTimer = timers.add(
      new FrameTimer(TIMERS.delayMs, TIMERS.delayRepeat, (t) => this.onServeTick(t)),
    );

    // §4 — at level start player 1 is given the ball.
    p1.takeBall(ball.body);
    ball.ballOfPlayer = 1;
    this.delayTimer.restart();
  }

  get playerOf(): Record<PlayerId, Player> {
    return { 1: this.p1, 2: this.p2 };
  }

  // -------------------------------------------------------------------------

  /** §11 game.update(), once per frame after the controls. */
  update(): void {
    if (this.phase !== 'play') return;

    // 1. Ball in flight with a contact: whose touch was it?
    if (this.ball.ballOfPlayer === 0) {
      const id = this.contactingPlayerId();
      if (id !== null) {
        const who = id === 1 ? this.p1 : this.p2;
        const other = id === 1 ? this.p2 : this.p1;
        if (!who.bContact) {
          who.contact += 1;
          other.contact = 0;
          // Every fresh player touch pops the ball up 10 m/s on a 0.1 kg ball.
          // Rallies are impossible without it (§1.7).
          if (this.ball.body.getJointList() == null) {
            this.ball.body.applyLinearImpulse(
              Vec2(TOUCH_IMPULSE.x, TOUCH_IMPULSE.y),
              this.ball.body.getWorldCenter(),
              true,
            );
          }
          who.bContact = true;
          this.contactTimers[id].restart();
        }
      }
    } else {
      // 2. Ball is held: both players' touch counts reset.
      this.p1.contact = 0;
      this.p2.contact = 0;
    }

    // 3. The three-touch rule. contact == 3 lights the warning indicator.
    if (this.p1.contact > MAX_TOUCHES) return this.awardPoint(2, 'touches');
    if (this.p2.contact > MAX_TOUCHES) return this.awardPoint(1, 'touches');

    // 4. The ball hit the floor.
    if (this.flags.onBallDown && this.ball.body.getJointList() == null) {
      const x = this.ball.body.getWorldCenter().x;
      const winner: PlayerId = x < LANDING_CENTRE_M ? 2 : 1;
      return this.awardPoint(winner, 'floor');
    }
  }

  /**
   * Walks the ball's contacts and reads the other fixture's friction:
   * 0.5 is player 1, 0.51 is player 2 (§5, §11.1).
   */
  private contactingPlayerId(): PlayerId | null {
    for (let edge = this.ball.body.getContactList(); edge; edge = edge.next) {
      const c = edge.contact;
      if (!c.isTouching()) continue;
      const fa = c.getFixtureA();
      const fb = c.getFixtureB();
      const other = fa.getBody() === this.ball.body ? fb : fa;
      const f = other.getFriction();
      if (f === PLAYER_FRICTION[1]) return 1;
      if (f === PLAYER_FRICTION[2]) return 2;
    }
    return null;
  }

  // -------------------------------------------------------------------------

  /**
   * §8 pas() aftermath: the server's touch count goes to 2 now and 3 in 50 ms,
   * so a serve spends two of the three touches and the third is only spent if
   * the opponent has not intervened.
   */
  registerServe(player: Player): void {
    player.contact = 2;
    const t = this.timers.add(
      new FrameTimer(TIMERS.serveTouchMs, 1, () => {
        if (player.contact !== 0) player.contact = 3;
        this.timers.remove(t);
      }),
    );
    t.start();
  }

  /** §11 serve clock: ticks once a second, shows 6 - count. */
  private onServeTick(t: FrameTimer): void {
    this.serveSecondsLeft = TIMERS.delayRepeat - t.currentCount;
    if (t.currentCount < TIMERS.delayRepeat) return;
    // Out of time. Drop the ball and hand the point straight over.
    const holder = this.ball.ballOfPlayer;
    if (holder === 0) return;
    const who = holder === 1 ? this.p1 : this.p2;
    const j = who.holdingJoint;
    if (j) {
      this.world.destroyJoint(j);
      who.forgetBallJoint();
    }
    this.ball.ballOfPlayer = 0;
    who.contact = MAX_TOUCHES + 1; // immediately hands the point to the opponent
    this.awardPoint(holder === 1 ? 2 : 1, 'serveClock');
  }

  // -------------------------------------------------------------------------

  private awardPoint(winner: PlayerId, reason: PointReason): void {
    if (this.phase !== 'play') return;
    this.phase = 'goal';
    this.win1 = winner === 1;
    this.lastPointReason = reason;
    this.score[winner] += 1;
    if (winner === 1) this.campaignScore += this.level;
    this.events.onPoint?.(winner, reason);

    this.delayTimer.reset();
    this.timeStep = TIME_STEP_GOAL; // the slow-motion goal replay
    this.goalTimer.restart();
  }

  private afterGoal(): void {
    const winner: PlayerId = this.win1 ? 1 : 2;
    if (this.score[winner] >= OPTIONS.gameSet) {
      this.phase = 'matchOver';
      this.matchWinner = winner;
      this.timeStep = TIME_STEP;
      this.events.onMatchOver?.(winner);
      return;
    }
    this.newRound();
  }

  /** §11 newRound(). */
  newRound(): void {
    this.p1.standPlayer(SPAWN_P1_PX.x, SPAWN_P1_PX.y);
    this.p2.standPlayer(SPAWN_P2_PX.x, SPAWN_P2_PX.y);
    this.p1.contact = 0;
    this.p2.contact = 0;
    this.p1.bContact = false;
    this.p2.bContact = false;
    this.contactTimers[1].reset();
    this.contactTimers[2].reset();

    this.flags.onBallDown = false;
    this.flags.bYesPrize = false;

    // The winner of the last point takes the ball. takeBall() refuses a ball
    // that already has a joint, so drop any grip first. Normal play never
    // needs this (points only happen with the ball free); resetMatch() does.
    this.releaseGrips();
    const server = this.win1 ? this.p1 : this.p2;
    this.ball.reset();
    server.takeBall(this.ball.body);
    this.ball.ballOfPlayer = server.id;

    this.serveSecondsLeft = TIMERS.delayRepeat;
    this.delayTimer.restart();
    this.timeStep = TIME_STEP;
    this.phase = 'play';
    this.events.onNewRound?.();
  }

  private releaseGrips(): void {
    for (const p of [this.p1, this.p2]) {
      const j = p.holdingJoint;
      if (j) {
        this.world.destroyJoint(j);
        p.forgetBallJoint();
      }
    }
  }

  /** Start a whole new match at the given campaign level. */
  resetMatch(level = this.level): void {
    this.score = { 1: 0, 2: 0 };
    this.level = level;
    this.matchWinner = null;
    this.win1 = true;
    this.lastPointReason = null;
    this.phase = 'play';
    this.newRound();
  }

  /** Who is holding the ball right now, for the serve-legality hint. */
  get serveLegal(): boolean {
    const holder = this.ball.ballOfPlayer;
    if (holder === 0) return false;
    const x = this.ball.body.getWorldCenter().x;
    return holder === 1 ? x < SERVE_CENTRE_M : x > SERVE_CENTRE_M;
  }
}
