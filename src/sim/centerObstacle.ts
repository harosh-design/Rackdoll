import { Box, Polygon, RevoluteJoint, Vec2, type Body, type World } from 'planck';
import { BODYTYPE, COURT, FLOOR_TOP_PX, NET_SPIKE, NET_TOP_PX, NET_X_PX, PARTS, toM } from './constants';
import { NetSpike } from './netSpike';
import type { Player } from './player';
import type { BodyUserData } from './types';

export const CENTER_OBSTACLES = [
  { id: 'classic', label: 'Classic spike', caption: 'Cuts on deep impalement', description: 'The blade cuts off deeply impaled body parts. Light touches are safe. Lost body parts return at the start of every round.' },
  { id: 'sharp', label: 'Sharp spike', caption: 'Impales and holds', description: 'A tapered spear catches body parts on its point and holds them until the next round.' },
  { id: 'blower', label: 'Air heater', caption: 'Blows players away', description: 'A thin heater pushes players away in every direction within 30% of their original height.' },
  { id: 'rubber', label: 'Rubber net', caption: 'Bends under pressure', description: 'Lean on the flexible rubber net to bend it into your opponent’s half. It springs back when released.' },
] as const;
export type CenterObstacleId = typeof CENTER_OBSTACLES[number]['id'];
export const normalizeCenterObstacle = (value: unknown): CenterObstacleId =>
  CENTER_OBSTACLES.find(option => option.id === value)?.id ?? 'classic';

const partExtent = (part: typeof PARTS[number]): number => part.shape.kind === 'circle' ? part.shape.r : part.shape.hh;
export const ORIGINAL_PLAYER_HEIGHT_PX = Math.max(...PARTS.map(part => part.dy + partExtent(part)))
  - Math.min(...PARTS.map(part => part.dy - partExtent(part)));
export const AIR_HEATER = { halfWidthPx: 3, rangePx: ORIGINAL_PLAYER_HEIGHT_PX * 0.3, acceleration: 65 } as const;
export const SHARP_SPIKE = { halfWidthPx: 6, topPx: NET_TOP_PX - NET_SPIKE.heightPx } as const;
export const RUBBER_NET = { halfWidthPx: 3, basePx: FLOOR_TOP_PX - 4, segments: 6, maxBaseAngle: 1.22, maxBendAngle: 0.35 } as const;

/** A centre obstacle owns both its collision geometry and its round-local state. */
export class CenterObstacle {
  readonly id: CenterObstacleId;
  readonly bodies: Body[] = [];
  readonly net: Body;
  readonly blade: NetSpike;
  /** Actual constraints, one per caught part; the remaining skeleton stays attached. */
  readonly pins = new Map<Body, RevoluteJoint>();
  private readonly springs: RevoluteJoint[] = [];
  private readonly restPositions = new Map<Body, Vec2>();

  constructor(private readonly world: World, id: CenterObstacleId = 'classic') {
    this.id = normalizeCenterObstacle(id);
    this.blade = new NetSpike(this.id === 'sharp'
      ? SHARP_SPIKE.halfWidthPx * NET_SPIKE.heightPx / (FLOOR_TOP_PX - SHARP_SPIKE.topPx)
      : NET_SPIKE.halfWidthPx);
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
        this.net.createFixture(Polygon([
          Vec2(toM(-SHARP_SPIKE.halfWidthPx), toM(FLOOR_TOP_PX - COURT.net.y)),
          Vec2(0, toM(SHARP_SPIKE.topPx - COURT.net.y)),
          Vec2(toM(SHARP_SPIKE.halfWidthPx), toM(FLOOR_TOP_PX - COURT.net.y)),
        ]), { friction: COURT.net.friction });
      } else {
        this.net.createFixture(Box(toM(this.id === 'blower' ? AIR_HEATER.halfWidthPx : COURT.net.hw), toM(COURT.net.hh)), {
          friction: this.id === 'blower' ? 0.2 : COURT.net.friction,
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

  beforeStep(players: readonly Player[], active = true): void {
    this.blade.capture(players);
    for (const joint of this.springs) joint.setMotorSpeed(Math.max(-2, Math.min(2, -2 * joint.getJointAngle())));
    if (this.id !== 'blower' || !active) return;
    const range = toM(AIR_HEATER.rangePx);
    for (const player of players) for (const part of PARTS) {
      if (!player.isAttached(part.name)) continue;
      const body = player.part(part.name);
      const point = body.getWorldCenter();
      const nearest = Vec2(toM(NET_X_PX), Math.max(toM(NET_TOP_PX), Math.min(toM(FLOOR_TOP_PX), point.y)));
      const delta = Vec2.sub(point, nearest);
      const distance = delta.length();
      const direction = distance > 0.0001 ? Vec2.mul(delta, 1 / distance) : Vec2(player.id === 1 ? -1 : 1, 0);
      const local = body.getLocalVector(direction);
      const radius = toM(player.sizeScale * (part.shape.kind === 'circle' ? part.shape.r
        : part.shape.hw * Math.abs(local.x) + part.shape.hh * Math.abs(local.y)));
      const clearance = Math.max(0, distance - toM(AIR_HEATER.halfWidthPx) - radius);
      if (clearance >= range) continue;
      body.applyForceToCenter(Vec2.mul(direction, body.getMass() * AIR_HEATER.acceleration * (1 - clearance / range)), true);
    }
  }

  /** Run after the solver: joints cannot be created or destroyed while it is locked. */
  afterStep(players: readonly Player[]): Player[] {
    const cut: Player[] = [];
    if (this.id !== 'classic' && this.id !== 'sharp') return cut;
    for (const player of players) {
      let severed = false;
      for (const hit of this.blade.impacts(player, this.id === 'classic')) {
        if (this.id === 'classic') severed = player.sever(hit.part) || severed;
        else {
          const body = player.part(hit.part);
          if (this.pins.has(body)) continue;
          this.pins.set(body, this.world.createJoint(new RevoluteJoint({
            bodyA: this.net, bodyB: body,
            localAnchorA: this.net.getLocalPoint(Vec2(toM(NET_X_PX), toM(hit.height))),
            localAnchorB: hit.localAnchor, collideConnected: false,
          }))!);
        }
      }
      if (severed) cut.push(player);
    }
    return cut;
  }

  resetRound(): void {
    this.blade.capture([]);
    for (const joint of this.pins.values()) this.world.destroyJoint(joint);
    this.pins.clear();
    for (const body of this.bodies) {
      body.setTransform(this.restPositions.get(body)!, 0);
      body.setLinearVelocity(Vec2(0, 0));
      body.setAngularVelocity(0);
      body.setAwake(true);
    }
    for (const joint of this.springs) joint.setMotorSpeed(0);
  }
}
