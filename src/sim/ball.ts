import { Circle, Vec2, type Body, type World } from 'planck';
import { BALL, BODYTYPE, SPAWN_BALL_PX, toM } from './constants';
import type { BodyUserData } from './types';

/** §9 Ball. */
export class Ball {
  readonly body: Body;
  /** 0 while in flight, otherwise the id of whoever holds it. */
  ballOfPlayer: 0 | 1 | 2 = 0;
  readonly radiusPx: number;
  /** Temporary higher speed cap for a super shot. */
  boostFrames = 0;

  constructor(world: World, xPx = SPAWN_BALL_PX.x, yPx = SPAWN_BALL_PX.y) {
    this.radiusPx = BALL.radiusPx;
    this.body = world.createBody({
      type: 'dynamic',
      position: Vec2(toM(xPx), toM(yPx)),
      angularDamping: 0,
      linearDamping: 0,
      // §16.9 — restitution 1 at up to 20 m/s tunnels without CCD.
      bullet: true,
    });
    this.body.createFixture({
      shape: Circle(toM(this.radiusPx)),
      density: BALL.density,
      friction: BALL.friction, // the contact listener identifies the ball by this
      restitution: BALL.restitution,
    });
    // §16.3 — explicit, after CreateShape, overriding the density.
    this.body.setMassData({
      mass: BALL.mass,
      center: Vec2(0, 0),
      I: BALL.inertia,
    });
    this.body.setUserData({ e_bodytype: BODYTYPE.BALL, sprite: 'Ball' } as BodyUserData);
  }

  /** §9 — run LAST in every frame. Four independent clamps. */
  update(): void {
    const v = this.body.getLinearVelocity();
    let { x, y } = v;
    const boost = this.boostFrames > 0 ? 1.5 : 1;
    if (y > BALL.maxVy * boost) y = BALL.maxVy * boost;
    if (y < -BALL.maxVy * boost) y = -BALL.maxVy * boost;
    if (x > BALL.maxVx * boost) x = BALL.maxVx * boost;
    if (x < -BALL.maxVx * boost) x = -BALL.maxVx * boost;
    if (x !== v.x || y !== v.y) this.body.setLinearVelocity(Vec2(x, y));
    if (this.boostFrames > 0) this.boostFrames--;
  }

  get position(): Vec2 { return this.body.getWorldCenter(); }
  get velocity(): Vec2 { return this.body.getLinearVelocity(); }
  get held(): boolean { return this.body.getJointList() != null; }

  reset(xPx = SPAWN_BALL_PX.x, yPx = SPAWN_BALL_PX.y): void {
    this.body.setTransform(Vec2(toM(xPx), toM(yPx)), 0);
    this.body.setLinearVelocity(Vec2(0, 0));
    this.body.setAngularVelocity(0);
    this.ballOfPlayer = 0;
    this.boostFrames = 0;
  }
}
