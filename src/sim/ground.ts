import { Box, Vec2, type Body, type World } from 'planck';
import { COLLISION, COURT, EXECUTER_BARRIER, PRIZE_BUTTONS, toM } from './constants';
import { PrizeButton } from './prizeButton';
import { CenterObstacle, type CenterObstacleId } from './centerObstacle';
import type { BodyUserData } from './types';

/**
 * §4 Static court and the selected centre obstacle. The rubber net supplies
 * its own dynamic segments; the remaining court retains the original geometry.
 */
export class Ground {
  readonly bodies: Body[] = [];
  readonly leftWall: Body;
  readonly rightWall: Body;
  readonly ceiling: Body;
  readonly floor: Body;
  readonly net: Body;
  readonly centerObstacle: CenterObstacle;
  readonly prizeButtons: PrizeButton[];
  /** Keeps executers on their own half. Invisible; touches nothing else. */
  readonly executerBarrier: Body;

  constructor(world: World, obstacle: CenterObstacleId = 'classic') {
    this.leftWall = this.make(world, COURT.leftWall, 'leftWall');
    this.rightWall = this.make(world, COURT.rightWall, 'rightWall');
    this.ceiling = this.make(world, COURT.ceiling, 'ceiling');
    this.floor = this.make(world, COURT.ground, 'floor');
    this.centerObstacle = new CenterObstacle(world, obstacle);
    this.net = this.centerObstacle.net;
    this.bodies.push(...this.centerObstacle.bodies);

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
