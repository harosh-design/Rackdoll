import { Vec2, World } from 'planck';
import { AI } from './ai';
import { Ball } from './ball';
import {
  CHARGE, EXECUTER, EXECUTER_ITERATIONS, GRAVITY, ITERATIONS, MS_PER_FRAME, OPTIONS, PRIZE_ANIM,
  NET_X_PX, powerScale, RESCUE, SERVE_CENTRE_M, SPAWN_P1_PX, SPAWN_P2_PX, SWING, toM,
} from './constants';
import { Control } from './control';
import { installContactListener, installContactTweaks, type ContactFlags } from './contacts';
import { Executer, type ExecuterTuning } from './executer';
import { Game, type GameEvents } from './game';
import { Ground } from './ground';
import { Player, type PlayerId } from './player';
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
  readonly flags: ContactFlags = { onBallDown: false, bYesPrize: false, prizeHits: [], ballPlayerHits: [] };
  readonly executers: Executer[] = [];
  readonly swingEffects: Record<PlayerId, { frame: number; power: number }> = {
    1: { frame: -100, power: 0 },
    2: { frame: -100, power: 0 },
  };
  readonly opponentHitEffects: Record<PlayerId, { frame: number; power: number }> = {
    1: { frame: -100, power: 0 },
    2: { frame: -100, power: 0 },
  };
  readonly perfectEffects: Record<PlayerId, { frame: number; power: number }> = {
    1: { frame: -100, power: 0 }, 2: { frame: -100, power: 0 },
  };
  counterEffect = { frame: -100, power: 0 };
  readonly rescueEffects: Record<PlayerId, { frame: number; success: boolean }> = {
    1: { frame: -100, success: false }, 2: { frame: -100, success: false },
  };
  readonly rescueFeedback: Record<PlayerId, { frame: number; text: string }> = {
    1: { frame: -100, text: '' }, 2: { frame: -100, text: '' },
  };
  readonly rescueAvailable: Record<PlayerId, boolean> = { 1: true, 2: true };

  /** Frames simulated since construction. */
  frame = 0;
  paused = false;
  readonly singlePlayer: boolean;
  readonly hazards: boolean;
  private readonly executerTuning?: Partial<ExecuterTuning>;
  private readonly contactIterations: number;
  private readonly strikes: Record<PlayerId, { frame: number; power: number; ballHit: boolean; opponentHit: boolean; hitExecuters: Set<Executer> } | null> = {
    1: null, 2: null,
  };
  private counter: { framesLeft: number; direction: 1 | -1 } | null = null;
  private readonly rescueActiveUntil: Record<PlayerId, number> = { 1: -1, 2: -1 };
  private aiCounterWindupFrames = 0;

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
      onPoint: (winner, reason) => {
        this.strikes[1] = this.strikes[2] = null;
        this.counter = null;
        this.rescueActiveUntil[1] = this.rescueActiveUntil[2] = -1;
        opts.events?.onPoint?.(winner, reason);
      },
      onNewRound: () => {
        this.ai?.reset();
        this.strikes[1] = this.strikes[2] = null;
        this.counter = null;
        this.rescueAvailable[1] = this.rescueAvailable[2] = true;
        this.rescueActiveUntil[1] = this.rescueActiveUntil[2] = -1;
        this.aiCounterWindupFrames = 0;
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
   * here so the AI and the keyboard take exactly the same fixed-power path.
   */
  serve = (player: Player): void => {
    const ok = player.pas(this.ball.body, this.ball.ballOfPlayer, SERVE_CENTRE_M);
    if (!ok) return;
    this.ball.ballOfPlayer = 0;
    this.game.registerServe(player);
  };

  /** Not in the original: the rally hit, routed the same way as serve(). */
  swing = (player: Player, power = 1): void => {
    player.swingArm(power);
    this.swingEffects[player.id] = { frame: this.frame, power };
    if (this.game.phase !== 'play' || this.ball.ballOfPlayer !== 0) return;
    this.strikes[player.id] = { frame: this.frame, power, ballHit: false, opponentHit: false, hitExecuters: new Set() };
  };

  /** The same eligibility check drives the button hint and the move itself. */
  rescueState(player: Player): 'ready' | 'used' | 'held' | 'otherSide' | 'rising' | 'far' | 'high' {
    if (!this.rescueAvailable[player.id]) return 'used';
    if (this.game.phase !== 'play' || this.ball.ballOfPlayer !== 0 || this.ball.held) return 'held';
    const ball = this.ball.position;
    const head = player.head.getWorldCenter();
    if (player.id === 1 ? ball.x > toM(NET_X_PX) : ball.x < toM(NET_X_PX)) return 'otherSide';
    if (this.ball.velocity.y <= 0) return 'rising';
    if (Math.abs(ball.x - head.x) > toM(RESCUE.reachPx)) return 'far';
    if (ball.y < head.y - toM(RESCUE.maxAboveHeadPx)) return 'high';
    return 'ready';
  }

  /** One off-balance dive per rally, only toward a nearby falling ball. */
  rescue = (player: Player): void => {
    const state = this.rescueState(player);
    if (state !== 'ready') {
      const reason = {
        used: 'DIVE USED', held: 'WAIT FOR RALLY', otherSide: 'OTHER SIDE',
        rising: 'WAIT FOR FALL', far: 'GET CLOSER', high: 'BALL TOO HIGH',
      }[state];
      this.rescueFeedback[player.id] = { frame: this.frame, text: reason };
      return;
    }
    player.diveToward(this.ball.body);
    this.rescueAvailable[player.id] = false;
    this.rescueActiveUntil[player.id] = this.frame + RESCUE.activeFrames;
    this.rescueEffects[player.id] = { frame: this.frame, success: false };
  };

  /**
   * §3 One frame, in the original's order. Input lands one step late because
   * the controls run AFTER the step — that is faithful, not an oversight.
   */
  step(): void {
    if (this.paused) return;
    this.p1.tickRecoil();
    this.p2.tickRecoil();

    // 1. The physics. 1/28 s once per 30 fps frame (§1.3).
    const dt = this.game.timeStep * (
      this.game.phase === 'play' && this.control.isChargingSwing() ? CHARGE.windupTimeScale : 1
    );
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
    this.control.update(this.p1, this.serve, this.swing, this.rescue);
    if (!this.singlePlayer) this.control.update(this.p2, this.serve, this.swing, this.rescue);
    this.resolveStrikes();
    this.advanceCounter();
    this.resolveRescueTouches();
    this.attractBallDuringWindup();

    // 4. Rules.
    this.game.update();

    // 5. AI, single player only.
    this.ai?.update();
    this.updateAiCounter();

    // 6. Hazards.
    for (const e of this.executers) e.update(dt);

    // 7. The ball's speed clamps, last.
    this.ball.update();

    this.timers.step();
    this.frame += 1;
  }

  /** Resolve simultaneous counters before individual ball and player hits. */
  private resolveStrikes(): void {
    const contacts = this.flags.ballPlayerHits;
    if (this.game.phase !== 'play') {
      this.strikes[1] = this.strikes[2] = null;
      if (contacts) contacts.length = 0;
      return;
    }

    if (this.tryCounter()) {
      this.strikes[1] = this.strikes[2] = null;
      if (contacts) contacts.length = 0;
      return;
    }

    for (const contact of contacts ?? []) {
      const strike = this.strikes[contact.playerId];
      if (!strike || strike.ballHit || this.ball.ballOfPlayer !== 0) continue;
      const strikingSide = contact.playerId === 1 ? 'Left' : 'Right';
      if (contact.part !== `Finger${strikingSide}` && contact.part !== `Hand${strikingSide}`) continue;
      const age = this.frame - strike.frame;
      if (age < 0 || age >= SWING.opponentHitFrames) continue;
      strike.ballHit = true;
      if (age <= SWING.perfectFrames) {
        const sign = contact.playerId === 1 ? 1 : -1;
        const scale = powerScale(strike.power);
        this.ball.body.applyLinearImpulse(
          Vec2(sign * SWING.perfectBallImpulseX * scale, SWING.perfectBallImpulseY * scale),
          this.ball.position,
          true,
        );
        this.perfectEffects[contact.playerId] = { frame: this.frame, power: strike.power };
      }
    }
    if (contacts) contacts.length = 0;

    for (const id of [1, 2] as const) {
      const strike = this.strikes[id];
      if (!strike) continue;
      const age = this.frame - strike.frame;
      if (age >= SWING.opponentHitFrames) {
        this.strikes[id] = null;
      } else {
        this.hitExecuters(id, strike);
        if (age >= SWING.counterWindowFrames && !strike.opponentHit) {
          strike.opponentHit = this.hitOpponent(id, strike.power);
        }
      }
    }
  }

  /** A swing must meet an executer with the striking hand to knock it back. */
  private hitExecuters(
    attackerId: PlayerId,
    strike: { power: number; hitExecuters: Set<Executer> },
  ): void {
    const attacker = attackerId === 1 ? this.p1 : this.p2;
    const finger = attacker.strikingFinger;
    const hand = attacker.part(attackerId === 1 ? 'HandLeft' : 'HandRight');
    const origin = attacker.head.getWorldCenter();
    for (const e of this.executers) {
      if (e.dead || !e.solid || e.target !== attacker || strike.hitExecuters.has(e)) continue;
      let touched = false;
      for (let edge = e.body.getContactList(); edge; edge = edge.next) {
        if (edge.contact.isTouching() && (edge.other === finger || edge.other === hand)) {
          touched = true;
          break;
        }
      }
      if (!touched) continue;
      const c = e.body.getWorldCenter();
      const dx = c.x - origin.x;
      const speed = SWING.executerKnockSpeed * powerScale(strike.power);
      const desired = Vec2((dx >= 0 ? 1 : -1) * speed, -speed * 0.2);
      const current = e.body.getLinearVelocity();
      const mass = e.body.getMass();
      e.hitByPlayer(Vec2((desired.x - current.x) * mass, (desired.y - current.y) * mass));
      strike.hitExecuters.add(e);
    }
  }

  /** Two nearly simultaneous swings beside the net trap and redirect the ball. */
  private tryCounter(): boolean {
    const left = this.strikes[1];
    const right = this.strikes[2];
    if (!left || !right || this.counter || this.ball.held || this.ball.ballOfPlayer !== 0) return false;
    if (left.opponentHit || right.opponentHit || left.ballHit || right.ballHit) return false;
    if (Math.abs(left.frame - right.frame) > SWING.counterWindowFrames) return false;
    if (this.frame - left.frame > SWING.counterWindowFrames || this.frame - right.frame > SWING.counterWindowFrames) return false;
    const net = toM(NET_X_PX);
    const ball = this.ball.position;
    if (Math.abs(ball.x - net) > toM(SWING.counterBallRangePx)) return false;
    const head1 = this.p1.head.getWorldCenter();
    const head2 = this.p2.head.getWorldCenter();
    if (Math.abs(head1.x - net) > toM(SWING.counterNetRangePx)) return false;
    if (Math.abs(head2.x - net) > toM(SWING.counterNetRangePx)) return false;
    const midY = (head1.y + head2.y) / 2;
    if (Math.abs(ball.y - midY) > toM(SWING.counterBallHeightPx)) return false;

    const direction: 1 | -1 = left.power === right.power
      ? (this.ball.velocity.x >= 0 ? -1 : 1)
      : (left.power > right.power ? 1 : -1);
    this.counter = { framesLeft: SWING.counterHoldFrames, direction };
    this.counterEffect = { frame: this.frame, power: Math.max(left.power, right.power) };
    return true;
  }

  private advanceCounter(): void {
    if (!this.counter) return;
    this.counter.framesLeft -= 1;
    if (this.counter.framesLeft > 0) {
      this.ball.body.setLinearVelocity(Vec2(0, 0));
    } else {
      this.ball.body.setLinearVelocity(Vec2(
        this.counter.direction * SWING.counterBallSpeedX,
        SWING.counterBallSpeedY,
      ));
      this.counter = null;
    }
  }

  /** The CPU visibly answers a charge near the net if it had time to prepare. */
  private updateAiCounter(): void {
    if (!this.ai || this.ai.DisableAI || this.game.phase !== 'play' || this.ball.ballOfPlayer !== 0) {
      this.aiCounterWindupFrames = 0;
      return;
    }
    const net = toM(NET_X_PX);
    const midY = (this.p1.head.getWorldCenter().y + this.p2.head.getWorldCenter().y) / 2;
    const nearNet = Math.abs(this.p1.head.getWorldCenter().x - net) < toM(SWING.counterNetRangePx)
      && Math.abs(this.p2.head.getWorldCenter().x - net) < toM(SWING.counterNetRangePx)
      && Math.abs(this.ball.position.x - net) < toM(SWING.counterBallRangePx)
      && Math.abs(this.ball.position.y - midY) < toM(SWING.counterBallHeightPx);
    if (!nearNet) {
      this.aiCounterWindupFrames = 0;
      return;
    }
    const humanCharge = this.control.chargeLevel(1);
    if (humanCharge) {
      this.aiCounterWindupFrames = Math.min(this.aiCounterWindupFrames + 1, CHARGE.maxFrames);
      this.p2.windUpArm(Math.min(humanCharge.power, 0.8));
      return;
    }
    const humanStrike = this.strikes[1];
    if (humanStrike?.frame === this.frame && this.aiCounterWindupFrames >= 4) {
      this.swing(this.p2, Math.min(0.8, this.aiCounterWindupFrames / CHARGE.maxFrames));
    }
    this.aiCounterWindupFrames = 0;
  }

  /** The dive grants one assisted touch if a hand or head reaches the ball. */
  private resolveRescueTouches(): void {
    if (this.game.phase !== 'play' || this.ball.ballOfPlayer !== 0 || this.ball.held || this.flags.onBallDown) return;
    for (const player of [this.p1, this.p2]) {
      if (this.frame > this.rescueActiveUntil[player.id] || this.ball.velocity.y <= 0) continue;
      const ball = this.ball.position;
      if (player.id === 1 ? ball.x > toM(NET_X_PX) : ball.x < toM(NET_X_PX)) continue;
      const reached = [player.head, player.servingFinger, player.strikingFinger].some(
        (part) => Vec2.sub(part.getWorldCenter(), ball).length() < toM(65),
      );
      if (!reached) continue;
      if (this.game.registerRescueTouch(player)) {
        this.rescueActiveUntil[player.id] = -1;
        this.rescueEffects[player.id] = { frame: this.frame, success: true };
      }
    }
  }

  /** A near, forward-facing opponent receives one charge-scaled knockback. */
  private hitOpponent(attackerId: PlayerId, power: number): boolean {
    const attacker = attackerId === 1 ? this.p1 : this.p2;
    const defender = attackerId === 1 ? this.p2 : this.p1;
    const sign = attackerId === 1 ? 1 : -1;
    const from = attacker.head.getWorldCenter();
    const target = defender.tors.getWorldCenter();
    const forward = sign * (target.x - from.x);
    if (forward <= 0 || forward > toM(SWING.opponentReachPx)) return false;
    if (Math.abs(target.y - from.y) > toM(SWING.opponentHeightPx)) return false;

    const scale = powerScale(power);
    const impulse = Vec2(sign * SWING.opponentImpulseX * scale, SWING.opponentImpulseY * scale);
    defender.head.applyLinearImpulse(impulse, defender.head.getWorldCenter(), true);
    defender.ass.applyLinearImpulse(impulse, defender.ass.getWorldCenter(), true);
    this.opponentHitEffects[defender.id] = { frame: this.frame, power };
    return true;
  }

  /** A local, gentle pull that makes a charged swing easier to connect. */
  private attractBallDuringWindup(): void {
    if (this.game.phase !== 'play' || this.ball.ballOfPlayer !== 0 || this.ball.held || this.counter) return;
    const radius = toM(CHARGE.attractRadiusPx);
    for (const player of [this.p1, this.p2]) {
      const power = this.control.chargeLevel(player.id)?.power ?? 0;
      if (power <= 0 || power >= 1) continue;
      const ballPos = this.ball.position;
      const delta = Vec2.sub(player.strikingFinger.getWorldCenter(), ballPos);
      const distance = delta.length();
      if (distance < 0.001 || distance >= radius) continue;
      const impulse = CHARGE.attractImpulse * power * (1 - distance / radius) / distance;
      this.ball.body.applyLinearImpulse(Vec2.mul(delta, impulse), ballPos, true);
    }
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
      kind: button.launches === 0 ? 'head' : 'ball',
      origin: button.launchPoint(),
      speed: mine ? OPTIONS.myExSpeed : OPTIONS.compExSpeed,
      lifeSeconds: mine ? OPTIONS.myExLife : OPTIONS.compExLife,
      tuning: this.executerTuning,
      // Its button pops back out once its last executer dies.
      onDeath: (e) => button.executerDied(e, this.frame),
    });
    button.launches += 1;
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
