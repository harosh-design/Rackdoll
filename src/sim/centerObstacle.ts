import { Box, DistanceProxy, Polygon, RevoluteJoint, Vec2, type Body, type Vec2Value, type World } from 'planck';
import { BODYTYPE, COURT, FLOOR_TOP_PX, NET_SPIKE, NET_TOP_PX, NET_X_PX, PARTS, TIME_STEP, toM, toPx, type PartName } from './constants';
import { NetSpike, type SpikeHit } from './netSpike';
import type { Player } from './player';
import type { BodyUserData } from './types';

export const CENTER_OBSTACLES = [
  { id: 'sharp', label: 'Sharp spike', caption: 'Impales and holds', description: 'A tapered spear impales body parts that sink onto its point. Hold jump to pull free; holding down or taking a blow drives them deeper. Struggle against a strong pull and a caught arm or leg tears off.' },
  { id: 'blower', label: 'Blast fan', caption: 'Blows everything away', description: 'A blunt fan repels players, the ball, hazards and bats. Its upward draft is three times gentler than its side jets. It cannot impale.' },
  { id: 'rubber', label: 'Rubber net', caption: 'Bends under pressure', description: 'Lean on the flexible rubber net to bend it into your opponent’s half. It springs back when released.' },
] as const;
export type CenterObstacleId = typeof CENTER_OBSTACLES[number]['id'];
export const normalizeCenterObstacle = (value: unknown): CenterObstacleId =>
  CENTER_OBSTACLES.find(option => option.id === value)?.id ?? 'sharp';

const partExtent = (part: typeof PARTS[number]): number => part.shape.kind === 'circle' ? part.shape.r : part.shape.hh;
export const ORIGINAL_PLAYER_HEIGHT_PX = Math.max(...PARTS.map(part => part.dy + partExtent(part)))
  - Math.min(...PARTS.map(part => part.dy - partExtent(part)));
export const AIR_HEATER = {
  halfWidthPx: 3, rangePx: ORIGINAL_PLAYER_HEIGHT_PX * 0.3,
  acceleration: 585, upwardRatio: 1 / 3,
} as const;

/** Offset from the nearest point on the fan's vertical outlet, in metres. */
function fanOffset(point: Vec2Value): Vec2 {
  return Vec2(point.x - toM(NET_X_PX), point.y - Math.max(toM(NET_TOP_PX), Math.min(toM(FLOOR_TOP_PX), point.y)));
}

/** Actual shape support toward the fan, including rotated and detached parts. */
function bodyWindRadius(body: Body, direction: Vec2Value): number {
  const toward = body.getLocalVector(Vec2.neg(direction));
  const center = body.getLocalCenter(), proxy = new DistanceProxy();
  let radius = 0;
  for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
    const shape = fixture.getShape();
    for (let child = 0; child < shape.getChildCount(); child++) {
      proxy.set(shape, child);
      radius = Math.max(radius, Vec2.dot(Vec2.sub(proxy.getSupportVertex(toward), center), toward) + shape.getRadius());
    }
  }
  return radius;
}
export const SHARP_SPIKE = {
  halfWidthPx: 6, topPx: NET_TOP_PX - NET_SPIKE.heightPx,
  /** A caught part can be driven this far down the shaft, px below the point. */
  maxDepthPx: 72,
  /** Holding up or down slides a caught part along the shaft at this speed, m/s. */
  struggleSpeed: 1.5,
  /** A struggle stalls for a step against a heavier load along the shaft, N per kg of doll. */
  struggleForce: 40,
  /** A hazard's or opponent's blow sets the part sliding deeper; friction brakes it, m/s². */
  slideBrake: 6,
  slideMaxSpeed: 4,
  /** Bleed again each time a part is driven this much deeper, px. */
  bleedEveryPx: 10,
  /** A freed part can be caught again once its edge is this far from the point, px. */
  freedClearancePx: 12,
  /** After its last part comes free, a doll dropping past the point is not caught for this long, frames. */
  escapeGraceFrames: 20,
  /**
   * While its player struggles, a caught arm or leg strains its tendons
   * whenever they carry more than `tearForce` (N per kg of doll). The excess
   * builds up over time, and at `tearStrain` (N·s per kg) they tear.
   */
  tearForce: 30,
  tearStrain: 20,
} as const;
export const RUBBER_NET = { halfWidthPx: 3, basePx: FLOOR_TOP_PX - 4, segments: 6, maxBaseAngle: 1.22, maxBendAngle: 0.35 } as const;

/** Only arms and legs can be torn off. */
const SEVERABLE = new Set<PartName>(['ArmLeft', 'ArmRight', 'HandLeft', 'HandRight', 'FingerLeft', 'FingerRight', 'LegLeft', 'LegRight', 'FootLeft', 'FootRight']);
/** The spear's half width at the net top, where its point (the blade) begins, px. */
const SHARP_NECK_PX = SHARP_SPIKE.halfWidthPx * NET_SPIKE.heightPx / (FLOOR_TOP_PX - SHARP_SPIKE.topPx);
/** Deeper is down the shaft, away from the point. */
const SHAFT_AXIS = Vec2(0, 1);
const POINT = Vec2(toM(NET_X_PX), toM(SHARP_SPIKE.topPx));

/** One caught part. Its rider slides along the shaft, and the part turns freely on the rider. */
export interface SpikePin {
  readonly player: Player;
  readonly part: PartName;
  /** Kinematic, so it holds the part exactly until something drives it along the shaft. */
  readonly rider: Body;
  /** Rider to part, at the wound. */
  readonly wound: RevoluteJoint;
  /** The held movement keys pull off the spike (-1), drive deeper onto it (1), or neither (0). */
  struggle: -1 | 0 | 1;
  /** Any movement key is held. */
  struggling: boolean;
  /** Tendon strain built up by struggling, N·s per kg of doll. */
  strain: number;
  /** Speed down the shaft left by blows, m/s. */
  slide: number;
  /** Deepest point that has bled, px below the point. */
  bledPx: number;
}

export interface SpikeBloodstain { height: number; scale: number; age: number }

/** A centre obstacle owns both its collision geometry and its round-local state. */
export class CenterObstacle {
  readonly id: CenterObstacleId;
  readonly bodies: Body[] = [];
  readonly net: Body;
  readonly blade: NetSpike;
  /** Actual constraints, one per caught part; the remaining skeleton stays attached. */
  readonly pins = new Map<Body, SpikePin>();
  readonly bloodstains: SpikeBloodstain[] = [];
  private readonly impaledPlayers = new Set<Player>();
  /**
   * Parts just pulled off the point, with how far they must get from it, m.
   * A doll that drops back onto the point straight away is not caught again.
   */
  private readonly freed = new Map<Body, number>();
  /** Frames left before a doll that just pulled free can be caught again. */
  private readonly grace = new Map<Player, number>();
  /** The last step's length, to read the load on each wound. */
  private lastDt: number = TIME_STEP;
  private readonly springs: RevoluteJoint[] = [];
  private readonly restPositions = new Map<Body, Vec2>();

  constructor(private readonly world: World, id: CenterObstacleId = 'sharp') {
    this.id = normalizeCenterObstacle(id);
    this.blade = new NetSpike(SHARP_NECK_PX);
    if (this.id === 'rubber') {
      // Clearance lets the foot rotate without wedging its corner into the floor.
      const base = world.createBody({ position: Vec2(toM(NET_X_PX), toM(RUBBER_NET.basePx)) });
      const height = (RUBBER_NET.basePx - NET_TOP_PX) / RUBBER_NET.segments;
      let previous = base;
      for (let i = 0; i < RUBBER_NET.segments; i++) {
        const y = RUBBER_NET.basePx - height * (i + 0.5);
        const body = this.makeBody(y, true);
        body.createFixture(Box(toM(RUBBER_NET.halfWidthPx), toM(height / 2)), {
          density: 0.35, friction: 0.7, restitution: 0.45,
        });
        const limit = i === 0 ? RUBBER_NET.maxBaseAngle : RUBBER_NET.maxBendAngle;
        this.springs.push(world.createJoint(new RevoluteJoint({
          enableLimit: true, lowerAngle: -limit, upperAngle: limit,
          enableMotor: true, motorSpeed: 0, maxMotorTorque: i === 0 ? 4 : 1.5,
        }, previous, body, Vec2(toM(NET_X_PX), toM(RUBBER_NET.basePx - height * i))))!);
        previous = body;
      }
      this.net = this.bodies[0];
    } else {
      this.net = this.makeBody(COURT.net.y);
      if (this.id === 'sharp') {
        // The top of the point is not solid, so it can sink into a part.
        // Only a deep insertion catches.
        this.net.createFixture(Polygon([
          Vec2(toM(-SHARP_SPIKE.halfWidthPx), toM(FLOOR_TOP_PX - COURT.net.y)),
          Vec2(toM(-SHARP_NECK_PX), toM(NET_TOP_PX - COURT.net.y)),
          Vec2(toM(SHARP_NECK_PX), toM(NET_TOP_PX - COURT.net.y)),
          Vec2(toM(SHARP_SPIKE.halfWidthPx), toM(FLOOR_TOP_PX - COURT.net.y)),
        ]), { friction: COURT.net.friction });
        // A caught part is joined to the rider, not the net, so let it pass along the shaft here.
        world.on('pre-solve', contact => {
          const a = contact.getFixtureA().getBody(), b = contact.getFixtureB().getBody();
          if ((a === this.net && this.pins.has(b)) || (b === this.net && this.pins.has(a))) contact.setEnabled(false);
        });
      } else {
        this.net.createFixture(Box(toM(AIR_HEATER.halfWidthPx), toM(COURT.net.hh)), {
          friction: 0.2,
        });
      }
    }
  }

  private makeBody(y: number, dynamic = false): Body {
    const body = this.world.createBody({
      type: dynamic ? 'dynamic' : 'static', position: Vec2(toM(NET_X_PX), toM(y)),
      gravityScale: dynamic ? 0 : 1, linearDamping: dynamic ? 2.5 : 0, angularDamping: 2, bullet: dynamic,
    });
    body.setUserData({ e_bodytype: BODYTYPE.WALL, sprite: 'net' } satisfies BodyUserData);
    this.bodies.push(body);
    this.restPositions.set(body, body.getPosition().clone());
    return body;
  }

  /**
   * `steer` gives a player's held movement keys as a screen direction, or
   * null for a CPU. Only their component along the shaft moves a caught part.
   */
  beforeStep(
    players: readonly Player[], active = true,
    steer?: (player: Player) => Vec2Value | null, dt: number = TIME_STEP,
  ): void {
    // The capped fan and the rubber divider never sample the spear's blade.
    this.blade.capture(this.id === 'sharp' ? players : []);
    for (const stain of this.bloodstains) stain.age = Math.min(180, stain.age + 1);
    for (const pin of this.pins.values()) this.driveRider(pin, active ? steer?.(pin.player) ?? null : null, dt);
    // Blows count once, on the step after they land.
    for (const player of players) player.blows.setZero();
    this.lastDt = dt;
    for (const joint of this.springs) joint.setMotorSpeed(Math.max(-2, Math.min(2, -2 * joint.getJointAngle())));
    if (this.id !== 'blower' || !active) return;
    for (let body = this.world.getBodyList(); body; body = body.getNext()) {
      // Rails are invisible control machinery, not gameplay objects.
      if (body.isStatic() || !body.getFixtureList() || players.some(player => body === player.prismBody)) continue;
      const point = body.getWorldCenter();
      const direction = fanOffset(point);
      if (direction.normalize() < 0.0001) direction.set(1, 0);
      const acceleration = this.windAt(point, bodyWindRadius(body, direction));
      if (acceleration.lengthSquared() === 0) continue;
      if (body.isDynamic()) body.applyForceToCenter(Vec2.mul(acceleration, body.getMass()), true);
      else body.setLinearVelocity(Vec2.add(body.getLinearVelocity(), Vec2.mul(acceleration, dt)));
    }
  }

  /** Shared by physical objects and flying familiars. Inputs are metres, output m/s². */
  windAt(point: Vec2Value, radius = 0): Vec2 {
    if (this.id !== 'blower') return Vec2(0, 0);
    const direction = fanOffset(point), distance = direction.normalize();
    if (distance < 0.0001) direction.set(1, 0);
    const clearance = Math.max(0, distance - toM(AIR_HEATER.halfWidthPx) - radius);
    const strength = AIR_HEATER.acceleration * Math.max(0, 1 - clearance / toM(AIR_HEATER.rangePx));
    return Vec2(direction.x * strength, direction.y * strength * (direction.y < 0 ? AIR_HEATER.upwardRatio : 1));
  }

  /** Run after the solver: joints cannot be created or destroyed while it is locked. */
  afterStep(players: readonly Player[]): Player[] {
    const cut: Player[] = [];
    if (this.id !== 'sharp') return cut;
    cut.push(...this.strainTendons());
    for (const pin of [...this.pins.values()]) this.settlePin(pin);
    for (const [body, clearance] of this.freed) {
      if (Vec2.distance(body.getWorldCenter(), POINT) > clearance) this.freed.delete(body);
    }
    for (const [player, frames] of this.grace) {
      if (frames > 1) this.grace.set(player, frames - 1); else this.grace.delete(player);
    }
    for (const player of players) {
      for (const hit of this.blade.impacts(player)) {
        const body = player.part(hit.part);
        if (this.pins.has(body) || this.freed.has(body) || this.grace.has(player)) continue;
        this.impale(player, hit);
        // Record a new pin once, rather than every contact frame.
        this.bleed(hit.height, player.partScale(hit.part));
      }
      if (this.impaledPlayers.has(player)) player.healLigaments();
    }
    return cut;
  }

  /** Depth of a caught part below the point, px, or null when it is not caught. */
  depthPx(body: Body): number | null {
    const pin = this.pins.get(body);
    return pin ? toPx(pin.rider.getPosition().y) - SHARP_SPIKE.topPx : null;
  }

  private impale(player: Player, hit: SpikeHit): void {
    const body = player.part(hit.part);
    const rider = this.world.createBody({ type: 'kinematic', position: Vec2(toM(NET_X_PX), toM(hit.height)) });
    const wound = this.world.createJoint(new RevoluteJoint({
      bodyA: rider, bodyB: body, localAnchorA: Vec2(0, 0), localAnchorB: hit.localAnchor, collideConnected: false,
    }))!;
    const depth = hit.height - SHARP_SPIKE.topPx;
    this.pins.set(body, { player, part: hit.part, rider, wound, struggle: 0, struggling: false, strain: 0, slide: 0, bledPx: depth });
    player.stretchAt(hit.part);
    this.impaledPlayers.add(player);
  }

  /**
   * Before the step, set the rider's speed along the shaft. Held movement
   * keys drive it toward the point or deeper. Otherwise it holds, except
   * that a hazard's or opponent's blow sends the part sliding deeper.
   */
  private driveRider(pin: SpikePin, steer: Vec2Value | null, dt: number): void {
    const { player } = pin;
    pin.struggling = steer !== null && (steer.x !== 0 || steer.y !== 0);
    if (!player.isAttached(pin.part)) {
      // A torn-off part stays where it is on the spike.
      pin.struggle = 0; pin.slide = 0;
      pin.rider.setLinearVelocity(Vec2(0, 0));
      return;
    }
    const along = steer ? Math.sign(Vec2.dot(steer, SHAFT_AXIS)) as -1 | 0 | 1 : 0;
    // The load the wound held toward the base during the last step, N.
    const load = -Vec2.dot(pin.wound.getReactionForce(1 / this.lastDt), SHAFT_AXIS);
    pin.struggle = -along * load > player.mass * SHARP_SPIKE.struggleForce ? 0 : along;
    // A blow jars the hanging doll down the shaft: fully when it points down
    // the shaft, half when it is sideways, and not at all when it lifts.
    const blow = (player.blows.length() + Vec2.dot(player.blows, SHAFT_AXIS)) / 2;
    const room = toM(SHARP_SPIKE.topPx + SHARP_SPIKE.maxDepthPx) - pin.rider.getPosition().y;
    pin.slide = room <= 0 ? 0
      : Math.min(SHARP_SPIKE.slideMaxSpeed, Math.max(0, pin.slide - SHARP_SPIKE.slideBrake * dt) + blow);
    const speed = Math.min(pin.struggle * SHARP_SPIKE.struggleSpeed + pin.slide, room / dt);
    pin.rider.setLinearVelocity(Vec2.mul(SHAFT_AXIS, speed));
  }

  /**
   * After the step: struggling against a strong pull strains a caught arm's
   * or leg's tendons until they tear. The torn-off part stays on the spike
   * and the rest of the doll comes free. Returns the players who lost a limb.
   */
  private strainTendons(): Player[] {
    const torn: SpikePin[] = [];
    // Read every tension before tearing anything: a tear rebuilds the links it leaves.
    for (const pin of this.pins.values()) {
      const { player } = pin;
      if (!pin.struggling || !SEVERABLE.has(pin.part) || !player.isAttached(pin.part)) continue;
      const tension = player.tendonTension(pin.part, 1 / this.lastDt) / player.mass;
      const before = pin.strain;
      pin.strain += Math.max(0, tension - SHARP_SPIKE.tearForce) * this.lastDt;
      // The wound bleeds as the tendons give, a third of the way at a time.
      const third = SHARP_SPIKE.tearStrain / 3;
      if (Math.floor(pin.strain / third) > Math.floor(before / third)) this.bleed(this.heightPx(pin), pin.player.partScale(pin.part));
      if (pin.strain >= SHARP_SPIKE.tearStrain) torn.push(pin);
    }
    const players: Player[] = [];
    for (const pin of torn) {
      if (!pin.player.isAttached(pin.part) || !pin.player.tearAt(pin.part)) continue;
      if (!players.includes(pin.player)) players.push(pin.player);
      this.graceIfFree(pin.player);
    }
    return players;
  }

  /** A doll with nothing left on the spike gets a moment to drop clear of the point. */
  private graceIfFree(player: Player): void {
    for (const pin of this.pins.values()) if (pin.player === player && player.isAttached(pin.part)) return;
    this.grace.set(player, SHARP_SPIKE.escapeGraceFrames);
  }

  private heightPx(pin: SpikePin): number {
    return toPx(pin.rider.getPosition().y);
  }

  /** After the step: free a part pulled past the point, and bleed where it was driven deeper. */
  private settlePin(pin: SpikePin): void {
    const body = pin.player.part(pin.part);
    if (!pin.player.isAttached(pin.part)) return;
    const depth = this.depthPx(body)!;
    if (pin.struggle < 0 && depth <= 0) {
      this.world.destroyBody(pin.rider); // and its wound joint
      this.pins.delete(body);
      const shape = PARTS.find(def => def.name === pin.part)!.shape;
      const radius = shape.kind === 'circle' ? shape.r : Math.hypot(shape.hw, shape.hh);
      this.freed.set(body, toM(radius * pin.player.partScale(pin.part) + SHARP_SPIKE.freedClearancePx));
      this.graceIfFree(pin.player);
      pin.player.freePart(pin.part);
      return;
    }
    if (depth < pin.bledPx + SHARP_SPIKE.bleedEveryPx) return;
    pin.bledPx = depth;
    this.bleed(SHARP_SPIKE.topPx + depth, pin.player.partScale(pin.part));
  }

  private bleed(height: number, scale: number): void {
    if (this.bloodstains.length === 24) this.bloodstains.shift();
    this.bloodstains.push({ height, scale, age: 0 });
  }

  resetRound(): void {
    this.blade.capture([]);
    for (const pin of this.pins.values()) this.world.destroyBody(pin.rider);
    this.pins.clear();
    this.freed.clear();
    this.grace.clear();
    for (const player of this.impaledPlayers) player.releaseImpalement();
    this.impaledPlayers.clear();
    this.bloodstains.length = 0;
    for (const body of this.bodies) {
      body.setTransform(this.restPositions.get(body)!, 0);
      body.setLinearVelocity(Vec2(0, 0));
      body.setAngularVelocity(0);
      body.setAwake(true);
    }
    for (const joint of this.springs) joint.setMotorSpeed(0);
  }
}
