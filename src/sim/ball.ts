import { Circle, Vec2, type Body, type World } from 'planck';
import { BALL, BODYTYPE, SPAWN_BALL_PX, toM } from './constants';
import type { BodyUserData } from './types';
import { PADEL, type Sport } from './padel';

/** §9 Ball. */
export class Ball {
  readonly body: Body;
  /** 0 while in flight, otherwise the id of whoever holds it. */
  ballOfPlayer: 0 | 1 | 2 = 0;
  readonly radiusPx: number;

  constructor(world: World, xPx = SPAWN_BALL_PX.x, yPx = SPAWN_BALL_PX.y, sport: Sport = 'volleyball') {
    this.radiusPx = sport === 'padel' ? PADEL.ballRadiusPx : BALL.radiusPx;
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
      restitution: sport === 'padel' ? PADEL.ballRestitution : BALL.restitution,
    });
    // §16.3 — explicit, after CreateShape, overriding the density.
    this.body.setMassData({
      mass: sport === 'padel' ? PADEL.ballMass : BALL.mass,
      center: Vec2(0, 0),
      I: sport === 'padel' ? PADEL.ballInertia : BALL.inertia,
    });
    this.body.setUserData({ e_bodytype: BODYTYPE.BALL, sprite: 'Ball' } as BodyUserData);
  }

  /** §9 — run LAST in every frame. Four independent clamps. */
  update(): void {
    const v = this.body.getLinearVelocity();
    let { x, y } = v;
    if (y > BALL.maxVy) y = BALL.maxVy;
    if (y < -BALL.maxVy) y = -BALL.maxVy;
    if (x > BALL.maxVx) x = BALL.maxVx;
    if (x < -BALL.maxVx) x = -BALL.maxVx;
    if (x !== v.x || y !== v.y) this.body.setLinearVelocity(Vec2(x, y));
  }

  get position(): Vec2 { return this.body.getWorldCenter(); }
  get velocity(): Vec2 { return this.body.getLinearVelocity(); }
  get held(): boolean { return this.body.getJointList() != null; }

  reset(xPx = SPAWN_BALL_PX.x, yPx = SPAWN_BALL_PX.y): void {
    this.body.setTransform(Vec2(toM(xPx), toM(yPx)), 0);
    this.body.setLinearVelocity(Vec2(0, 0));
    this.body.setAngularVelocity(0);
    this.ballOfPlayer = 0;
  }
}
