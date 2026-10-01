import { Vec2, type Body, type Contact, type World } from 'planck';
import {
  BALL, BALL_BODY_RESTITUTION, BALL_VX_SCALE_PRIZE, BALL_VX_SCALE_WALL, BODYTYPE, EXECUTER_DOLL_FRICTION,
  type PartName,
} from './constants';
import { bodyTypeOf, ud } from './types';
import type { Sport } from './padel';

/**
 * §10 MyContactListener::Result — a post-solve callback.
 *
 * It identifies the ball by fixture friction == 0.05 and reads the other
 * body's `e_bodytype`. Players (type 1) are deliberately absent: the ball keeps
 * everything it has off a doll.
 */
export interface ContactFlags {
  /** The rally is over — the ball hit the floor. */
  onBallDown: boolean;
  /** The ball hit a prize button this rally (§10; kept for parity). */
  bYesPrize: boolean;
  /**
   * Prize button bodies the ball hit during the last step. Bodies can't be
   * created mid-step, so the world launches executers from this list right
   * after the step.
   */
  prizeHits: Body[];
  /** Player parts that met the ball during the physics step. */
  ballPlayerHits?: Array<{ playerId: 1 | 2; part: PartName }>;
  padelFloorHit?: boolean;
  padelWallHit?: boolean;
  padelNetHit?: boolean;
  padelBodyHit?: 1 | 2;
}

export function installContactListener(world: World, flags: ContactFlags, sport: Sport = 'volleyball'): void {
  if (sport === 'padel') {
    world.on('begin-contact', (contact: Contact) => {
      const fa = contact.getFixtureA();
      const fb = contact.getFixtureB();
      const ta = bodyTypeOf(fa.getBody());
      const tb = bodyTypeOf(fb.getBody());
      const other = ta === BODYTYPE.BALL ? fb : tb === BODYTYPE.BALL ? fa : null;
      if (!other) return;
      const type = bodyTypeOf(other.getBody());
      if (type === BODYTYPE.GROUND) flags.padelFloorHit = true;
      if (type === BODYTYPE.WALL && ud(other.getBody()).sprite !== 'net') flags.padelWallHit = true;
      if (type === BODYTYPE.WALL && ud(other.getBody()).sprite === 'net') flags.padelNetHit = true;
      if (type === BODYTYPE.PLAYER && !(other.getUserData() as { racket?: boolean } | null)?.racket) {
        flags.padelBodyHit = ud(other.getBody()).playerId;
      }
    });
    return;
  }
  world.on('post-solve', (contact: Contact) => {
    const fa = contact.getFixtureA();
    const fb = contact.getFixtureB();

    let ballFixture = null;
    let other = null;
    if (fa.getFriction() === BALL.friction) { ballFixture = fa; other = fb; }
    else if (fb.getFriction() === BALL.friction) { ballFixture = fb; other = fa; }
    if (!ballFixture || !other) return;

    const ballBody = ballFixture.getBody();
    const type = bodyTypeOf(other.getBody());
    const v = ballBody.getLinearVelocity();

    switch (type) {
      case BODYTYPE.PLAYER: {
        const data = ud(other.getBody());
        if (data.playerId && data.part) {
          flags.ballPlayerHits?.push({ playerId: data.playerId, part: data.part });
        }
        break;
      }
      case BODYTYPE.PRIZE:
        ballBody.setLinearVelocity(Vec2(v.x * BALL_VX_SCALE_PRIZE, v.y));
        flags.bYesPrize = true;
        if (!flags.prizeHits.includes(other.getBody())) flags.prizeHits.push(other.getBody());
        break;
      case BODYTYPE.WALL: // walls and net
        ballBody.setLinearVelocity(Vec2(v.x * BALL_VX_SCALE_WALL, v.y));
        break;
      case BODYTYPE.GROUND:
        flags.onBallDown = true;
        break;
      default:
        break;
    }
  });
}

/**
 * Not in the original. The ball comes off a body part 30% less elastic than
 * restitution 1 — except off the head, which keeps its 1.2. Box2D mixes
 * restitution as the max of the two fixtures, so this is set per contact.
 *
 * An executer meets a doll inelastically: it shoves the
 * doll instead of batting a 0.07 kg hand away at twice its own speed, which
 * is what tore the joints (with restitution 1 on both, Box2D's max-mix gives
 * a perfectly elastic hit). Everything else keeps its own restitution.
 */
export function installContactTweaks(world: World, sport: Sport = 'volleyball'): void {
  world.on('pre-solve', (contact: Contact) => {
    const fa = contact.getFixtureA();
    const fb = contact.getFixtureB();
    const ta = bodyTypeOf(fa.getBody());
    const tb = bodyTypeOf(fb.getBody());
    if (sport === 'padel' && ((ta === BODYTYPE.BALL && tb === BODYTYPE.PLAYER) ||
        (tb === BODYTYPE.BALL && ta === BODYTYPE.PLAYER))) {
      contact.setEnabled(false);
      return;
    }
    const partOf = (t: unknown, f: typeof fa) =>
      t === BODYTYPE.PLAYER ? (f.getBody().getUserData() as { part?: string } | null)?.part : undefined;
    if (ta === BODYTYPE.BALL || tb === BODYTYPE.BALL) {
      const part = ta === BODYTYPE.BALL ? partOf(tb, fb) : partOf(ta, fa);
      if (part && part !== 'Head') contact.setRestitution(BALL_BODY_RESTITUTION);
      return;
    }
    if (
      (ta === BODYTYPE.EXECUTER && tb === BODYTYPE.PLAYER) ||
      (tb === BODYTYPE.EXECUTER && ta === BODYTYPE.PLAYER)
    ) {
      contact.setRestitution(0);
      // Nearly frictionless too: it spins fast while pinning (a 8 m/s surface),
      // and with ordinary friction that spin whips the doll's light limbs.
      contact.setFriction(EXECUTER_DOLL_FRICTION);
    }
  });
}
