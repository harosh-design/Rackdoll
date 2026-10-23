import { Circle, Vec2, type Body, type Fixture, type Vec2Value, type World } from 'planck';
import {
  BODYTYPE, BOXER, CHAMELEON, clamp01, COLLISION, COMET, COURT, EXECUTER, FLOOR_TOP_PX, GRAVITY, LEFT_WALL_INNER_PX, MAGNET,
  NET_X_PX, OPTIONS, PARTS, RIGHT_WALL_INNER_PX, SLIME, SPRING, SWING, TIME_STEP, TIMERS, toM, toPx, type PartName,
} from './constants';
import { FrameTimer, type TimerSet } from './timer';
import type { Player, PlayerId } from './player';
import { ud, type BodyUserData } from './types';
import { seededRandom, type ExecuterVariant } from './executerVariants';

export interface ExecuterTuning {
  mass: number;
  maxForce: number;
  launchSpeed: number;
  emergeFrames: number;
  bullet: boolean;
}

export interface ExecuterOptions {
  world: World;
  timers: TimerSet;
  /** The player it hunts: the one on the side it was launched into. */
  target: Player;
  side: PlayerId;
  variant: ExecuterVariant;
  /** Where it comes out, in metres. */
  origin: Vec2Value;
  speed?: number;
  lifeSeconds?: number;
  tuning?: Partial<ExecuterTuning>;
  /** Seeded, so the slime's choice of target is reproducible. */
  random?: () => number;
  onDeath?: (e: Executer) => void;
}

/**
 * What it is doing now:
 * - magnet: `hunt`, then `latched` once it touches its player;
 * - boxer: `chase`, throwing jabs whenever it is in reach;
 * - comet: `stalk` to a run-up point, `dash`, a diving `loop`, then `recover`;
 * - spring: `drop` from the grave, `charge` between bounces, `rebound` off its player;
 * - slime: `fly` at a limb, `stuck` to the part it reached, `recover`, and again.
 * - chameleon: `crawl` down the wall, `tongue-extend`, `tongue-pull`, `tongue-retract`.
 */
export type ExecuterPhase =
  'hunt' | 'latched' | 'chase' | 'stalk' | 'dash' | 'loop' | 'drop' | 'charge' | 'rebound' | 'recover' | 'fly' | 'stuck' |
  'crawl' | 'tongue-extend' | 'tongue-pull' | 'tongue-retract';

/** A blow that landed, for the renderer's flash and the sound. */
export interface ExecuterImpact {
  /** The executer's age when it landed. */
  age: number;
  /** 0..1 */
  power: number;
  xPx: number;
  yPx: number;
}

/** A part the slime glued into itself, held there by a capped spring. */
export interface SlimeBond {
  part: Body;
  /** The glued point, in the part's own coordinates. */
  local: Vec2;
  /** Rest length, m: the gap it caught at, curing down to SLIME.glueRestPx. */
  rest: number;
  /** The slime's age when it glued. */
  age: number;
}

/** A strand that tore, for the renderer: where its two ends were, px. */
export interface SlimeSnap {
  age: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const FIRST_PHASE: Record<ExecuterVariant['id'], ExecuterPhase> = {
  magnet: 'hunt', boxer: 'chase', comet: 'stalk', spring: 'drop', slime: 'fly',
  chameleon: 'crawl',
};

/** What the magnet's field draws out toward it, on top of the whole-doll pull. */
const REACHING_PARTS: readonly PartName[] = ['HandLeft', 'HandRight', 'FingerLeft', 'FingerRight'];

/** What the slime flies at: the limbs, where glue does the most harm. */
const SLIME_PARTS: readonly PartName[] = ['HandLeft', 'HandRight', 'LegLeft', 'LegRight', 'FootLeft', 'FootRight'];

/**
 * What it glues to the part it is on: the ends of the limbs. An upper arm
 * already sits against the head and the body, so gluing it there would
 * hardly show.
 */
const GLUE_PARTS: ReadonlySet<PartName> = new Set<PartName>([
  'HandLeft', 'HandRight', 'FingerLeft', 'FingerRight', 'LegLeft', 'LegRight', 'FootLeft', 'FootRight',
]);

/** Which limb each part is on. The slime only glues parts of different limbs together. */
const LIMB: Record<PartName, string> = {
  ArmLeft: 'armL', HandLeft: 'armL', FingerLeft: 'armL',
  ArmRight: 'armR', HandRight: 'armR', FingerRight: 'armR',
  LegLeft: 'legL', FootLeft: 'legL', LegRight: 'legR', FootRight: 'legR',
  Head: 'core', Tors: 'core', Ass: 'core',
};

const PART_DEFS = new Map(PARTS.map((p) => [p.name, p]));

const unit = (x: number, y: number): Vec2 => {
  const len = Math.hypot(x, y);
  return len < 1e-9 ? Vec2(0, 0) : Vec2(x / len, y / len);
};

/**
 * §13 Executer, reworked into hazards that share one body and one set of
 * safety rules but attack in their own ways:
 *
 * - flying hazards fire out of their button, straight at their target;
 * - a sensor until it is clear of everything, so it can't spawn inside the
 *   ball that just pressed the button;
 * - then steered by a bounded force rather than having its velocity
 *   overwritten, so a player in the way stops it instead of being crushed;
 * - the wall crawler stays a kinematic sensor and only pulls with its tongue;
 * - the spring uses gravity and redirects only on contact; other flyers hover;
 * - every blow it deals goes through Player.knock(): a shove shared between
 *   the rail-mounted head and the hips, which moves the doll without tearing
 *   it.
 */
export class Executer {
  readonly body: Body;
  readonly target: Player;
  readonly variant: ExecuterVariant;
  readonly side: PlayerId;
  dead = false;
  /** Frames since launch. */
  age = 0;
  /** False while emerging. The wall crawler remains a sensor after it is ready. */
  solid = false;
  phase: ExecuterPhase;
  /** Frames spent in the current phase. */
  phaseAge = 0;
  /** Steering pauses briefly after a player's hit so the knockback carries. */
  knockbackFrames = 0;
  /** Blows that connected: punches, rams and slams. */
  hits = 0;
  lastImpact: ExecuterImpact | null = null;
  /** Magnet: how hard its field is pulling its player right now, 0..1. */
  field = 0;
  /** Boxer: every jab targets the head; -1 means out of reach. */
  readonly punchPart = 'Head';
  punchFrame = -1;
  /** Comet: the side of its player it rams from, +1 is to their right. */
  ramSide: 1 | -1;
  /** Comet: the line of the current dash. */
  dashDir = Vec2(0, 0);
  /** Comet: visual facing, independent of the physics body's tumble and flight. */
  facingAngle = 0;
  previousFacingAngle = 0;
  /** Spring: distance flown since its last surface contact, m. */
  travel = 0;
  /** Spring: every physical bounce drives the coil's squash and impact marks. */
  lastBounce: (ExecuterImpact & { nx: number; ny: number }) | null = null;
  /** Slime: the limb it is flying at. */
  aimPart: PartName = 'HandLeft';
  /** Slime: the part it is stuck to, and where on it, in its own coordinates. */
  host: Body | null = null;
  hostAnchor = Vec2(0, 0);
  /** Slime: the parts it has glued into itself. */
  readonly bonds: SlimeBond[] = [];
  /** Slime: the part it is reeling in on a strand. */
  reelPart: Body | null = null;
  /** Slime: strands that tore, and the last one. */
  snaps = 0;
  lastSnap: SlimeSnap | null = null;
  /** Chameleon: the current tongue target and its last aimed point, in metres. */
  tongueTarget: Body | null = null;
  tongueAim = Vec2(0, 0);

  private readonly fixture: Fixture;
  private readonly timer: FrameTimer;
  private readonly timers: TimerSet;
  private readonly world: World;
  private readonly speed: number;
  private readonly lifeSeconds: number;
  private readonly tuning: ExecuterTuning;
  private readonly random: () => number;
  private readonly onDeath?: (e: Executer) => void;
  /** Velocity going into the last step: what it hit with. */
  private lastVelocity = Vec2(0, 0);
  private springEscapeUntil = 0;
  private springEscapeSide = 1;
  private springPosition = Vec2(0, 0);
  private springContacts = new Set<Body>();
  private loopOrigin = Vec2(0, 0);
  private loopDirection = 1;
  private loopFacing = 0;
  /** Slime: frames it has left to hold on. */
  private holdLeft = 0;
  /** Slime: frames spent reeling in the current part. */
  private reelAge = 0;
  /** Slime: parts that tore free, and the age until which it can't glue them again. */
  private readonly regrab = new Map<Body, number>();
  private readonly wallX: number;
  private tongueCooldown = CHAMELEON.cooldownFrames;

  constructor(o: ExecuterOptions) {
    this.world = o.world;
    this.timers = o.timers;
    this.target = o.target;
    this.variant = o.variant;
    this.side = o.side;
    this.phase = FIRST_PHASE[o.variant.id];
    this.speed = (o.speed ?? OPTIONS.myExSpeed) * o.variant.speed;
    this.lifeSeconds = o.lifeSeconds ?? OPTIONS.myExLife;
    this.random = o.random ?? seededRandom(1);
    this.onDeath = o.onDeath;
    this.tuning = {
      mass: o.variant.mass,
      maxForce: EXECUTER.maxForce * o.variant.force,
      launchSpeed: EXECUTER.launchSpeed * o.variant.launch,
      emergeFrames: EXECUTER.emergeFrames,
      bullet: EXECUTER.bullet,
      ...o.tuning,
    };
    this.wallX = o.origin.x;

    this.body = o.world.createBody({
      type: o.variant.id === 'chameleon' ? 'kinematic' : 'dynamic',
      position: Vec2(o.origin.x, o.origin.y),
      angularDamping: 0,
      linearDamping: 0,
      gravityScale: o.variant.id === 'spring' ? 1 : 0,
      bullet: this.tuning.bullet,
      // The comet tumbles physically; its art turns toward its player separately.
      fixedRotation: o.variant.id !== 'comet',
    });
    this.fixture = this.body.createFixture({
      shape: Circle(toM(EXECUTER.radiusPx)),
      density: EXECUTER.density,
      friction: o.variant.friction,
      restitution: o.variant.restitution,
      isSensor: true,
      filterCategoryBits: COLLISION.EXECUTER,
      filterMaskBits: 0xffff,
    });
    this.body.setMassData({ mass: this.tuning.mass, center: Vec2(0, 0), I: EXECUTER.inertia });
    this.body.setUserData({ e_bodytype: BODYTYPE.EXECUTER, sprite: `Executer-${o.variant.id}` } as BodyUserData);

    const tors = this.target.tors.getWorldCenter();
    const sideOf = (x: number): 1 | -1 => (x >= tors.x ? 1 : -1);
    this.ramSide = sideOf(o.origin.x);
    if (o.variant.id === 'slime') this.aimPart = this.openPart(SLIME_PARTS, sideOf(o.origin.x), null);

    // Fire it straight at its target.
    const c = this.body.getWorldCenter();
    const aim = this.variant.id === 'boxer' ? this.target.head.getWorldCenter() : this.chestPoint();
    const d = unit(aim.x - c.x, aim.y - c.y);
    this.facingAngle = this.previousFacingAngle = Math.atan2(d.y, d.x);
    this.body.setLinearVelocity(Vec2(d.x * this.tuning.launchSpeed, d.y * this.tuning.launchSpeed));
    if (o.variant.id === 'spring') {
      this.body.setLinearVelocity(Vec2((this.side === 1 ? 1 : -1) * SPRING.emergeSpeed, SPRING.dropSpeed));
      this.springPosition = this.body.getPosition().clone();
    }
    if (o.variant.id === 'chameleon') {
      const inward = this.side === 1 ? 1 : -1;
      this.body.setTransform(Vec2(this.wallX - inward * toM(CHAMELEON.emergeDistancePx), o.origin.y), 0);
      this.crawlDownWall();
    }
    this.lastVelocity = this.body.getLinearVelocity().clone();

    this.timer = o.timers.add(
      new FrameTimer(TIMERS.executerTickMs, this.lifeSeconds, () => {}, () => this.destroy()),
    );
    this.timer.start();
  }

  /** Where it aims: its player's chest, between the head and the torso. */
  private chestPoint(): Vec2 {
    const head = this.target.head.getWorldCenter();
    const tors = this.target.tors.getWorldCenter();
    return Vec2(tors.x, (head.y + tors.y) / 2);
  }

  /** Its player's centre of mass. */
  private dollCentre(): Vec2 {
    let m = 0;
    let x = 0;
    let y = 0;
    for (const b of this.target.bodies) {
      const p = b.getWorldCenter();
      const bm = b.getMass();
      m += bm;
      x += p.x * bm;
      y += p.y * bm;
    }
    return Vec2(x / m, y / m);
  }

  private overlapsAnything(): boolean {
    for (let ce = this.body.getContactList(); ce; ce = ce.next) {
      if (ce.contact.isTouching()) return true;
    }
    return false;
  }

  /** Every part of its player it is touching. */
  private touchingParts(): Set<Body> {
    const parts = new Set<Body>();
    for (let ce = this.body.getContactList(); ce; ce = ce.next) {
      if (ce.contact.isTouching() && ce.other && this.target.bodies.includes(ce.other)) parts.add(ce.other);
    }
    return parts;
  }

  /** A part of its player it is touching, if any. */
  private touchedPart(): Body | null {
    return this.touchingParts().values().next().value ?? null;
  }

  /** Distance from its centre to the nearest part of its player, px. */
  private nearestPartPx(): number {
    const c = this.body.getWorldCenter();
    let best = Infinity;
    for (const b of this.target.bodies) {
      const q = b.getWorldCenter();
      best = Math.min(best, Math.hypot(q.x - c.x, q.y - c.y));
    }
    return toPx(best);
  }

  /** Its own half, left to right, in metres, keeping its radius clear of the wall and the net. */
  private get halfBounds(): [number, number] {
    const r = EXECUTER.radiusPx + 4;
    return this.side === 1
      ? [toM(LEFT_WALL_INNER_PX + r), toM(NET_X_PX - r)]
      : [toM(NET_X_PX + r), toM(RIGHT_WALL_INNER_PX - r)];
  }

  /** A height it can actually hover at: clear of the floor and the ceiling. */
  private clampY(y: number): number {
    const r = EXECUTER.radiusPx + 3;
    const ceiling = COURT.ceiling.y + COURT.ceiling.hh;
    return Math.min(toM(FLOOR_TOP_PX - r), Math.max(toM(ceiling + r), y));
  }

  private setPhase(phase: ExecuterPhase): void {
    this.phase = phase;
    this.phaseAge = 0;
  }

  /**
   * Once per frame, after the step. `dt` is the step that just ran. `ball` is
   * the ball while it is free and in play, otherwise null.
   */
  update(dt: number, ball: Body | null = null): void {
    if (this.dead) return;
    this.age += 1;
    this.phaseAge += 1;
    if (this.variant.id === 'chameleon') {
      this.solid = this.age >= CHAMELEON.emergeFrames;
      if (this.knockbackFrames > 0) this.knockbackFrames -= 1;
      this.updateChameleon(dt, ball);
      return;
    }
    if (this.variant.id === 'comet' && this.phase !== 'loop') this.facePlayer(dt);

    if (this.variant.id === 'spring') {
      if (!this.solid && this.age >= this.tuning.emergeFrames && !this.overlapsAnything()) {
        this.fixture.setSensor(false);
        this.solid = true;
      }
      if (this.knockbackFrames > 0) this.knockbackFrames -= 1;
      this.updateSpring(dt);
      this.lastVelocity = this.body.getLinearVelocity().clone();
      return;
    }

    if (!this.solid) {
      if (this.age >= this.tuning.emergeFrames && !this.overlapsAnything()) {
        this.fixture.setSensor(false);
        this.solid = true;
      } else if (this.variant.id === 'slime' && this.age > this.tuning.emergeFrames) {
        this.confine();
      }
    } else if (this.knockbackFrames > 0) {
      this.knockbackFrames -= 1;
      this.field = 0;
    } else {
      switch (this.variant.id) {
        case 'magnet': this.updateMagnet(dt, ball); break;
        case 'boxer': this.updateBoxer(dt); break;
        case 'comet': this.updateComet(dt, ball); break;
        case 'slime': this.updateSlime(dt); break;
      }
    }
    this.lastVelocity = this.body.getLinearVelocity().clone();
  }

  // -------------------------------------------------------------------------
  // Chameleon
  // -------------------------------------------------------------------------

  /** A kinematic sensor follows the wall without crushing or blocking a doll. */
  private crawlDownWall(): void {
    const p = this.body.getPosition();
    const inward = this.side === 1 ? 1 : -1;
    const emergeLeft = Math.max(0, CHAMELEON.emergeFrames - this.age);
    const x = this.wallX - inward * toM(CHAMELEON.emergeDistancePx) * emergeLeft / CHAMELEON.emergeFrames;
    const floorY = toM(FLOOR_TOP_PX - CHAMELEON.floorClearancePx);
    const y = Math.min(p.y, floorY);
    this.body.setTransform(Vec2(x, y), 0);
    // Keep the requested speed until the foot of the wall, then stop above the floor.
    const descent = Math.min(toM(CHAMELEON.crawlSpeedPx), Math.max(0, (floorY - y) / TIME_STEP));
    this.body.setLinearVelocity(Vec2(emergeLeft > 0
      ? inward * toM(CHAMELEON.emergeDistancePx) / (CHAMELEON.emergeFrames * TIME_STEP) : 0, descent));
  }

  private tongueMouth(): Vec2 {
    const c = this.body.getWorldCenter();
    const inward = this.side === 1 ? 1 : -1;
    return Vec2(c.x + inward * toM(CHAMELEON.mouthOffsetXPx), c.y + toM(CHAMELEON.mouthOffsetYPx));
  }

  private tongueCanReach(body: Body): boolean {
    const p = body.getWorldCenter();
    const onHalf = this.side === 1 ? p.x < toM(NET_X_PX) : p.x > toM(NET_X_PX);
    return onHalf && Vec2.distance(this.tongueMouth(), p) <= toM(CHAMELEON.tongueReachPx);
  }

  private releaseTongue(): void {
    if (this.tongueTarget && this.phase === 'tongue-pull') this.tongueAim = this.tongueTarget.getWorldCenter().clone();
    this.tongueTarget = null;
    this.setPhase('tongue-retract');
  }

  /** Attacks do not interrupt crawling, and only a free, in-play ball is eligible. */
  private updateChameleon(dt: number, ball: Body | null): void {
    this.crawlDownWall();
    if (!this.solid || this.knockbackFrames > 0) return;
    const playerPart = this.target.activePart('Tors');
    if (this.phase === 'crawl') {
      if (--this.tongueCooldown > 0) return;
      const choices = [playerPart, ball]
        .filter((b): b is Body => b !== null && this.tongueCanReach(b));
      const mouth = this.tongueMouth();
      choices.sort((a, b) => Vec2.distance(mouth, a.getWorldCenter()) - Vec2.distance(mouth, b.getWorldCenter()));
      this.tongueCooldown = CHAMELEON.cooldownFrames;
      this.tongueTarget = choices[0] ?? null;
      if (this.tongueTarget) {
        this.tongueAim = this.tongueTarget.getWorldCenter().clone();
        this.setPhase('tongue-extend');
      }
      return;
    }
    if (this.phase === 'tongue-retract') {
      if (this.phaseAge >= CHAMELEON.retractFrames) this.setPhase('crawl');
      return;
    }
    const caught = this.tongueTarget;
    const isPlayer = caught === playerPart;
    if (!caught || (!isPlayer && caught !== ball)) {
      this.releaseTongue();
      return;
    }
    const p = caught.getWorldCenter();
    const c = this.tongueMouth();
    const distance = Vec2.distance(c, p);
    const onHalf = this.side === 1 ? p.x < toM(NET_X_PX) : p.x > toM(NET_X_PX);
    if (!onHalf || distance > toM(CHAMELEON.tongueReachPx + CHAMELEON.breakMarginPx) ||
        distance < toM(CHAMELEON.releasePx)) {
      this.releaseTongue();
      return;
    }
    if (this.phase === 'tongue-extend') {
      if (this.phaseAge >= CHAMELEON.extendFrames) {
        if (Vec2.distance(p, this.tongueAim) > toM(CHAMELEON.catchRadiusPx)) this.releaseTongue();
        else {
          this.setPhase('tongue-pull');
          this.landed(caught, 0.25, p);
        }
      }
      return;
    }
    if (this.phaseAge > CHAMELEON.pullFrames) {
      this.releaseTongue();
      return;
    }
    this.tongueAim = p.clone();
    const u = unit(c.x - p.x, c.y - p.y);
    if (isPlayer) {
      // Share the tug with every surviving part and the rail. No limb is stretched.
      const gravity = Math.abs(this.world.getGravity().y * caught.getGravityScale());
      const ay = Math.max(u.y * CHAMELEON.playerPull, -gravity * CHAMELEON.playerLiftMax);
      this.target.knock(Vec2(u.x * CHAMELEON.playerPull * dt, ay * dt), 2);
    } else {
      const gravity = Math.abs(this.world.getGravity().y * caught.getGravityScale());
      const ay = Math.max(u.y * CHAMELEON.ballPull, -gravity * CHAMELEON.ballLiftMax);
      caught.applyLinearImpulse(Vec2(caught.getMass() * u.x * CHAMELEON.ballPull * dt,
        caught.getMass() * ay * dt), p, true);
    }
  }

  // -------------------------------------------------------------------------
  // Magnet
  // -------------------------------------------------------------------------

  /**
   * Drift slowly toward its player; latch on contact and hold still. The field
   * does the real work: it drags the player in from well outside reach.
   */
  private updateMagnet(dt: number, ball: Body | null): void {
    const touching = this.touchedPart() !== null;
    if (this.phase === 'hunt' && touching) this.setPhase('latched');
    else if (this.phase === 'latched' && !touching && this.nearestPartPx() > EXECUTER.radiusPx + MAGNET.releasePx) {
      this.setPhase('hunt');
    }
    // Latched, it holds its ground, so they have to drag themselves clear.
    this.drive(this.phase === 'latched' ? Vec2(0, 0) : this.seek(this.chestPoint(), this.speed), dt);
    this.pullPlayer(dt);
    if (ball) this.pullBall(ball, dt);
  }

  private pullPlayer(dt: number): void {
    const c = this.body.getWorldCenter();
    const com = this.dollCentre();
    const dx = c.x - com.x;
    const reach = toM(MAGNET.fieldPx);
    const d = Math.hypot(dx, c.y - com.y);
    this.field = d < reach ? 1 - d / reach : 0;
    if (this.field === 0) return;
    // The same sideways acceleration on every part, so the doll is drawn in
    // whole with nothing stretched. It fades out as they come up against
    // its side: pulled on toward its centre, the hips would slide under it
    // while the head stays put, and the doll would fold around it.
    const clear = clamp01((Math.abs(dx) - toM(EXECUTER.radiusPx + 12)) / toM(24));
    const ax = Math.sign(dx) * MAGNET.playerPull * this.field * clear;
    for (const b of this.target.bodies) {
      b.applyLinearImpulse(Vec2(b.getMass() * ax * dt, 0), b.getWorldCenter(), true);
    }
    // The arms reach for it. An arm already on it is left alone: pulling it
    // in harder hooks the hand on it while the body walks away, and the
    // wrist stretches.
    const touching = this.touchingParts();
    for (const name of REACHING_PARTS) {
      if (!this.target.isAttached(name)) continue;
      const side = name.endsWith('Left') ? 'Left' : 'Right';
      if (['Arm', 'Hand', 'Finger'].some((limb) => touching.has(this.target.part(`${limb}${side}` as PartName)))) continue;
      const b = this.target.part(name);
      const p = b.getWorldCenter();
      const u = unit(c.x - p.x, c.y - p.y);
      const j = b.getMass() * MAGNET.handPull * this.field * dt;
      b.applyLinearImpulse(Vec2(u.x * j, u.y * j), p, true);
    }
  }

  /**
   * Bend a free ball's flight toward it. Sideways it can pull harder than
   * gravity; upward never, so it can't hold a ball up and stall the rally.
   */
  private pullBall(ball: Body, dt: number): void {
    const c = this.body.getWorldCenter();
    const p = ball.getWorldCenter();
    const reach = toM(MAGNET.fieldPx);
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d >= reach) return;
    const g = GRAVITY.y * ball.getGravityScale();
    const a = MAGNET.ballPull * g * (1 - d / reach);
    const u = unit(c.x - p.x, c.y - p.y);
    const ay = Math.max(u.y * a, -MAGNET.ballLiftMax * g);
    ball.applyLinearImpulse(Vec2(ball.getMass() * u.x * a * dt, ball.getMass() * ay * dt), p, true);
  }

  // -------------------------------------------------------------------------
  // Boxer
  // -------------------------------------------------------------------------

  /** Keep a fist's length from the head and throw every jab at it. */
  private updateBoxer(dt: number): void {
    const c = this.body.getWorldCenter();
    const side: 1 | -1 = c.x >= this.target.tors.getWorldCenter().x ? 1 : -1;
    const part = this.target.head;
    const p = part.getWorldCenter();
    const stand = Vec2(p.x + side * toM(BOXER.standOffPx), this.clampY(p.y));
    this.drive(this.seek(stand, Math.max(this.speed * 1.5, BOXER.chaseSpeed)), dt);

    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const distance = toPx(Math.hypot(dx, dy));
    if (distance > BOXER.punchReachPx) {
      this.punchFrame = -1;
      return;
    }
    this.punchFrame = (this.punchFrame + 1) % BOXER.punchFrames;
    if (this.punchFrame !== BOXER.impactFrame || distance > BOXER.impactReachPx) return;

    // The whole doll takes a small shove while the head snaps back.
    const u = unit(dx, dy);
    const shove = Vec2(u.x * BOXER.punchSpeed, (u.y - 0.15) * BOXER.punchSpeed);
    this.target.knock(shove, BOXER.recoilFrames, part, Vec2(u.x * BOXER.partJolt, u.y * BOXER.partJolt));
    this.body.applyLinearImpulse(Vec2(-u.x * BOXER.recoilImpulse, -u.y * BOXER.recoilImpulse), c, true);
    this.landed(part, 0.35, p);
  }

  /** One of `parts` it can reach from its side without going through the body, never `last` again. */
  private openPart(parts: readonly PartName[], side: 1 | -1, last: PartName | null): PartName {
    const torsX = this.target.tors.getWorldCenter().x;
    const surviving = parts.filter(name => this.target.isAttached(name));
    if (!surviving.length) return ud(this.target.head).part!;
    const open = surviving.filter((name) => name !== last &&
      (this.target.part(name).getWorldCenter().x - torsX) * side > -toM(6));
    const pool = open.length > 0 ? open : surviving;
    return pool[Math.floor(this.random() * pool.length)];
  }

  // -------------------------------------------------------------------------
  // Comet
  // -------------------------------------------------------------------------

  /** Take the shortest turn toward the player, independently of flight direction. */
  private facePlayer(dt: number): void {
    const c = this.body.getWorldCenter();
    const aim = this.chestPoint();
    const angle = this.facingAngle;
    this.previousFacingAngle = angle;
    const desired = Math.atan2(aim.y - c.y, aim.x - c.x);
    const delta = Math.atan2(Math.sin(desired - angle), Math.cos(desired - angle));
    const step = Math.max(-COMET.turnSpeed * dt, Math.min(COMET.turnSpeed * dt, delta));
    this.facingAngle += step;
  }

  private updateComet(dt: number, ball: Body | null): void {
    const c = this.body.getWorldCenter();
    const aim = this.chestPoint();
    switch (this.phase) {
      case 'stalk': {
        this.ramSide = this.chooseRamSide(ball);
        const tors = this.target.tors.getWorldCenter();
        const head = this.target.head.getWorldCenter();
        const [minX, maxX] = this.halfBounds;
        const runUp = Vec2(
          Math.min(maxX, Math.max(minX, tors.x + this.ramSide * toM(COMET.runUpPx))),
          this.clampY(aim.y - toM(COMET.runUpRisePx)),
        );
        // On the wrong side of them: climb on its own side, clear of the
        // body, then cross over their head. Straight across would plough
        // through the doll.
        const offside = (c.x - tors.x) * this.ramSide < toM(20);
        const over = this.clampY(head.y - toM(COMET.overheadPx));
        let goal = runUp;
        if (offside && c.y > head.y - toM(50)) {
          const out = tors.x - this.ramSide * Math.max(Math.abs(c.x - tors.x), toM(70));
          goal = Vec2(Math.min(maxX, Math.max(minX, out)), over);
        } else if (offside) {
          goal = Vec2(tors.x + this.ramSide * toM(40), over);
        }
        this.drive(this.seek(goal, COMET.stalkSpeed, 6), dt, COMET.stalkForce);
        const ready = Math.hypot(runUp.x - c.x, runUp.y - c.y) < toM(26);
        if (!offside && (ready || this.phaseAge > COMET.maxStalkFrames)) {
          this.dashDir = unit(aim.x - c.x, aim.y - c.y);
          this.setPhase('dash');
        }
        return;
      }
      case 'dash': {
        const hit = this.touchedPart();
        if (hit) {
          this.ram(hit);
          return;
        }
        const past = (aim.x - c.x) * this.dashDir.x + (aim.y - c.y) * this.dashDir.y < -toM(30);
        if (past || this.phaseAge > COMET.dashFrames) {
          this.startCometLoop();
          return;
        }
        // Mostly committed to its line, so a jump can still dodge it.
        const want = unit(aim.x - c.x, aim.y - c.y);
        const h = COMET.dashHoming;
        this.dashDir = unit(this.dashDir.x * (1 - h) + want.x * h, this.dashDir.y * (1 - h) + want.y * h);
        this.drive(Vec2(this.dashDir.x * COMET.dashSpeed, this.dashDir.y * COMET.dashSpeed), dt, COMET.dashForce);
        return;
      }
      case 'loop': {
        // One complete downward loop, away from the player. It cannot ram
        // during this phase, even when its path brushes a limb.
        const theta = Math.min(1, this.phaseAge / COMET.loopFrames) * Math.PI * 2;
        const radius = toM(COMET.loopRadiusPx);
        const omega = Math.PI * 2 / (COMET.loopFrames * dt);
        const x = this.loopOrigin.x + this.loopDirection * radius * Math.sin(theta);
        const y = this.loopOrigin.y + radius * (1 - Math.cos(theta));
        this.drive(Vec2(
          this.loopDirection * Math.cos(theta) * COMET.loopSpeed + (x - c.x) * 5,
          Math.sin(theta) * Math.min(COMET.loopSpeed, radius * omega) + (y - c.y) * 5,
        ), dt, COMET.loopForce);
        this.previousFacingAngle = this.facingAngle;
        this.facingAngle = this.loopFacing + this.loopDirection * theta;
        if (this.phaseAge >= COMET.loopFrames) this.setPhase('recover');
        return;
      }
      default:
        this.drive(Vec2(0, 0), dt, COMET.brakeForce);
        if (this.phaseAge >= COMET.recoverFrames) this.setPhase('stalk');
    }
  }

  private startCometLoop(): void {
    const c = this.body.getWorldCenter();
    const radius = toM(COMET.loopRadiusPx);
    const [minX, maxX] = this.halfBounds;
    this.loopOrigin = Vec2(Math.max(minX + radius, Math.min(maxX - radius, c.x)),
      Math.min(c.y, this.clampY(toM(FLOOR_TOP_PX) - radius * 2 - toM(EXECUTER.radiusPx + 4))));
    this.loopDirection = this.dashDir.x >= 0 ? 1 : -1;
    this.loopFacing = this.facingAngle;
    this.setPhase('loop');
  }

  /**
   * Ram from the ball's side, to knock its player away from it. With the ball
   * held or right overhead, from the net side, back toward their wall. Short
   * of room for a run-up on that side, from the other.
   */
  private chooseRamSide(ball: Body | null): 1 | -1 {
    const torsX = this.target.tors.getWorldCenter().x;
    let side = this.ramSide;
    if (ball) {
      const dx = ball.getWorldCenter().x - torsX;
      if (Math.abs(dx) > toM(40)) side = dx > 0 ? 1 : -1;
    } else {
      side = this.side === 1 ? 1 : -1;
    }
    const [minX, maxX] = this.halfBounds;
    const room = side > 0 ? maxX - torsX : torsX - minX;
    return room < toM(COMET.minRunUpPx) ? (-side as 1 | -1) : side;
  }

  private ram(part: Body): void {
    const v = this.lastVelocity;
    const speed = Math.hypot(v.x, v.y);
    const power = clamp01(speed / COMET.dashSpeed);
    const d = this.dashDir;
    const k = COMET.knockSpeed * power;
    const j = COMET.knockJolt * power;
    this.target.knock(
      Vec2(d.x * k, (d.y * 0.5 - COMET.knockLift) * k), Math.round(COMET.stumbleFrames * power), part, Vec2(d.x * j, d.y * j),
    );
    // It glances off, up and on over them.
    this.body.setLinearVelocity(Vec2(d.x * speed * 0.35, -speed * 0.45));
    this.landed(part, power);
    this.startCometLoop();
  }

  // -------------------------------------------------------------------------
  // Spring
  // -------------------------------------------------------------------------

  private updateSpring(dt: number): void {
    const c = this.body.getWorldCenter();
    // Actual displacement charges the coil. Bound corrections and external
    // teleports cannot manufacture a long flight in a single frame.
    this.travel += Math.min(Vec2.distance(c, this.springPosition), SPRING.topSpeed * dt * 1.5);
    this.springPosition = c.clone();
    if (!this.solid) return;
    const escaping = this.age < this.springEscapeUntil || this.knockbackFrames > 0;
    if (this.phase === 'rebound' && !escaping) this.setPhase('charge');

    const contacts = new Set<Body>();
    let surface: { body: Body; normal: Vec2; point: Vec2 } | null = null;
    let playerPart: Body | null = null;
    for (let edge = this.body.getContactList(); edge; edge = edge.next) {
      const contact = edge.contact;
      const a = contact.getFixtureA(), b = contact.getFixtureB();
      if (!contact.isTouching() || a.isSensor() || b.isSensor() || !edge.other) continue;
      contacts.add(edge.other);
      if (this.springContacts.has(edge.other) &&
        this.age - (this.lastBounce?.age ?? this.age) < SPRING.contactRetryFrames) continue;
      if (this.target.bodies.includes(edge.other)) {
        playerPart ??= edge.other;
        continue;
      }
      const manifold = contact.getWorldManifold(null);
      if (!manifold || contact.getManifold().pointCount === 0) continue;
      const sign = a.getBody() === this.body ? -1 : 1;
      const normal = Vec2(manifold.normal.x * sign, manifold.normal.y * sign);
      surface ??= { body: edge.other, normal, point: Vec2(manifold.points[0]) };
    }
    this.springContacts = contacts;
    if (playerPart) {
      this.slam(playerPart, !escaping && this.phase !== 'drop');
      return;
    }
    if (surface) {
      this.bounceSpring(surface.body, surface.normal, surface.point, escaping);
      return;
    }

    // Gravity bends every flight. Acceleration follows its existing momentum,
    // never the player, so a missed hop cannot turn around in mid-air.
    const v = this.body.getLinearVelocity();
    const speed = v.length();
    const run = clamp01(toPx(this.travel) / SPRING.fullTravelPx);
    const boost = this.phase === 'drop' || escaping ? 0 : (SPRING.accel + SPRING.travelAccel * run) * dt;
    const next = Math.min(SPRING.topSpeed, speed + boost);
    if (speed > 0.01) this.body.setLinearVelocity(Vec2(v.x * next / speed, v.y * next / speed));
  }

  /** Aim a new hop inside the surface's outward hemisphere. */
  private bounceSpring(other: Body, normal: Vec2, point: Vec2, escaping: boolean): void {
    const c = this.body.getWorldCenter();
    const aim = this.chestPoint();
    const power = this.slamPower;
    const speed = Math.min(SPRING.topSpeed, SPRING.bounceSpeed + SPRING.bounceBoost * power);
    const flightTime = Math.max(0.45, Math.min(1.05, Math.abs(aim.x - c.x) / speed));
    const dx = escaping ? this.springEscapeSide * speed : (aim.x - c.x) / flightTime;
    const dy = escaping ? -speed * 0.7
      : (aim.y - c.y) / flightTime - this.world.getGravity().y * flightTime * 0.5;
    let direction = unit(dx, dy);
    const dot = direction.x * normal.x + direction.y * normal.y;
    if (dot < SPRING.normalShare) {
      const tangent = unit(direction.x - dot * normal.x, direction.y - dot * normal.y);
      const share = Math.sqrt(1 - SPRING.normalShare ** 2);
      direction = unit(normal.x * SPRING.normalShare + tangent.x * share,
        normal.y * SPRING.normalShare + tangent.y * share);
    }
    if (other.isDynamic() && ud(other)?.e_bodytype !== BODYTYPE.PLAYER) {
      // The physical impact already transfers momentum. A bounded extra shove
      // makes a charged hit readable even on a heavy prop or another hazard.
      const push = other.getMass() * SPRING.objectPushSpeed * power ** 1.5;
      other.applyLinearImpulse(Vec2(-normal.x * push, -normal.y * push), other.getWorldCenter(), true);
    }
    this.body.setLinearVelocity(Vec2(direction.x * speed, direction.y * speed));
    this.recordSpringBounce(power, normal, point);
    if (this.phase === 'drop') this.setPhase('charge');
  }

  private recordSpringBounce(power: number, normal: Vec2, point: Vec2Value): void {
    this.lastBounce = { age: this.age, power, xPx: toPx(point.x), yPx: toPx(point.y), nx: normal.x, ny: normal.y };
    this.travel = 0;
  }

  /** Impact strength, 0..1: mostly the speed it reached, partly how far it ran. */
  get slamPower(): number {
    const v = this.lastVelocity;
    const speed = clamp01(Math.hypot(v.x, v.y) / SPRING.topSpeed);
    const run = clamp01(toPx(this.travel) / SPRING.fullTravelPx);
    return SPRING.speedShare * speed + (1 - SPRING.speedShare) * run;
  }

  private slam(part: Body, canAttack: boolean): void {
    const v = this.lastVelocity;
    const speed = Math.hypot(v.x, v.y);
    const power = this.slamPower;
    const c = this.body.getWorldCenter();
    const aim = this.chestPoint();
    const d = speed > 0.5 ? unit(v.x, v.y) : unit(aim.x - c.x, aim.y - c.y);
    // Mostly sideways: a straight-down slam would only sag the doll on its rail.
    const push = unit(d.x, d.y * 0.4);
    // Steeper than linear, so a bump from a standing start stays a bump.
    const k = SPRING.pushSpeed * power ** 1.5;
    const j = SPRING.pushJolt * power;
    if (canAttack) {
      this.target.knock(
        Vec2(push.x * k, push.y * k - SPRING.pushLift * k), Math.round(SPRING.stumbleFrames * power), part, Vec2(d.x * j, d.y * j),
      );
      this.landed(part, power);
    }
    // Leave enough room to play. Sideways separation is guaranteed even on
    // a nearly vertical hit; floor/wall bounces also respect this escape.
    const away = c.x - this.target.tors.getWorldCenter().x;
    this.springEscapeSide = Math.abs(away) > toM(4) ? Math.sign(away) : (d.x >= 0 ? -1 : 1);
    const back = Math.min(SPRING.topSpeed, SPRING.reboundMin + SPRING.reboundScale * speed);
    const vx = this.springEscapeSide * Math.max(SPRING.escapeSpeed, back);
    const vy = -Math.min(Math.sqrt(SPRING.topSpeed ** 2 - vx ** 2), Math.max(3.5, Math.abs(d.y) * back));
    this.body.setLinearVelocity(Vec2(vx, vy));
    this.springEscapeUntil = this.age + SPRING.reboundFrames;
    this.recordSpringBounce(power, unit(c.x - part.getWorldCenter().x, c.y - part.getWorldCenter().y), part.getWorldCenter());
    this.setPhase('rebound');
  }

  // -------------------------------------------------------------------------
  // Slime
  // -------------------------------------------------------------------------

  private updateSlime(dt: number): void {
    switch (this.phase) {
      case 'fly': {
        // Arriving on several parts at once, it takes the limb end it was
        // after, or else any limb end, over an upper arm or the body.
        const touching = [...this.touchingParts()];
        const hit = touching.find((b) => ud(b).part === this.aimPart)
          ?? touching.find((b) => GLUE_PARTS.has(ud(b).part!)) ?? touching[0];
        if (hit) {
          this.stick(hit);
          return;
        }
        // Homing on its limb, bobbing across its path so it flaps in
        // rather than glides.
        const p = this.target.activePart(this.aimPart).getWorldCenter();
        const v = this.seek(Vec2(p.x, this.clampY(p.y)), SLIME.flySpeed, 4);
        const u = unit(v.x, v.y);
        const bob = SLIME.bobSpeed * Math.sin((this.age * 2 * Math.PI) / SLIME.bobFrames);
        this.drive(Vec2(v.x - u.y * bob, v.y + u.x * bob), dt, SLIME.flyForce);
        return;
      }
      case 'stuck':
        this.holdOn(dt);
        return;
      default: {
        this.drive(Vec2(0, 0), dt, SLIME.brakeForce);
        if (this.phaseAge >= SLIME.recoverFrames) {
          const side: 1 | -1 = this.body.getWorldCenter().x >= this.target.tors.getWorldCenter().x ? 1 : -1;
          this.aimPart = this.openPart(SLIME_PARTS, side, this.aimPart);
          this.setPhase('fly');
        }
      }
    }
  }

  /**
   * It sticks where it hit and becomes a sensor riding on that part, rather
   * than a 2.4 kg body jointed to a 0.07 kg hand, which would tear the arm.
   */
  private stick(part: Body): void {
    this.host = part;
    // Its centre settles onto the part's surface, so the blob wraps it.
    this.hostAnchor = this.nearestOn(part, this.body.getWorldCenter());
    this.fixture.setSensor(true);
    this.holdLeft = SLIME.holdFrames;
    this.reelPart = null;
    this.regrab.clear();
    this.landed(part, 0.3);
    this.setPhase('stuck');
    this.follow();
  }

  /** While stuck: ride along, weigh the part down, keep its glue, reach for more. */
  private holdOn(dt: number): void {
    this.follow();
    const host = this.host!;
    host.applyLinearImpulse(Vec2(0, SLIME.weight * dt), host.getWorldPoint(this.hostAnchor), true);
    this.tendBonds(dt);
    this.reel(dt);
    this.holdLeft -= 1;
    if (this.holdLeft <= 0) this.peel();
  }

  /** Sit on the part it is stuck to. As a sensor nothing pushes it about. */
  private follow(): void {
    const host = this.host!;
    const p = host.getWorldPoint(this.hostAnchor);
    const [minX, maxX] = this.halfBounds;
    // A hand reaching over the net doesn't carry it across.
    this.body.setTransform(Vec2(Math.min(maxX, Math.max(minX, p.x)), p.y), 0);
    this.body.setLinearVelocity(host.getLinearVelocityFromWorldPoint(p));
  }

  /**
   * Each strand is a spring that only pulls, toward a short rest length, with
   * a capped force: strong enough to hold two limbs together through walking
   * and play, not to tear the doll. Pulled too far, it snaps.
   */
  private tendBonds(dt: number): void {
    const host = this.host!;
    const a = host.getWorldPoint(this.hostAnchor);
    const va = host.getLinearVelocityFromWorldPoint(a);
    const mA = host.getMass();
    for (let i = this.bonds.length - 1; i >= 0; i--) {
      const bond = this.bonds[i];
      const b = bond.part.getWorldPoint(bond.local);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len - bond.rest > toM(SLIME.breakPx)) {
        this.snap(i, a, b);
        continue;
      }
      bond.rest = Math.max(toM(SLIME.glueRestPx), bond.rest - toM(SLIME.cureRatePx));
      const stretch = len - bond.rest;
      if (stretch <= 0) continue;
      const nx = dx / len;
      const ny = dy / len;
      const vb = bond.part.getLinearVelocityFromWorldPoint(b);
      const vn = (vb.x - va.x) * nx + (vb.y - va.y) * ny;
      const mB = bond.part.getMass();
      // Impulse on the glued part along the strand: negative pulls it in.
      const j = Math.max(-SLIME.glueForce * dt, Math.min(0, (mA * mB) / (mA + mB) * (-stretch * SLIME.glueRate - vn)));
      bond.part.applyLinearImpulse(Vec2(nx * j, ny * j), b, true);
      host.applyLinearImpulse(Vec2(-nx * j, -ny * j), a, true);
    }
  }

  private snap(i: number, a: Vec2, b: Vec2): void {
    const [bond] = this.bonds.splice(i, 1);
    this.regrab.set(bond.part, this.age + SLIME.regrabFrames);
    // Every strand they tear loosens its hold.
    this.holdLeft -= SLIME.snapCostFrames;
    this.snaps += 1;
    this.lastSnap = { age: this.age, ax: toPx(a.x), ay: toPx(a.y), bx: toPx(b.x), by: toPx(b.y) };
  }

  /** Glue any part that reaches its core, and reel in the nearest one it could glue. */
  private reel(dt: number): void {
    if (this.bonds.length >= SLIME.maxBonds || this.phaseAge < SLIME.gripFrames) {
      this.reelPart = null;
      return;
    }
    const host = this.host!;
    const a = host.getWorldPoint(this.hostAnchor);
    for (const part of this.touchingParts()) {
      if (!this.canGlue(part)) continue;
      const b = part.getWorldPoint(this.nearestOn(part, a));
      if (Math.hypot(b.x - a.x, b.y - a.y) < toM(SLIME.glueReachPx)) this.glue(part);
      if (this.bonds.length >= SLIME.maxBonds) {
        this.reelPart = null;
        return;
      }
    }
    if (this.reelPart && this.reelAge > SLIME.reelFrames) {
      // Out of reach, behind the body: try another.
      this.regrab.set(this.reelPart, this.age + SLIME.regrabFrames);
      this.reelPart = null;
    }
    if (!this.reelPart || !this.canGlue(this.reelPart)) {
      this.reelPart = this.nearestGluable();
      this.reelAge = 0;
    }
    const part = this.reelPart;
    if (!part) return;
    this.reelAge += 1;
    // Equal and opposite, so the strand draws the two parts together
    // without pushing the doll anywhere.
    const q = part.getWorldPoint(this.nearestOn(part, a));
    const u = unit(a.x - q.x, a.y - q.y);
    const va = host.getLinearVelocityFromWorldPoint(a);
    const vq = part.getLinearVelocityFromWorldPoint(q);
    const closing = (vq.x - va.x) * u.x + (vq.y - va.y) * u.y;
    const mA = host.getMass();
    const mB = part.getMass();
    const j = Math.max(0, Math.min(SLIME.reelForce * dt, ((mA * mB) / (mA + mB)) * (SLIME.reelSpeed - closing)));
    part.applyLinearImpulse(Vec2(u.x * j, u.y * j), q, true);
    host.applyLinearImpulse(Vec2(-u.x * j, -u.y * j), a, true);
  }

  private glue(part: Body): void {
    const a = this.host!.getWorldPoint(this.hostAnchor);
    const local = this.nearestOn(part, a);
    const b = part.getWorldPoint(local);
    const rest = Math.max(toM(SLIME.glueRestPx), Math.hypot(b.x - a.x, b.y - a.y));
    this.bonds.push({ part, local, rest, age: this.age });
    if (part === this.reelPart) this.reelPart = null;
    this.landed(part, 0.2);
  }

  /**
   * The end of a limb it isn't holding yet: not the one it's on, not one
   * jointed to the part it's on, and not one that just tore free.
   */
  private canGlue(part: Body): boolean {
    const host = this.host;
    if (!host || part === host || !this.target.bodies.includes(part)) return false;
    const limb = LIMB[ud(part).part!];
    if (!GLUE_PARTS.has(ud(part).part!) || limb === LIMB[ud(host).part!]) return false;
    if (this.bonds.some((b) => LIMB[ud(b.part).part!] === limb)) return false;
    if ((this.regrab.get(part) ?? 0) > this.age) return false;
    for (let je = host.getJointList(); je; je = je.next) if (je.other === part) return false;
    return true;
  }

  private nearestGluable(): Body | null {
    const c = this.host!.getWorldPoint(this.hostAnchor);
    let best: Body | null = null;
    let bestD = toM(SLIME.reelReachPx);
    for (const b of this.target.bodies) {
      if (!this.canGlue(b)) continue;
      const q = b.getWorldCenter();
      const d = Math.hypot(q.x - c.x, q.y - c.y);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  /** The point of a doll part nearest `p`, in the part's own coordinates. */
  private nearestOn(part: Body, p: Vec2Value): Vec2 {
    const l = part.getLocalPoint(p);
    const def = PART_DEFS.get(ud(part).part!)!;
    const s = this.target.sizeScale;
    if (def.shape.kind === 'circle') {
      const r = toM(def.shape.r * s);
      const len = Math.hypot(l.x, l.y);
      return len > r ? Vec2((l.x * r) / len, (l.y * r) / len) : l;
    }
    const hw = toM(def.shape.hw * s);
    const hh = toM(def.shape.hh * s);
    return Vec2(Math.max(-hw, Math.min(hw, l.x)), Math.max(-hh, Math.min(hh, l.y)));
  }

  /**
   * Let go. Everything it glued comes free, and it springs clear, away from
   * the body and never down, as a sensor until it overlaps nothing, then
   * re-forms and flies again.
   */
  private peel(): void {
    this.bonds.length = 0;
    this.host = null;
    this.reelPart = null;
    this.solid = false;
    this.fixture.setSensor(true);
    const c = this.body.getWorldCenter();
    const t = this.target.tors.getWorldCenter();
    const u = unit(c.x - t.x, Math.min(0, c.y - t.y) - toM(10));
    this.body.setLinearVelocity(Vec2(u.x * SLIME.peelSpeed, u.y * SLIME.peelSpeed));
    this.setPhase('recover');
  }

  /** Release external grips before a round moves or restores bodies. */
  shakeOff(): void {
    if (!this.dead && this.phase === 'stuck') this.peel();
    if (!this.dead && this.variant.id === 'chameleon' && this.tongueTarget) this.releaseTongue();
  }

  /** Drifting clear as a sensor, walls and the net can't stop it, so this does. */
  private confine(): void {
    const c = this.body.getWorldCenter();
    const [minX, maxX] = this.halfBounds;
    const x = Math.min(maxX, Math.max(minX, c.x));
    const y = this.clampY(c.y);
    if (x === c.x && y === c.y) return;
    const v = this.body.getLinearVelocity();
    this.body.setTransform(Vec2(x, y), 0);
    this.body.setLinearVelocity(Vec2(x === c.x ? v.x : 0, y === c.y ? v.y : 0));
  }

  // -------------------------------------------------------------------------

  private landed(part: Body, power: number, point?: Vec2Value): void {
    const c = this.body.getWorldCenter();
    const p = part.getWorldCenter();
    this.hits += 1;
    this.lastImpact = { age: this.age, power, xPx: toPx(point?.x ?? (c.x + p.x) / 2), yPx: toPx(point?.y ?? (c.y + p.y) / 2) };
  }

  /** An active player swing pushes this body away and interrupts its attack. */
  hitByPlayer(impulse: Vec2): void {
    if (this.dead || !this.solid) return;
    if (this.variant.id === 'chameleon') {
      if (this.tongueTarget) this.releaseTongue();
      this.tongueCooldown = CHAMELEON.cooldownFrames;
      this.knockbackFrames = SWING.executerKnockFrames;
      return;
    }
    this.punchFrame = -1;
    if (this.variant.id === 'spring') {
      this.springEscapeUntil = this.age + SPRING.reboundFrames;
      this.springEscapeSide = impulse.x >= 0 ? 1 : -1;
      this.travel = 0;
      this.setPhase('rebound');
    }
    if (this.phase === 'latched') this.setPhase('hunt');
    else if (this.phase === 'stuck') this.peel();
    else if (this.variant.id !== 'spring' &&
      (this.phase === 'dash' || this.phase === 'loop' || this.phase === 'charge' || this.phase === 'rebound' || this.phase === 'fly')) {
      this.setPhase('recover');
    }
    this.knockbackFrames = SWING.executerKnockFrames;
    this.body.applyLinearImpulse(impulse, this.body.getWorldCenter(), true);
  }

  /** Velocity toward `p` at up to `speed`, easing in so it settles rather than overshoots. */
  private seek(p: Vec2Value, speed: number, gain = 5): Vec2 {
    const c = this.body.getWorldCenter();
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const len = Math.hypot(dx, dy);
    if (len < toM(1)) return Vec2(0, 0);
    const s = Math.min(speed, len * gain);
    return Vec2((dx / len) * s, (dy / len) * s);
  }

  /** Force-limited: a player in the way stops it instead of being crushed. */
  private drive(vd: Vec2, dt: number, maxForce = this.tuning.maxForce): void {
    const v = this.body.getLinearVelocity();
    const m = this.body.getMass();
    let jx = m * (vd.x - v.x);
    let jy = m * (vd.y - v.y);
    const jMax = maxForce * dt;
    const j = Math.hypot(jx, jy);
    if (j > jMax) {
      jx *= jMax / j;
      jy *= jMax / j;
    }
    this.body.applyLinearImpulse(Vec2(jx, jy), this.body.getWorldCenter(), true);
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.tongueTarget = null;
    this.timer.stop();
    this.timers.remove(this.timer);
    this.world.destroyBody(this.body);
    this.onDeath?.(this);
  }

  /** Whole seconds of life left, for the HUD. */
  get secondsLeft(): number {
    return Math.max(0, this.timer.repeatCount - this.timer.currentCount);
  }

  /** 1 at launch, 0 at death, continuous — for the button's drain. */
  get lifeFraction(): number {
    const total = this.timer.repeatCount * this.timer.delayFrames;
    return Math.max(0, 1 - this.age / total);
  }
}
