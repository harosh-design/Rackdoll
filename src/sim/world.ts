import { Vec2, World } from 'planck';
import { AI } from './ai';
import { Ball } from './ball';
import { Bees } from './bees';
import {
  CHARGE, EXECUTER, EXECUTER_ITERATIONS, FEATHER, FLIP, GRAVITY, ITERATIONS, LANDING_CENTRE_M,
  MS_PER_FRAME, OPTIONS, PRIZE_ANIM, NET_X_PX, powerScale,
  SERVE_CENTRE_M, SPAWN_P1_PX, SPAWN_P2_PX, SWING, toM, toPx,
} from './constants';
import { Control, type KeyBindings } from './control';
import { installContactListener, installContactTweaks, type ContactFlags } from './contacts';
import { Executer, type ExecuterTuning } from './executer';
import { ExecuterQueue, seededRandom, type ExecuterId, type ExecuterVariant } from './executerVariants';
import { Game, type GameEvents } from './game';
import { Ground } from './ground';
import { Player, type PlayerId } from './player';
import { PowerUps, type PowerId } from './powerUps';
import type { PrizeButton } from './prizeButton';
import { FrameTimer, TimerSet } from './timer';

export interface GameWorldOptions {
  /** Single player puts an AI on player 2. */
  singlePlayer?: boolean;
  /** Both sides are driven by the AI; the keyboard only pauses. */
  botVsBot?: boolean;
  /** Campaign level 1..6: how well the CPU plays; level 6 is the champion. */
  level?: number;
  /** Bot vs bot: player 1's level. Player 2 plays at `level`. */
  p1Level?: number;
  /** Hazards on/off. Off, a button still clicks but launches nothing. */
  hazards?: boolean;
  /** Override executer physics, for tuning and tests. */
  executerTuning?: Partial<ExecuterTuning>;
  /** Solver iterations on frames where an executer is touching a doll. */
  contactIterations?: number;
  /** Seed for the hazard order and the boxer's aim. */
  executerSeed?: number;
  /** A fixed, repeating hazard order instead of the shuffle, for tuning and tests. */
  executerOrder?: readonly ExecuterId[];
  /** Physical keyboard bindings for each human player. */
  bindings?: KeyBindings;
  /** Bees fly in now and then with a power for whoever hits one with the ball. On by default. */
  bees?: boolean;
  /** Seed for when bees come, where they fly and what they carry. */
  beeSeed?: number;
  /** A fixed, repeating order of bee powers instead of the shuffle, for tests. */
  beeOrder?: readonly PowerId[];
  /** Seed for the CPU players' choices (when to set, jump or smash, their aim). */
  aiSeed?: number;
  events?: GameEvents;
}

interface Strike {
  frame: number;
  power: number;
  strength: number;
  /** The attacker's head at take-off: the kick wave is measured from here. */
  origin: Vec2;
  ballHit: boolean;
  opponentHit: boolean;
  hitExecuters: Set<Executer>;
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
  readonly powerUps: PowerUps;
  readonly bees: Bees;
  readonly game: Game;
  readonly control: Control;
  /** The AI driving each side, or null for a human. */
  readonly ais: Record<PlayerId, AI | null>;
  readonly timers = new TimerSet();
  readonly flags: ContactFlags = { onBallDown: false, bYesPrize: false, prizeHits: [], ballPlayerHits: [], playerHeadHits: [] };
  readonly executers: Executer[] = [];
  /** Total hazard launches this match, shared by both buttons. */
  executerLaunches = 0;
  /** What comes out of the next button hit, and after it: one order for both buttons. */
  readonly executerQueue: ExecuterQueue;
  /** The last launch, for the HUD's queue animation. */
  executerLaunchEffect: { frame: number; variant: ExecuterVariant | null } = { frame: -100, variant: null };
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
  /**
   * The ball wears the colour of whoever touched or holds it: `player` now,
   * `previous` before the change at `frame`. 0 is the plain white ball.
   */
  ballTint: { player: 0 | PlayerId; previous: 0 | PlayerId; frame: number } = { player: 0, previous: 0, frame: -100 };

  /** Frames simulated since construction. */
  frame = 0;
  paused = false;
  readonly singlePlayer: boolean;
  readonly botVsBot: boolean;
  /** Bot vs bot: player 1's level (player 2's is game.level). */
  readonly p1Level: number;
  readonly hazards: boolean;
  private readonly executerTuning?: Partial<ExecuterTuning>;
  private readonly contactIterations: number;
  private readonly executerRandom: () => number;
  private readonly strikes: Record<PlayerId, Strike | null> = {
    1: null, 2: null,
  };
  private counter: { framesLeft: number; direction: 1 | -1 } | null = null;
  private readonly aiCounterWindupFrames: Record<PlayerId, number> = { 1: 0, 2: 0 };
  private readonly nextSwingFrame: Record<PlayerId, number> = { 1: 0, 2: 0 };

  constructor(opts: GameWorldOptions = {}) {
    this.control = new Control(opts.bindings);
    this.botVsBot = opts.botVsBot ?? false;
    this.singlePlayer = !this.botVsBot && (opts.singlePlayer ?? true);
    this.p1Level = opts.p1Level ?? opts.level ?? OPTIONS.currentLevel;
    this.hazards = opts.hazards ?? true;
    this.executerTuning = opts.executerTuning;
    this.contactIterations = opts.contactIterations ?? EXECUTER_ITERATIONS;
    this.executerRandom = seededRandom(opts.executerSeed ?? 0x2545f491);
    this.executerQueue = new ExecuterQueue(this.executerRandom, opts.executerOrder);

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
    this.powerUps = new PowerUps({ 1: this.p1, 2: this.p2 });
    this.bees = new Bees(this.powerUps, seededRandom(opts.beeSeed ?? 0x5bd1e995), opts.bees ?? true, opts.beeOrder);

    installContactListener(this.world, this.flags);
    installContactTweaks(this.world);

    const events: GameEvents = {
      ...opts.events,
      onPoint: (winner, reason) => {
        this.strikes[1] = this.strikes[2] = null;
        this.counter = null;
        opts.events?.onPoint?.(winner, reason);
      },
      onNewRound: () => {
        this.ais[1]?.reset();
        this.ais[2]?.reset();
        this.strikes[1] = this.strikes[2] = null;
        this.counter = null;
        this.aiCounterWindupFrames[1] = this.aiCounterWindupFrames[2] = 0;
        // Every round starts with both hands' swing ready.
        this.nextSwingFrame[1] = this.nextSwingFrame[2] = 0;
        // The dolls were just re-stood: glue between parts now far apart
        // would yank them back together, so any slime lets go.
        for (const e of this.executers) e.shakeOff();
        opts.events?.onNewRound?.();
      },
      onResetMatch: () => {
        this.powerUps.reset();
        this.bees.reset();
        this.clearExecuters();
        this.executerLaunches = 0;
        this.executerQueue.reset();
        for (const button of this.ground.prizeButtons) button.launches = 0;
        opts.events?.onResetMatch?.();
      },
    };

    this.game = new Game(
      this.world, this.timers, this.p1, this.p2, this.ball, this.flags, events,
    );
    if (opts.level != null) this.game.level = opts.level;

    const aiSeed = opts.aiSeed ?? 0x51f15e;
    const bot = (p: Player) => new AI(p, this.ball,
      (q) => this.serve(q), (q, power) => this.swing(q, power), this.canSwing,
      p === this.p1 ? this.p2 : this.p1, seededRandom(aiSeed ^ Math.imul(p.id, 0x9e3779b9)));
    this.ais = {
      1: this.botVsBot ? bot(this.p1) : null,
      2: this.botVsBot || this.singlePlayer ? bot(this.p2) : null,
    };
  }

  /** The single-player opponent, i.e. player 2's AI. */
  get ai(): AI | null {
    return this.ais[2];
  }

  isCpu(id: PlayerId): boolean {
    return this.ais[id] !== null;
  }

  /** The campaign level a side's AI plays at. */
  levelOf(id: PlayerId): number {
    return id === 1 && this.botVsBot ? this.p1Level : this.game.level;
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

  swingCooldownFramesLeft(id: PlayerId): number {
    return Math.max(0, this.nextSwingFrame[id] - this.frame);
  }

  canSwing = (player: Player): boolean => this.swingCooldownFramesLeft(player.id) === 0;

  /** Not in the original: the rally flip, routed the same way as serve(). */
  swing = (player: Player, power = 1): boolean => {
    if (!this.canSwing(player) || this.game.phase !== 'play' || this.ball.ballOfPlayer !== 0) return false;
    if (!player.flip()) return false;
    this.swingEffects[player.id] = { frame: this.frame, power };
    this.strikes[player.id] = {
      frame: this.frame, power, strength: powerScale(power) * player.controlScale,
      origin: player.head.getWorldCenter().clone(),
      ballHit: false, opponentHit: false, hitExecuters: new Set(),
    };
    this.nextSwingFrame[player.id] = this.frame + SWING.cooldownFrames;
    return true;
  };

  /**
   * §3 One frame, in the original's order. Input lands one step late because
   * the controls run AFTER the step — that is faithful, not an oversight.
   */
  step(): void {
    if (this.paused) return;
    this.p1.tickRecoil();
    this.p2.tickRecoil();
    this.p1.tickStun();
    this.p2.tickStun();
    // Before the step, so the solver settles each size change straight away.
    this.p1.tickSize();
    this.p2.tickSize();

    // 1. The physics. 1/28 s once per 30 fps frame (§1.3).
    const dt = this.game.timeStep * (
      this.game.phase === 'play' && this.control.isChargingSwing() ? CHARGE.windupTimeScale : 1
    );
    this.applyFeather();
    // The original's 10 iterations everywhere, except while an executer is at
    // a doll: a 0.07 kg hand hitting a 6 kg ball is badly conditioned, and at
    // 10 iterations the joints visibly stretch.
    const it = this.executerNearDoll() ? this.contactIterations : ITERATIONS;
    this.world.step(dt, it, it);
    this.p1.tickFlip();
    this.p2.tickFlip();

    // 1b. A button hit during that step launches its executer now — the
    //     earliest moment, since bodies can't be created mid-step.
    this.pressPrizeButtons();

    // 2. (The renderer syncs sprites here; it reads bodies directly instead.)

    // 3. Controls, for each human player.
    for (const p of [this.p1, this.p2]) {
      if (!this.isCpu(p.id)) this.control.update(p, this.serve, this.swing, this.canSwing);
    }
    this.resolveStrikes();
    this.advanceCounter();
    this.attractBallDuringWindup();

    // 4. Rules.
    this.game.update();
    this.updateBallTint();
    this.powerUps.tick(this.frame);
    this.applyMagnetPower();
    // A ball meeting a bee gives its power to whoever holds it or touched it last.
    this.bees.update(dt, this.frame, this.game.phase === 'play',
      { xPx: toPx(this.ball.position.x), yPx: toPx(this.ball.position.y) }, this.game.ballOwner);

    // 5. AI, on every CPU side.
    for (const id of [1, 2] as const) {
      const ai = this.ais[id];
      if (!ai) continue;
      ai.level = this.levelOf(id);
      ai.update();
      this.updateAiCounter(id);
    }

    // 6. Hazards. The magnet bends the ball only while it is free and in play.
    const freeBall = this.game.phase === 'play' && !this.ball.held && this.ball.ballOfPlayer === 0
      ? this.ball.body : null;
    for (const e of this.executers) e.update(dt, freeBall);

    // 7. The ball's speed clamps, last.
    this.ball.update();

    this.timers.step();
    this.frame += 1;
  }

  private updateBallTint(): void {
    const owner = this.game.ballOwner;
    if (owner !== null && owner !== this.ballTint.player) {
      this.ballTint = { player: owner, previous: this.ballTint.player, frame: this.frame };
    }
  }

  /** Resolve simultaneous counters before individual ball and player hits. */
  private resolveStrikes(): void {
    const contacts = this.flags.ballPlayerHits;
    const headHits = this.flags.playerHeadHits;
    if (this.game.phase !== 'play') {
      this.strikes[1] = this.strikes[2] = null;
      if (contacts) contacts.length = 0;
      if (headHits) headHits.length = 0;
      return;
    }

    if (this.tryCounter()) {
      this.strikes[1] = this.strikes[2] = null;
      if (contacts) contacts.length = 0;
      if (headHits) headHits.length = 0;
      return;
    }

    for (const hit of headHits ?? []) {
      const strike = this.strikes[hit.attackerId];
      if (!strike || strike.opponentHit || !this.strikeLive(hit.attackerId, strike)) continue;
      const attacker = hit.attackerId === 1 ? this.p1 : this.p2;
      if (!attacker.isStrikingPart(hit.part)) continue;
      this.applyOpponentHit(hit.attackerId, strike.power, strike.strength, true);
      strike.opponentHit = true;
    }
    if (headHits) headHits.length = 0;

    for (const contact of contacts ?? []) {
      const strike = this.strikes[contact.playerId];
      if (!strike || strike.ballHit || this.ball.ballOfPlayer !== 0) continue;
      if (!(contact.playerId === 1 ? this.p1 : this.p2).isStrikingPart(contact.part)) continue;
      if (!this.strikeLive(contact.playerId, strike)) continue;
      // The legs met the ball on the way round: kick it over, harder with more charge.
      strike.ballHit = true;
      const sign = contact.playerId === 1 ? 1 : -1;
      const scale = strike.strength;
      this.ball.body.setLinearVelocity(Vec2(sign * FLIP.kickSpeedX * scale, FLIP.kickSpeedY * scale));
      this.perfectEffects[contact.playerId] = { frame: this.frame, power: strike.power };
    }
    if (contacts) contacts.length = 0;

    for (const id of [1, 2] as const) {
      const strike = this.strikes[id];
      if (!strike) continue;
      if (!this.strikeLive(id, strike)) {
        this.strikes[id] = null;
      } else {
        this.hitExecuters(id, strike);
        const attacker = id === 1 ? this.p1 : this.p2;
        if (attacker.flipProgress * Math.PI * 2 >= FLIP.opponentFromRad && !strike.opponentHit) {
          strike.opponentHit = this.hitOpponent(id, strike);
        }
      }
    }
  }

  /** A strike lasts as long as its flip, and at least the frame it began. */
  private strikeLive(id: PlayerId, strike: Strike): boolean {
    const age = this.frame - strike.frame;
    if (age < 0) return false;
    return age === 0 || (id === 1 ? this.p1 : this.p2).flipping;
  }

  /**
   * A flip must meet an executer with the legs to knock it back. Slime glued
   * to the flipper is spun off whatever it is stuck to.
   */
  private hitExecuters(
    attackerId: PlayerId,
    strike: Strike,
  ): void {
    const attacker = attackerId === 1 ? this.p1 : this.p2;
    const legs = FLIP.strikingParts.map((name) => attacker.part(name));
    const origin = attacker.head.getWorldCenter();
    for (const e of this.executers) {
      if (e.dead || !e.solid || e.target !== attacker || strike.hitExecuters.has(e)) continue;
      let touched = e.phase === 'stuck';
      for (let edge = e.body.getContactList(); edge && !touched; edge = edge.next) {
        if (edge.contact.isTouching() && edge.other && legs.includes(edge.other)) {
          touched = true;
          break;
        }
      }
      if (!touched) continue;
      const c = e.body.getWorldCenter();
      const dx = c.x - origin.x;
      const speed = SWING.executerKnockSpeed * strike.strength;
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

    const direction: 1 | -1 = left.strength === right.strength
      ? (this.ball.velocity.x >= 0 ? -1 : 1)
      : (left.strength > right.strength ? 1 : -1);
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

  /** The CPU visibly answers a human's charge near the net if it had time to prepare. */
  private updateAiCounter(id: PlayerId): void {
    const ai = this.ais[id];
    const cpu = id === 1 ? this.p1 : this.p2;
    const humanId: PlayerId = id === 1 ? 2 : 1;
    if (!ai || ai.DisableAI || this.isCpu(humanId) || !this.canSwing(cpu) ||
        this.game.phase !== 'play' || this.ball.ballOfPlayer !== 0) {
      this.aiCounterWindupFrames[id] = 0;
      return;
    }
    const net = toM(NET_X_PX);
    const midY = (this.p1.head.getWorldCenter().y + this.p2.head.getWorldCenter().y) / 2;
    const nearNet = Math.abs(this.p1.head.getWorldCenter().x - net) < toM(SWING.counterNetRangePx)
      && Math.abs(this.p2.head.getWorldCenter().x - net) < toM(SWING.counterNetRangePx)
      && Math.abs(this.ball.position.x - net) < toM(SWING.counterBallRangePx)
      && Math.abs(this.ball.position.y - midY) < toM(SWING.counterBallHeightPx);
    if (!nearNet) {
      this.aiCounterWindupFrames[id] = 0;
      return;
    }
    const humanCharge = this.control.chargeLevel(humanId);
    if (humanCharge) {
      this.aiCounterWindupFrames[id] = Math.min(this.aiCounterWindupFrames[id] + cpu.controlScale, CHARGE.maxFrames);
      cpu.windUp(Math.min(humanCharge.power, 0.8));
      return;
    }
    const humanStrike = this.strikes[humanId];
    if (humanStrike?.frame === this.frame && this.aiCounterWindupFrames[id] >= 4) {
      this.swing(cpu, Math.min(0.8, this.aiCounterWindupFrames[id] / CHARGE.maxFrames));
    }
    this.aiCounterWindupFrames[id] = 0;
  }

  /** A near, forward-facing opponent receives one charge-scaled knockback. */
  private hitOpponent(attackerId: PlayerId, strike: Strike): boolean {
    const defender = attackerId === 1 ? this.p2 : this.p1;
    const sign = attackerId === 1 ? 1 : -1;
    // From where the flip took off: the head itself swings back and down.
    const from = strike.origin;
    const target = defender.tors.getWorldCenter();
    const forward = sign * (target.x - from.x);
    const bodyHit = forward > 0 && forward <= toM(SWING.opponentReachPx)
      && Math.abs(target.y - from.y) <= toM(SWING.opponentHeightPx);
    const head = defender.head.getWorldCenter();
    const headForward = sign * (head.x - from.x);
    const headHit = headForward > 0 && headForward <= toM(SWING.opponentReachPx)
      && Math.abs(head.y - from.y) <= toM(SWING.opponentHeadHeightPx) + defender.head.getFixtureList()!.getShape().getRadius();
    if (!bodyHit && !headHit) return false;
    this.applyOpponentHit(attackerId, strike.power, strike.strength, headHit);
    return true;
  }

  private applyOpponentHit(attackerId: PlayerId, power: number, strength: number, headHit: boolean): void {
    const defender = attackerId === 1 ? this.p2 : this.p1;
    if (defender.power === 'shield') return;
    const sign = attackerId === 1 ? 1 : -1;
    const impulse = Vec2(sign * SWING.opponentImpulseX * strength, SWING.opponentImpulseY * strength);
    defender.head.applyLinearImpulse(impulse, defender.head.getWorldCenter(), true);
    defender.ass.applyLinearImpulse(impulse, defender.ass.getWorldCenter(), true);
    this.opponentHitEffects[defender.id] = { frame: this.frame, power };
    if (headHit) defender.stun();
  }

  /** A local, gentle pull that makes a charged flip easier to connect. */
  private attractBallDuringWindup(): void {
    if (this.game.phase !== 'play' || this.ball.ballOfPlayer !== 0 || this.ball.held || this.counter) return;
    const radius = toM(CHARGE.attractRadiusPx);
    for (const player of [this.p1, this.p2]) {
      const charge = this.control.chargeLevel(player.id);
      if (!charge || charge.power <= 0 || charge.power >= 1) continue;
      const ballPos = this.ball.position;
      const delta = Vec2.sub(player.kickPoint, ballPos);
      const distance = delta.length();
      if (distance < 0.001 || distance >= radius) continue;
      const impulse = CHARGE.attractImpulse * charge.power * player.controlScale * (1 - distance / radius) / distance;
      this.ball.body.applyLinearImpulse(Vec2.mul(delta, impulse), ballPos, true);
    }
  }

  /**
   * Feather ball: a free ball over a feathered player's half falls at a
   * fraction of gravity, giving them longer to reach it. Set before the step.
   */
  private applyFeather(): void {
    let scale = 1;
    if (this.game.phase === 'play' && this.ball.ballOfPlayer === 0 && !this.ball.held) {
      const owner = this.ball.position.x < LANDING_CENTRE_M ? this.p1 : this.p2;
      if (owner.power === 'feather') scale = FEATHER.gravityScale;
    }
    this.ball.body.setGravityScale(scale);
  }

  /** Who the feather ball is slowing right now, for the renderer. */
  get featherSide(): PlayerId | null {
    if (this.ball.body.getGravityScale() === 1) return null;
    return this.ball.position.x < LANDING_CENTRE_M ? 1 : 2;
  }

  /** The magnet pulls a free ball toward the player's hands within 140 px. */
  private applyMagnetPower(): void {
    if (this.game.phase !== 'play' || this.ball.held || this.ball.ballOfPlayer !== 0) return;
    const radius = toM(140);
    for (const player of [this.p1, this.p2]) {
      if (player.power !== 'magnet') continue;
      const ballPos = this.ball.position;
      const left = player.part('FingerLeft').getWorldCenter();
      const right = player.part('FingerRight').getWorldCenter();
      const target = Vec2.distance(left, ballPos) < Vec2.distance(right, ballPos) ? left : right;
      const delta = Vec2.sub(target, ballPos);
      const distance = delta.length();
      if (distance < 0.01 || distance >= radius) continue;
      const strength = 0.028 * (1 - distance / radius) / distance;
      this.ball.body.applyLinearImpulse(Vec2.mul(delta, strength), ballPos, true);
    }
  }

  /**
   * Is any live executer within reach of a doll? Checked before the step, so
   * the frame of first impact already gets the extra solver iterations.
   */
  executerNearDoll(): boolean {
    const reach = toM(EXECUTER.radiusPx + EXECUTER.nearMarginPx);
    for (const e of this.executers) {
      // A stuck slime is a sensor riding on the doll: no contact to solve.
      // Measured: 20 iterations on a doll that is merely standing creeps it
      // sideways ~10 px a second.
      if (e.dead || !e.solid || e.phase === 'stuck') continue;
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
    const variant = this.executerQueue.next();
    // "my" is the executer player 1 earned (it lands on player 2), "comp" the other.
    const mine = button.side === 2;
    const ex = new Executer({
      world: this.world,
      timers: this.timers,
      target,
      side: button.side,
      variant,
      origin: button.launchPoint(),
      speed: mine ? OPTIONS.myExSpeed : OPTIONS.compExSpeed,
      lifeSeconds: mine ? OPTIONS.myExLife : OPTIONS.compExLife,
      tuning: this.executerTuning,
      random: this.executerRandom,
      // Its button pops back out once its last executer dies.
      onDeath: (e) => button.executerDied(e, this.frame),
    });
    button.launches += 1;
    this.executerLaunches += 1;
    this.executerLaunchEffect = { frame: this.frame, variant };
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
