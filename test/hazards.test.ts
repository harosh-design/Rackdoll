import { Vec2 } from 'planck';
import { describe, expect, it } from 'vitest';
import { COMET, TIME_STEP, toM } from '../src/sim/constants';
import { Executer } from '../src/sim/executer';
import { executerVariant } from '../src/sim/executerVariants';
import { hazardWorld } from './helpers';

describe('fire skull facing', () => {
  it('turns toward the player from every side, regardless of velocity or physical spin', () => {
    const gw = hazardWorld();
    const skull = new Executer({ world: gw.world, timers: gw.timers, target: gw.p1, side: 1,
      variant: executerVariant('comet'), origin: Vec2(toM(-100), toM(100)) });
    for (const [dx, dy] of [[-100, 0], [100, 0], [0, -100], [0, 100]]) {
      const head = gw.p1.head.getWorldCenter();
      const torso = gw.p1.tors.getWorldCenter();
      const aim = Vec2(torso.x, (head.y + torso.y) / 2);
      skull.body.setTransform(Vec2(aim.x + toM(dx), aim.y + toM(dy)), 1.7);
      skull.body.setLinearVelocity(Vec2(dx, dy));
      skull.knockbackFrames = 100;
      for (let f = 0; f < 30; f++) {
        const previous = skull.facingAngle;
        skull.update(TIME_STEP);
        expect(Math.abs(skull.facingAngle - previous)).toBeLessThanOrEqual(COMET.turnSpeed * TIME_STEP + 1e-9);
      }
      const desired = Math.atan2(-dy, -dx);
      const error = skull.facingAngle - desired;
      expect(Math.abs(Math.atan2(Math.sin(error), Math.cos(error)))).toBeLessThan(0.01);
      expect(skull.body.getAngle()).toBe(1.7);
    }
    skull.destroy();
  });
});
