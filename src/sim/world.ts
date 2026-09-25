import { Vec2, World } from 'planck';
import { AI } from './ai';
import { Ball } from './ball';
import {
  EXECUTER, EXECUTER_ITERATIONS, GRAVITY, ITERATIONS, MS_PER_FRAME, OPTIONS, PRIZE_ANIM,
  SERVE_CENTRE_M, SPAWN_P1_PX, SPAWN_P2_PX, toM,
} from './constants';
import { Control } from './control';
import { installContactListener, installContactTweaks, type ContactFlags } from './contacts';
import { Executer, type ExecuterTuning } from './executer';
import { Game, type GameEvents } from './game';
import { Ground } from './ground';
import { Player } from './player';
import type { PrizeButton } from './prizeButton';
import { FrameTimer, TimerSet } from './timer';

export interface GameWorldOptions {
  /** Single player puts an AI on player 2. */
  singlePlayer?: boolean;
  /** Campaign level 1..5; scales the points a goal is worth. */
  level?: number;
  /** Hazards on/off. Off, a button still clicks but launches nothing. */
  hazards?: boolean;
  /** Override executer physics, for tuning and tests. */
  executerTuning?: Partial<ExecuterTuning>;
  /** Solver iterations on frames where an executer is touching a doll. */
  contactIterations?: number;
  events?: GameEvents;
}

/**
 * §3 The whole simulation. No DOM anywhere in this module or the ones it
 * imports, so thousands of frames can be run headless and asserted on (§17).
 */
export class GameWorld {
  readonly world: World;
  readonly ground: Ground;
  readonly p1: Player;
  readonly p2: Player;
  readonly ball: Ball;
  readonly game: Game;
  readonly control = new Control();
  readonly ai: AI | null;
  readonly timers = new TimerSet();
  readonly flags: ContactFlags = { onBallDown: false, bYesPrize: false, prizeHits: [] };
  readonly executers: Executer[] = [];

  /** Frames simulated since construction. */
  frame = 0;
  paused = false;
  readonly singlePlayer: boolean;
  readonly hazards: boolean;
  private readonly executerTuning?: Partial<ExecuterTuning>;
  private readonly contactIterations: number;

  constructor(opts: GameWorldOptions = {}) {
    this.singlePlayer = opts.singlePlayer ?? true;
    this.hazards = opts.hazards ?? true;
    this.executerTuning = opts.executerTuning;
    this.contactIterations = opts.contactIterations ?? EXECUTER_ITERATIONS;

    this.world = new World({
      gravity: Vec2(GRAVITY.x, GRAVITY.y),
      allowSleep: true, // the original's doSleep
    });

    // The original's world.GetGroundBody(): one shared static body at origin
    // that the horizontal rails anchor to.
    const railAnchor = this.world.createBody({ type: 'static', position: Vec2(0, 0) });

    this.ground = new Ground(this.world);
    this.p1 = new Player(this.world, railAnchor, SPAWN_P1_PX.x, SPAWN_P1_PX.y, 1);
    this.p2 = new Player(this.world, railAnchor, SPAWN_P2_PX.x, SPAWN_P2_PX.y, 2);
    this.ball = new Ball(this.world);

    installContactListener(this.world, this.flags);
    installContactTweaks(this.world);

    const events: GameEvents = {
      ...opts.events,
      onNewRound: () => {
        this.ai?.reset();
        opts.events?.onNewRound?.();
      },
    };

    this.game = new Game(
      this.world, this.timers, this.p1, this.p2, this.ball, this.flags, events,
    );
    if (opts.level != null) this.game.level = opts.level;

    this.ai = this.singlePlayer
      ? new AI(this.timers, this.p2, this.ball, (p) => this.serve(p))
      : null;
  }

  /**
   * §8 pas(), plus the touch-count bookkeeping the game owns. Routed through
   * here so the AI and the keyboard take exactly the same path.
   */
  serve = (player: Player): void => {
    const ok = player.pas(this.ball.body, this.ball.ballOfPlayer, SERVE_CENTRE_M);
    if (!ok) return;
    this.ball.ballOfPlayer = 0;
    this.game.registerServe(player);
  };

  /**
   * §3 One frame, in the original's order. Input lands one step late because
   * the controls run AFTER the step — that is faithful, not an oversight.
   */
  step(): void {
    if (this.paused) return;

    // 1. The physics. 1/28 s once per 30 fps frame (§1.3).
    const dt = this.game.timeStep;
    // The original's 10 iterations everywhere, except while an executer is at
    // a doll: a 0.07 kg hand hitting a 6 kg ball is badly conditioned, and at
    // 10 iterations the joints visibly stretch.
    const it = this.executerNearDoll() ? this.contactIterations : ITERATIONS;
    this.world.step(dt, it, it);

    // 1b. A button hit during that step launches its executer now — the
    //     earliest moment, since bodies can't be created mid-step.
    this.pressPrizeButtons();

    // 2. (The renderer syncs sprites here; it reads bodies directly instead.)

    // 3. Controls, both players.
    this.control.update(this.p1, this.serve);
    if (!this.singlePlayer) this.control.update(this.p2, this.serve);

    // 4. Rules.
    this.game.update();

    // 5. AI, single player only.
    this.ai?.update();

    // 6. Hazards.
    for (const e of this.executers) e.update(dt);

    // 7. The ball's speed clamps, last.
    this.ball.update();

    this.timers.step();
    this.frame += 1;
  }

  /**
   * Is any live executer within reach of a doll? Checked before the step, so
   * the frame of first impact already gets the extra solver iterations.
   */
  executerNearDoll(): boolean {
    const reach = toM(EXECUTER.radiusPx + EXECUTER.nearMarginPx);
    for (const e of this.executers) {
      if (e.dead || !e.solid) continue;
      const c = e.body.getWorldCenter();
      for (const p of [this.p1, this.p2]) {
        for (const b of p.bodies) {
          const q = b.getWorldCenter();
          if (Math.abs(q.x - c.x) < reach && Math.abs(q.y - c.y) < reach) return true;
        }
      }
    }
    return false;
  }

  private pressPrizeButtons(): void {
    const hits = this.flags.prizeHits;
    if (hits.length === 0) return;
    for (const body of hits) {
      const button = this.ground.prizeButtonFor(body);
      if (!button) continue;
      if (button.press(this.frame)) this.launch(button);
    }
    hits.length = 0;
  }

  /** Every hit launches another executer — no limit on how many. */
  private launch(button: PrizeButton): void {
    if (!this.hazards) {
      // Hazards off: the button still clicks, then pops back out.
      const t = new FrameTimer(PRIZE_ANIM.momentaryFrames * MS_PER_FRAME, 1, () => {
        button.releaseMomentary(this.frame);
        this.timers.remove(t);
      });
      this.timers.add(t).start();
      return;
    }
    const target = button.side === 1 ? this.p1 : this.p2;
    // "my" is the executer player 1 earned (it lands on player 2), "comp" the other.
    const mine = button.side === 2;
    const ex = new Executer({
      world: this.world,
      timers: this.timers,
      target,
      side: button.side,
      origin: button.launchPoint(),
      speed: mine ? OPTIONS.myExSpeed : OPTIONS.compExSpeed,
      lifeSeconds: mine ? OPTIONS.myExLife : OPTIONS.compExLife,
      tuning: this.executerTuning,
      // Its button pops back out once its last executer dies.
      onDeath: (e) => button.executerDied(e, this.frame),
    });
    button.executers.push(ex);
    this.executers.push(ex);
  }

  /** Drop every live executer and re-arm the buttons, e.g. for a new match. */
  clearExecuters(): void {
    for (const e of this.executers.slice()) e.destroy();
    this.executers.length = 0;
  }

  /** Reap executers whose lifetime ran out. */
  reap(): void {
    for (let i = this.executers.length - 1; i >= 0; i--) {
      if (this.executers[i].dead) this.executers.splice(i, 1);
    }
  }
}
