import { Vec2, type Vec2Value } from 'planck';
import {
  BALL, BALL_VX_SCALE_WALL, BOT, botSkill, type BotSkill, DEG, FEATHER, FLOOR_TOP_PX, GRAVITY, LANDING_CENTRE_M,
  LEFT_WALL_INNER_PX, MAX_TOUCHES, NET_BOTTOM_PX, NET_TOP_PX, NET_X_PX, OPTIONS,
  RIGHT_WALL_INNER_PX, SERVE_CENTRE_M, TIME_STEP, TOUCH_IMPULSE, toM, toPx,
} from './constants';
import type { Ball } from './ball';
import type { Player, SwingHand } from './player';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

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
 * What the bot means to do with the ball coming its way:
 * - `return`: an aimed header over the net;
 * - `set`: a header up to itself, to attack from by the net next touch;
 * - `smash`: a wound-up swing at a ball dropping in front of it;
 * - `jump`: a leap at the net, batting the ball over with the rising arm;
 * - `dig`: nothing clean is possible, so just get a touch on it.
 */
export type PlayKind = 'return' | 'set' | 'smash' | 'jump' | 'dig';

/** The bot's current intention, in its own frame (itself on the right). */
export interface ReturnPlan {
  kind: PlayKind;
  score: number;
  /** Where its head should be when the ball arrives. */
  headX: number;
  /** Frames until the ball reaches it. */
  frame: number;
  /** Header contact angle, degrees; positive puts the ball on the net side of the head. */
  deg: number;
  /** Forecast landing, metres; NaN when not forecast. */
  landX: number;
  /** How far short of that spot its head will still be, px. */
  latePx: number;
}

/** What it has in mind for the next touch, rolled whenever someone plays the ball. */
interface Intent {
  set: boolean;
  jump: boolean;
  smash: boolean;
  /** Which way, and how far (-1..1), this touch's aim is off. */
  aimUnit: number;
  /**
   * Extra aim error from how hard the ball is to play, degrees: fixed when it
   * first sizes up the ball, so a scramble stays a scramble.
   */
  pressureDeg: number | null;
}

/** A serve: walk the head here, settle, jump, and flick the ball this many frames into the jump. */
interface ServeRecipe {
  headXpx: number;
  delay: number;
  /**
   * Where it lands, px past the net, serving as player 1 and as player 2.
   * The court and the serving hand are not quite mirror images.
   */
  landPx: readonly [number, number];
}

/**
 * Serves measured through serveRoutine(): each landed on the far side every
 * time, from either side and at every level. Short drops to deep corners.
 */
const SERVES: readonly ServeRecipe[] = [
  { headXpx: 580, delay: 22, landPx: [83, 139] },
  { headXpx: 580, delay: 10, landPx: [179, 244] },
  { headXpx: 460, delay: 4, landPx: [212, 284] },
  { headXpx: 520, delay: 16, landPx: [216, 305] },
  { headXpx: 640, delay: 22, landPx: [286, 368] },
  { headXpx: 460, delay: 16, landPx: [328, 374] },
  { headXpx: 520, delay: 10, landPx: [339, 365] },
  { headXpx: 400, delay: 28, landPx: [406, 402] },
  { headXpx: 400, delay: 16, landPx: [489, 438] },
];

/**
 * The CPU player. Written, as in the original, for player 2 on the right.
 * Driving player 1 it sees the court mirrored about the net: positions go
 * through mx() on the way in and pushes through side() on the way out.
 *
 * Each frame it forecasts the ball's flight, finds where it will come down on
 * its head, and weighs every way to play it: each header angle as a shot
 * scored by how hard it is to answer, each as a set scored by the best attack
 * it allows, and on a ball up at the net a jump or a smash. Its level
 * (BOT_LEVELS) sets how fast, how accurate and how bold it is. Same physics
 * and touch rules as a human player.
 */
export class AI {
  DisableAI = false;
  /** Campaign level 1..6: picks its skill. Set by the world every frame. */
  level: number = OPTIONS.currentLevel;
  /** The plan this frame, for tests and debugging. */
  plan: ReturnPlan | null = null;

  private readonly computer: Player;
  private readonly ball: Ball;
  private readonly serve: (p: Player) => void;
  private readonly swing: (p: Player, power: number, hand: SwingHand) => void;
  private readonly canSwing: (p: Player) => boolean;
  private readonly random: () => number;
  /** True when driving player 1, whose court is the mirror image. */
  private readonly flip: boolean;

  private intent: Intent = { set: false, jump: false, smash: false, aimUnit: 0, pressureDeg: null };
  /** Both players' touch counts last frame: any change means someone played the ball. */
  private touchKey = '';
  /** Frames left before it reacts to the opponent's touch. */
  private reactLeft = 0;
  /** Where it was heading before the touch, kept while it reacts. */
  private lastTargetX: number | null = null;
  private readyOffsetPx = 0;
  private windupFrames = 0;
  /** Its misjudgement of the opponent's last shot, m/s, and frames since that shot. */
  private readBias = 0;
  private readClock = 0;
  private serving: { recipe: ServeRecipe; frames: number; jumpedAt: number; still: number } | null = null;

  constructor(
    computer: Player,
    ball: Ball,
    serve: (p: Player) => void,
    swing: (p: Player, power: number, hand: SwingHand) => void = () => {},
    canSwing: (p: Player) => boolean = () => true,
    private readonly opponent: Player | null = null,
    random: () => number = Math.random,
  ) {
    this.computer = computer;
    this.ball = ball;
    this.serve = serve;
    this.swing = swing;
    this.canSwing = canSwing;
    this.random = random;
    this.flip = computer.id === 1;
  }

  get skill(): BotSkill {
    return botSkill(this.level);
  }

  /** What a ball that does not go over costs it: a bold player shrugs off the risk. */
  private get failValue(): number {
    return BOT.failValue * (1 - BOT.riskAppetite * this.skill.aggression);
  }

  update(): void {
    if (this.DisableAI) return;
    const c = this.computer;
    this.plan = null;

    if (this.ball.ballOfPlayer === c.id) {
      this.serveRoutine();
      return;
    }
    this.serving = null;
    if (this.ball.ballOfPlayer !== 0) {
      // The opponent is about to serve.
      this.windupFrames = 0;
      this.steer(this.readyX());
      return;
    }

    this.noticeTouches();
    this.readClock += 1;
    if (c.contact >= MAX_TOUCHES) {
      // A fourth touch loses the point outright; let the ball go.
      this.dodge();
      return;
    }
    if (this.reactLeft > 0) {
      // Still reading the opponent's shot: carry on as before.
      this.reactLeft -= 1;
      this.steer(this.lastTargetX ?? this.readyX());
      return;
    }

    const plan = this.choosePlan();
    this.plan = plan;
    if (!plan) {
      this.windupFrames = 0;
      this.lastTargetX = this.readyX();
      this.steer(this.lastTargetX);
      return;
    }
    this.lastTargetX = plan.headX;
    this.execute(plan);
  }

  reset(): void {
    this.plan = null;
    this.serving = null;
    this.touchKey = '';
    this.reactLeft = 0;
    this.lastTargetX = null;
    this.windupFrames = 0;
    this.rollIntent();
  }

  // ---------------------------------------------------------------------------
  // Reading the rally

  /**
   * A change in either touch count means the ball was just played. After the
   * opponent's touch it takes its level's reaction time to respond. Either
   * way it decides afresh how to play the next touch.
   */
  private noticeTouches(): void {
    const theirs = this.opponent?.contact ?? 0;
    const key = `${this.computer.contact}:${theirs}`;
    if (key === this.touchKey) return;
    const wasTheirs = this.touchKey !== '' && theirs > 0;
    this.touchKey = key;
    this.readClock = 0;
    this.readBias = 0;
    if (wasTheirs) {
      this.reactLeft = this.skill.reactFrames;
      this.readBias = (this.random() + this.random() - 1) * this.skill.readErrMs;
    }
    this.rollIntent();
  }

  private rollIntent(): void {
    const k = this.skill;
    this.intent = {
      set: this.random() < k.setChance,
      jump: this.random() < k.jumpChance,
      smash: this.random() < k.smashChance,
      aimUnit: this.random() + this.random() - 1,
      pressureDeg: null,
    };
    this.readyOffsetPx = (this.random() * 2 - 1) * k.readyJitterPx;
  }

  /** The next touch: an attack on a ball up at the net if it fancies one, else the best header. */
  private choosePlan(): ReturnPlan | null {
    const c = this.computer;
    const samples = this.forecast();
    const s = c.sizeScale;
    const reach = toM(BOT.headRadiusPx * s + BALL.radiusPx);
    const ourSide = toM(NET_X_PX + BALL.radiusPx);
    const sample = samples.find((q) => this.mx(q.x) > ourSide && q.vy > 0 && q.y >= this.restY(s) - reach);
    if (!sample) return null;

    if (this.attackable(sample)) {
      const attack = (this.intent.smash && this.canSwing(c) ? this.planSmash(samples) : null)
        ?? (this.intent.jump ? this.planJump(samples) : null);
      if (attack) return attack;
    }

    const headX = this.mx(c.head.getWorldCenter().x);
    const { shot, set, dig } = this.weigh(sample, this.spin(), headX, BOT.angleStepDeg, c.contact <= 1);
    let choice = shot;
    // A set by the net when it fancies building an attack, or when it beats any shot.
    if (set && (!shot || set.score > shot.score - (this.intent.set ? BOT.setTolerance : 0))) choice = set;
    // Nothing goes over cleanly: keep it up on its own side for another go.
    choice ??= dig;
    if (!choice) {
      // Nothing clears the net from here: get under it anyway, net side of
      // the head, and let the next touch try again.
      const bx = this.mx(sample.x);
      return {
        kind: 'dig', score: -Infinity, headX: clamp(bx + reach * 0.5, toM(BOT.minHeadXpx), this.maxHeadX()),
        frame: sample.frame, deg: 30, landX: NaN, latePx: 0,
      };
    }
    // Its aim is only as good as its level, and worse on a ball it has to scramble for.
    this.intent.pressureDeg ??= this.pressure(sample, Math.abs(choice.headX - headX));
    const error = this.intent.aimUnit * (this.skill.aimErrorDeg + this.intent.pressureDeg);
    const bx = choice.headX - reach * Math.sin(choice.deg * DEG);
    const aimed = clamp(bx + reach * Math.sin((choice.deg + error) * DEG), toM(BOT.minHeadXpx), this.maxHeadX());
    return { ...choice, headX: aimed };
  }

  /**
   * How much a hard ball throws its aim, degrees: a fast, flat ball, or one
   * it has to sprint for (`travel` metres in the time left) is harder to
   * place than a ball dropping onto its head. Composure shrinks it.
   */
  private pressure(sample: BallSample, travel: number): number {
    const p = BOT.pressure;
    const hurry = toPx(travel) / (this.skill.stepPx * Math.max(1, sample.frame - 2));
    const difficulty = p.drive * clamp((Math.abs(sample.vx) - p.driveFromMs) / p.driveRangeMs, 0, 1.5)
      + p.hurry * clamp((hurry - p.hurryFrom) / p.hurryRange, 0, 1.5);
    return p.deg * (1 - this.skill.composure) * difficulty;
  }

  /** A ball coming down near the net, near enough upright, can be attacked. */
  private attackable(sample: BallSample): boolean {
    return toPx(this.mx(sample.x)) - NET_X_PX < BOT.attackNetPx && Math.abs(sample.vx) < BOT.attackMaxVx;
  }

  /**
   * Every header angle, played from `sample`: the best shot over the net, and
   * (if `allowSet`) the best set to itself, valued by the best shot it then
   * has from where the set comes down.
   */
  private weigh(
    sample: BallSample,
    spin: number,
    headNow: number,
    stepDeg: number,
    allowSet: boolean,
  ): { shot: ReturnPlan | null; set: ReturnPlan | null; dig: ReturnPlan | null } {
    const c = this.computer;
    const s = c.sizeScale;
    const reach = toM(BOT.headRadiusPx * s + BALL.radiusPx);
    const bx = this.mx(sample.x);
    const bvx = this.flip ? -sample.vx : sample.vx;
    const maxTravel = toM(this.skill.stepPx) * Math.max(0, sample.frame - 2);
    const minX = toM(BOT.minHeadXpx);
    const maxX = this.maxHeadX();
    const netClear = toM(NET_TOP_PX - BALL.radiusPx - this.skill.netClearancePx);
    // Touches left after this one: without one, a ball that stays on its own side is lost.
    const spare = c.contact + 1 < MAX_TOUCHES;
    const shots: Array<{ plan: ReturnPlan; value: number }> = [];
    /** What each angle is worth if the head ends up there by mistake. */
    const outcome = new Map<number, number>();
    const sets: Array<{ plan: ReturnPlan; at: BallSample; near: number }> = [];

    for (let deg = BOT.minAngleDeg; deg <= BOT.maxAngleDeg; deg += stepDeg) {
      const out = this.bounce(bvx, sample.vy, spin, deg);
      if (!out) continue;
      const target = bx + reach * Math.sin(deg * DEG);
      // The rails stop the head short of the net and the wall.
      if (target < minX || target > maxX) continue;
      const late = Math.max(0, Math.abs(target - headNow) - maxTravel);
      const penalty = BOT.anglePenalty * Math.abs(deg) + BOT.steepPenalty * Math.max(0, Math.abs(deg) - BOT.steepFromDeg)
        + BOT.latePenaltyPerPx * toPx(late);
      const path = forecastBall(Vec2(sample.x, sample.y), Vec2(this.flip ? -out.x : out.x, out.y), 150, this.gravityScaleAt);
      const crossing = path.find((q) => this.mx(q.x) < NET_M);
      const plan = { headX: target, frame: sample.frame, deg, latePx: toPx(late) };
      const t = crossing && crossing.y <= netClear ? this.shotValue(path, crossing) : null;
      if (t) {
        // The bounce model is off by a metre or two a second, more on a
        // steep contact: a shot that only works exactly as forecast (a
        // towering lob meant to drop just over the net) is a gamble.
        const e = BOT.modelErrMs + BOT.modelErrPerDeg * Math.abs(deg);
        let value = t.score;
        for (const dir of [-1, 1]) {
          const vx = out.x + dir * e;
          const p = forecastBall(Vec2(sample.x, sample.y), Vec2(this.flip ? -vx : vx, out.y + e / 2), 150, this.gravityScaleAt);
          const cross = p.find((q) => this.mx(q.x) < NET_M);
          value += (cross && cross.y <= netClear ? this.shotValue(p, cross)?.score : undefined) ?? this.failValue;
        }
        value /= 3;
        outcome.set(deg, value);
        shots.push({ plan: { ...plan, kind: 'return', score: value - penalty, landX: t.landX }, value });
        continue;
      }
      const at = crossing ? null : this.setPoint(path, target);
      outcome.set(deg, at && spare ? BOT.recoverValue : this.failValue);
      if (at && allowSet) {
        const fromNet = toPx(this.mx(at.x)) - NET_X_PX;
        const [lo, hi] = BOT.setNearNetPx;
        const near = fromNet < lo ? fromNet / lo : clamp(1 - (fromNet - hi) / hi, 0, 1);
        const hang = BOT.setHangPenalty * Math.max(0, at.frame - BOT.setHangFrames);
        sets.push({ plan: { ...plan, kind: 'set', score: -penalty - hang, landX: NaN }, at, near });
      }
    }

    // The head arrives a few degrees off, so a shot is only as good as its
    // neighbours: one beside an angle that hits the net is a gamble.
    let shot: ReturnPlan | null = null;
    for (const { plan, value } of shots) {
      let sum = 0;
      let n = 0;
      for (let d = plan.deg - BOT.robustDeg; d <= plan.deg + BOT.robustDeg; d += stepDeg) {
        const v = outcome.get(d);
        if (v === undefined || d === plan.deg) continue;
        sum += v;
        n += 1;
      }
      const score = plan.score - value + (n ? (value + sum / n) / 2 : value);
      if (!shot || score > shot.score) shot = { ...plan, score };
    }

    // Only the few sets that come down best placed get the second look.
    sets.sort((a, b) => b.near - a.near);
    let set: ReturnPlan | null = null;
    let dig: ReturnPlan | null = null;
    for (const cand of sets.slice(0, 3)) {
      const next = this.weigh(cand.at, 0, cand.plan.headX, BOT.setAngleStepDeg, false).shot;
      const value = next ? BOT.setDiscount * next.score : this.failValue;
      const score = cand.plan.score + value + BOT.setNetBonus * cand.near;
      const plan = { ...cand.plan, score, landX: next?.landX ?? NaN };
      if (!dig || score > dig.score) dig = plan;
      if (cand.near >= BOT.setMinNear && (!set || score > set.score)) set = plan;
    }
    return { shot, set, dig };
  }

  /**
   * Where a set comes back down to its head, if it does so on its own side,
   * in reach of its rails and late enough to get there.
   */
  private setPoint(path: BallSample[], fromX: number): BallSample | null {
    const s = this.computer.sizeScale;
    const band = this.restY(s) - toM(BOT.headRadiusPx * s + BALL.radiusPx);
    const at = path.find((q) => q.vy > 0 && q.y >= band);
    if (!at || at.frame < BOT.setMinFrames) return null;
    const x = this.mx(at.x);
    if (x < toM(NET_X_PX + BALL.radiusPx) || x > this.maxHeadX()) return null;
    if (Math.abs(x - fromX) > toM(this.skill.stepPx) * (at.frame - 4)) return null;
    return at;
  }

  /**
   * How hard a shot is to answer. The opponent, read as an ordinary
   * defender, has to get their head under the ball where it comes down to
   * head height: too far to run there in time, too close to the net for
   * their rail, or pinned against their back wall all count. A timid level
   * weighs safety (net clearance) instead.
   */
  private shotValue(path: BallSample[], crossing: BallSample): { score: number; landX: number } | null {
    const end = path.at(-1)!;
    const landX = this.mx(end.x);
    if (landX > NET_M - toM(BOT.netMarginPx)) return null;
    const os = this.opponent?.sizeScale ?? 1;
    const band = this.restY(os) - toM(BOT.headRadiusPx * os + BALL.radiusPx);
    const icpt = path.find((q) => q.frame >= crossing.frame && this.mx(q.x) < NET_M && q.vy > 0 && q.y >= band) ?? end;
    const ix = toPx(this.mx(icpt.x));
    const near = NET_X_PX - BOT.oppNetGapPx;
    const far = toPx(this.mx(this.flip ? toM(RIGHT_WALL_INNER_PX) : toM(LEFT_WALL_INNER_PX))) + BOT.headRadiusPx * os + 2;
    const travel = Math.abs(clamp(ix, far, near) - toPx(this.opponentHeadX()));
    const spare = icpt.frame - BOT.oppReactFrames - travel / BOT.oppStepPx;
    const w = BOT.threat;
    const threat = w.reach * clamp(1 - spare / BOT.spareFrames, 0, 1)
      + w.deadZone * (ix > near ? 1 : 0)
      + w.deep * clamp(1 - (ix - far) / BOT.deepPx, 0, 1)
      + w.pace * clamp((90 - icpt.frame) / 50, 0, 1)
      + w.drive * clamp((Math.abs(icpt.vx) - BOT.pressure.driveFromMs) / BOT.pressure.driveRangeMs, 0, 1);
    const clearance = toPx(toM(NET_TOP_PX - BALL.radiusPx) - crossing.y);
    const safe = clamp(clearance / BOT.safeClearancePx, 0, 1);
    const a = this.skill.aggression;
    // Moonballs are dull to watch and easy to read: the higher it flies, the less it is worth.
    let apex = crossing.y;
    for (const q of path) apex = Math.min(apex, q.y);
    const hang = BOT.hangPenalty * Math.max(0, end.frame - BOT.hangFrames)
      + BOT.apexPenaltyPer100Px * Math.max(0, BOT.apexFreePx - toPx(apex)) / 100;
    return { score: a * threat + (1 - a) * 0.5 * safe - hang, landX };
  }

  /**
   * Ball velocity off a still head at contact angle `deg`, plus the touch pop,
   * in its own frame. Bounce along the normal; friction along the tangent
   * stops the contact point slipping (spin included), up to its Coulomb limit.
   */
  private bounce(bvx: number, bvy: number, spin: number, deg: number): Vec2 | null {
    const th = deg * DEG;
    // Contact normal, head centre to ball centre.
    const nx = -Math.sin(th);
    const ny = -Math.cos(th);
    const vn = bvx * nx + bvy * ny;
    if (vn >= 0) return null;
    const r = toM(BALL.radiusPx);
    const rollMass = 1 + BALL.mass * r * r / BALL.inertia;
    const pn = -(1 + BOT.headBounce) * vn;
    const tx = -ny;
    const ty = nx;
    const slip = bvx * tx + bvy * ty - spin * r;
    const pt = clamp(slip / rollMass, -BOT.headFriction * pn, BOT.headFriction * pn);
    return Vec2(
      clamp(bvx + pn * nx - pt * tx, -BALL.maxVx, BALL.maxVx),
      clamp(bvy + pn * ny - pt * ty + TOUCH_IMPULSE.y / BALL.mass, -BALL.maxVy, BALL.maxVy),
    );
  }

  // ---------------------------------------------------------------------------
  // Attacks on a ball up at the net

  /**
   * Smash: stand so the ball drops through the measured strike window just
   * in front of the head, wind the net-side arm up as it falls, and swing.
   */
  private planSmash(samples: BallSample[]): ReturnPlan | null {
    const s = this.computer.sizeScale;
    const strikeY = this.restY(s) + toM(BOT.smash.belowPx * s);
    const sample = samples.find((q) => this.mx(q.x) > toM(NET_X_PX + BALL.radiusPx) && q.vy > 0 && q.y >= strikeY);
    if (!sample) return null;
    const headX = this.mx(sample.x) + toM(BOT.smash.aheadPx * s);
    return this.reachable(headX, sample.frame - 3) ? this.attackPlan('smash', headX, sample.frame) : null;
  }

  /** Jump attack: stand with the ball dropping just net-side of the head, and leap into it. */
  private planJump(samples: BallSample[]): ReturnPlan | null {
    const c = this.computer;
    if (!c.grounded) return null;
    const s = c.sizeScale;
    const meetY = this.restY(s) - toM(BOT.jump.leadRisePx * s);
    const sample = samples.find((q) => this.mx(q.x) > toM(NET_X_PX + BALL.radiusPx) && q.vy > 0 && q.y >= meetY);
    if (!sample || sample.frame < BOT.jump.leadFrames - BOT.jump.windowFrames) return null;
    const headX = this.mx(sample.x) + toM(BOT.jump.aheadPx * s);
    return this.reachable(headX, sample.frame - BOT.jump.leadFrames - 1) ? this.attackPlan('jump', headX, sample.frame) : null;
  }

  private attackPlan(kind: 'smash' | 'jump', headX: number, frame: number): ReturnPlan {
    return { kind, score: 0, headX, frame, deg: NaN, landX: NaN, latePx: 0 };
  }

  private reachable(headX: number, frames: number): boolean {
    if (headX < toM(BOT.minHeadXpx) || headX > this.maxHeadX()) return false;
    const travel = Math.abs(headX - this.mx(this.computer.head.getWorldCenter().x));
    return travel <= toM(this.skill.stepPx) * Math.max(0, frames);
  }

  private execute(plan: ReturnPlan): void {
    const c = this.computer;
    this.steer(plan.headX, plan.frame);
    if (plan.kind === 'smash') {
      this.smash(plan);
      return;
    }
    this.windupFrames = 0;
    if (plan.kind === 'jump') {
      const err = Math.abs(toPx(plan.headX - this.mx(c.head.getWorldCenter().x)));
      if (plan.frame <= BOT.jump.leadFrames && err < 14 * c.sizeScale) c.jump();
      return;
    }
    // Its head will not make it: throw a hand at the ball instead.
    if (this.skill.lunges && plan.latePx > BOT.lunge.latePx) this.strikeIfInZone(BOT.swingZone, BOT.lunge.power);
  }

  private smash(plan: ReturnPlan): void {
    const c = this.computer;
    if (!this.canSwing(c)) return;
    const { smash } = BOT;
    if (plan.frame <= smash.windupFrames + 2) {
      this.windupFrames = Math.min(this.windupFrames + 1, smash.windupFrames);
      c.windUpArm(smash.power * this.windupFrames / smash.windupFrames, 'inside');
    }
    this.strikeIfInZone({ aheadPx: smash.zoneAheadPx, belowPx: smash.zoneBelowPx }, smash.power);
  }

  /** Swing the net-side hand the moment the ball is in the box in front of the head. */
  private strikeIfInZone(zone: { aheadPx: readonly number[]; belowPx: readonly number[] }, power: number): void {
    const c = this.computer;
    if (!this.canSwing(c) || c.contact >= MAX_TOUCHES) return;
    const s = c.sizeScale;
    const head = this.local(c.head.getWorldCenter());
    const ball = this.local(this.ball.position);
    if (ball.x < NET_M) return;
    const ahead = toPx(head.x - ball.x) / s;
    const below = toPx(ball.y - head.y) / s;
    if (ahead >= zone.aheadPx[0] && ahead <= zone.aheadPx[1] && below >= zone.belowPx[0] && below <= zone.belowPx[1]) {
      this.swing(c, power, 'inside');
      this.windupFrames = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Serving

  /**
   * Pick the serve that lands farthest from the opponent (a weaker level
   * picks more loosely), walk to its spot, jump, and flick it over at the
   * recipe's moment in the jump.
   */
  private serveRoutine(): void {
    const c = this.computer;
    if (!this.serving) this.serving = { recipe: this.pickServe(), frames: 0, jumpedAt: -1, still: 0 };
    const sv = this.serving;
    sv.frames += 1;
    if (sv.jumpedAt < 0) {
      const err = toPx(toM(sv.recipe.headXpx) - this.mx(c.head.getWorldCenter().x));
      const late = sv.frames > BOT.serveMaxWalkFrames;
      if (Math.abs(err) >= BOT.serveArrivePx && !late) {
        // Every level walks out at the same pace, so a recipe serves the same for all.
        this.steer(toM(sv.recipe.headXpx), 6, BOT.serveStepPx);
        sv.still = 0;
        return;
      }
      // The serve is a flick from mid-jump: a doll still swaying sends it anywhere.
      const sway = Math.max(c.head.getLinearVelocity().length(), c.ass.getLinearVelocity().length());
      sv.still = sway < BOT.serveStillMs ? sv.still + 1 : 0;
      if (sv.still < BOT.serveSettleFrames && !late) return;
      if (this.serveLegal()) {
        c.jump();
        sv.jumpedAt = sv.frames;
      } else {
        c.turnComp(this.side(2)); // the ball has to be on its own half
      }
      return;
    }
    if (sv.frames - sv.jumpedAt >= sv.recipe.delay) this.serve(c);
  }

  private pickServe(): ServeRecipe {
    const opp = toPx(this.opponentHeadX());
    let best = SERVES[0];
    let bestScore = -Infinity;
    for (const r of SERVES) {
      const land = NET_X_PX - r.landPx[this.flip ? 0 : 1];
      // A weaker level reads the opponent less and picks more at random.
      const score = Math.abs(land - opp) + this.random() * (1.2 - this.skill.aggression) * 400;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return best;
  }

  private serveLegal(): boolean {
    const x = this.ball.position.x;
    return this.flip ? x < SERVE_CENTRE_M : x > SERVE_CENTRE_M;
  }

  // ---------------------------------------------------------------------------
  // Moving

  /** Where it waits while the opponent has the ball. */
  private readyX(): number {
    return toM(BOT.readyXpx + this.readyOffsetPx);
  }

  /** Velocity-style steering: turnComp sets the doll's speed, so aim for a fraction of the gap. */
  private steer(targetX: number, framesLeft = 30, max = this.skill.stepPx): void {
    const c = this.computer;
    if (!c.grounded) return; // turnComp would cancel a jump in flight
    const err = toPx(targetX - this.mx(c.head.getWorldCenter().x));
    if (Math.abs(err) < BOT.deadbandPx) return;
    const stepPx = clamp(err / clamp(framesLeft / 2, 1, 3), -max, max);
    c.turnComp(this.side(stepPx / BOT.pxPerImpulse));
  }

  /** Out of touches: stand clear of where the ball is coming down. */
  private dodge(): void {
    const last = this.forecast().at(-1);
    if (!last) return;
    const head = this.mx(this.computer.head.getWorldCenter().x);
    const x = this.mx(last.x);
    const away = head >= x ? x + toM(BOT.dodgePx) : x - toM(BOT.dodgePx);
    this.steer(clamp(away, toM(BOT.minHeadXpx), this.maxHeadX()));
  }

  // ---------------------------------------------------------------------------
  // Geometry, in its own frame

  /**
   * The ball's flight as it reads it. Right after the opponent's touch its
   * guess at the ball's speed is off by readBias; the error fades as it
   * watches the ball come.
   */
  private forecast(): BallSample[] {
    const v = this.ball.velocity;
    const fade = clamp(1 - this.readClock / this.skill.readFrames, 0, 1);
    const read = Vec2(v.x + this.readBias * fade, v.y);
    return forecastBall(this.ball.position, read, BOT.horizonFrames, this.gravityScaleAt);
  }

  /** The ball's spin survives its flight (no damping); mirroring reverses it. */
  private spin(): number {
    return (this.flip ? -1 : 1) * this.ball.body.getAngularVelocity();
  }

  /** Head centre at rest for a doll of this size, metres. */
  private restY(scale: number): number {
    return toM(FLOOR_TOP_PX - (FLOOR_TOP_PX - BOT.headRestPx) * scale);
  }

  /** The far wall stops the head, in its own frame. */
  private maxHeadX(): number {
    const wall = this.flip ? this.mx(toM(LEFT_WALL_INNER_PX)) : toM(RIGHT_WALL_INNER_PX);
    return wall - toM(BOT.headRadiusPx * this.computer.sizeScale + 2);
  }

  private opponentHeadX(): number {
    return this.opponent ? this.mx(this.opponent.head.getWorldCenter().x) : toM(NET_X_PX - 220);
  }

  /** World x to its own frame (itself on the right), and back. */
  private mx(x: number): number {
    return this.flip ? 2 * NET_M - x : x;
  }

  private local(p: Vec2Value): Vec2 {
    return Vec2(this.mx(p.x), p.y);
  }

  /** A sideways push given in its own frame. */
  private side(x: number): Vec2 {
    return Vec2(this.flip ? -x : x, 0);
  }

  /** The feather ball falls slower over a feathered player's half. */
  private gravityScaleAt = (x: number): number => {
    const ownerId = x < LANDING_CENTRE_M ? 1 : 2;
    const owner = ownerId === this.computer.id ? this.computer : this.opponent;
    return owner?.power === 'feather' ? FEATHER.gravityScale : 1;
  };
}
