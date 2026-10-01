import { Box, Vec2, type Body, type World } from 'planck';
import { COLLISION, COURT, EXECUTER_BARRIER, PRIZE_BUTTONS, toM } from './constants';
import { PrizeButton } from './prizeButton';
import type { BodyUserData } from './types';

/**
 * §4 Court. Every body is static because the original leaves the polygon defs
 * at density 0 — it still calls SetMassFromShapes(), which yields mass 0 and so
 * a body the solver treats as immovable (§16.10). We say `static` outright.
 */
export class Ground {
  readonly bodies: Body[] = [];
  readonly leftWall: Body;
  readonly rightWall: Body;
  readonly ceiling: Body;
  readonly floor: Body;
  readonly net: Body;
  readonly prizeButtons: PrizeButton[];
  /** Keeps executers on their own half. Invisible; touches nothing else. */
  readonly executerBarrier: Body;

  constructor(world: World) {
    this.leftWall = this.make(world, COURT.leftWall, 'leftWall');
    this.rightWall = this.make(world, COURT.rightWall, 'rightWall');
    this.ceiling = this.make(world, COURT.ceiling, 'ceiling');
    this.floor = this.make(world, COURT.ground, 'floor');
    this.net = this.make(world, COURT.net, 'net');

    // §13 Prize buttons: two static targets at the far left and right.
    this.prizeButtons = PRIZE_BUTTONS.map((d) => new PrizeButton(world, d));
    for (const b of this.prizeButtons) this.bodies.push(b.body);

    // Not in the original: continues the net up to the ceiling, for
    // executers only, so one can never cross to the other half. Filtered so
    // no original body (ball, dolls) ever meets it.
    const b = EXECUTER_BARRIER;
    this.executerBarrier = world.createBody({
      type: 'static',
      position: Vec2(toM(b.x), toM((b.top + b.bottom) / 2)),
    });
    this.executerBarrier.createFixture({
      shape: Box(toM(b.hw), toM((b.bottom - b.top) / 2)),
      density: 0,
      filterCategoryBits: COLLISION.EXECUTER_BARRIER,
      filterMaskBits: COLLISION.EXECUTER,
    });
    this.executerBarrier.setUserData({ e_bodytype: null, sprite: 'executerBarrier' } as BodyUserData);
  }

  prizeButtonFor(body: Body): PrizeButton | undefined {
    return this.prizeButtons.find((p) => p.body === body);
  }

  private make(
    world: World,
    d: { x: number; y: number; hw: number; hh: number; friction: number; type: number | null },
    sprite: string,
  ): Body {
    const body = world.createBody({
      type: 'static',
      position: Vec2(toM(d.x), toM(d.y)),
    });
    body.createFixture({
      shape: Box(toM(d.hw), toM(d.hh)),
      density: 0,
      friction: d.friction,
    });
    const data: BodyUserData = { e_bodytype: d.type as BodyUserData['e_bodytype'], sprite };
    body.setUserData(data);
    this.bodies.push(body);
    return body;
  }
}
