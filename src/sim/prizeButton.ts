import { Box, Vec2, type Body, type World } from 'planck';
import { BODYTYPE, EXECUTER, PRIZE_ANIM, PRIZE_BUTTONS, toM } from './constants';
import type { Executer } from './executer';
import type { PlayerId } from './player';
import type { BodyUserData } from './types';

type ButtonDef = (typeof PRIZE_BUTTONS)[number];

/**
 * §13 `prizeButton`: a static target on a wall. Every ball on it launches an
 * executer into the button's half — there is no limit. It stays pressed while
 * any executer it launched lives, and pops back out when the last one dies.
 *
 * The press is visual only — the collider never moves — so the ball's
 * contact rule (§10: vx *= 0.4) is the same pressed or not.
 */
export class PrizeButton {
  readonly body: Body;
  /** The half of the court this button sits on. */
  readonly side: PlayerId;
  /** +1 when the court lies to the button's right (left wall), -1 otherwise. */
  readonly inward: 1 | -1;
  readonly def: ButtonDef;

  /** True while none of its executers is alive. */
  armed = true;
  /** Frame stamps the renderer animates from. -Infinity means never. */
  pressedAt = -Infinity;
  releasedAt = -Infinity;
  /** Every live executer this button launched. */
  readonly executers: Executer[] = [];
  /** The first hazard launch from each button is the punching head. */
  launches = 0;

  constructor(world: World, def: ButtonDef) {
    this.def = def;
    this.side = def.side;
    this.inward = def.side === 1 ? 1 : -1;
    this.body = world.createBody({ type: 'static', position: Vec2(toM(def.x), toM(def.y)) });
    this.body.createFixture({
      shape: Box(toM(def.hw), toM(def.hh)),
      density: 0,
      friction: def.friction,
    });
    const data: BodyUserData = {
      e_bodytype: BODYTYPE.PRIZE,
      sprite: def.side === 1 ? 'prizeLeft' : 'prizeRight',
    };
    this.body.setUserData(data);
  }

  /** Where an executer comes out: just clear of the face, level with its centre. */
  launchPoint(): Vec2 {
    const faceX = this.def.x + this.inward * this.def.hw;
    return Vec2(toM(faceX + this.inward * (EXECUTER.radiusPx + 2)), toM(this.def.y));
  }

  /**
   * A ball hit. Returns false when it is the same impact still in contact
   * (post-solve reports it every step it touches), so one hit = one launch.
   */
  press(frame: number): boolean {
    if (frame - this.pressedAt < PRIZE_ANIM.hitDebounceFrames) return false;
    this.armed = false;
    this.pressedAt = frame;
    return true;
  }

  /** One of its executers died; pop back out once none are left. */
  executerDied(e: Executer, frame: number): void {
    const i = this.executers.indexOf(e);
    if (i >= 0) this.executers.splice(i, 1);
    if (this.executers.length === 0 && !this.armed) {
      this.armed = true;
      this.releasedAt = frame;
    }
  }

  /** Hazards off: the button just clicks and pops straight back. */
  releaseMomentary(frame: number): void {
    if (this.executers.length > 0) return;
    this.armed = true;
    this.releasedAt = frame;
  }
}
