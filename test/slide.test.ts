import { Vec2 } from 'planck';
import { describe, expect, it } from 'vitest';
import { DIVE, FLIP, SLIDE, toM } from '../src/sim/constants';
import { KEYS } from '../src/sim/control';
import { hazardWorld, run, world } from './helpers';

describe('football slide', () => {
  it.each([[1, -1], [1, 1], [2, -1], [2, 1]] as const)(
    'slides player %s feet first in direction %s and recovers', (id, direction) => {
      const gw = hazardWorld({ hazards: false });
      const player = id === 1 ? gw.p1 : gw.p2;
      const startX = player.ass.getPosition().x;
      // The ball is behind the slide: its position must not determine direction.
      gw.ball.body.setTransform(Vec2(startX - direction * toM(100), toM(100)), 0);
      expect(gw.slide(player, direction)).toBe(true);
      expect(player.sliding).toBe(true);
      expect(player.diving || player.flipping).toBe(false);
      expect(player.prismBody.getLinearVelocity().x * direction).toBeGreaterThan(0);
      expect(gw.swingCooldownFramesLeft(id)).toBe(0);
      expect(gw.slide(player, direction)).toBe(false);
      let ledWithFeet = false;
      for (let frame = 0; frame < SLIDE.maxFrames + 1; frame++) {
        gw.step();
        if (frame >= 4 && frame < SLIDE.reachFrames) {
          const head = player.head.getPosition();
          ledWithFeet ||= (['FootLeft', 'FootRight'] as const).every(part => {
            const foot = player.part(part).getPosition();
            return (foot.x - head.x) * direction > toM(35) && foot.y > head.y;
          });
        }
      }
      expect(ledWithFeet).toBe(true);
      expect((player.ass.getPosition().x - startX) * direction).toBeGreaterThan(toM(20));
      expect(player.performingAcrobatics).toBe(false);
      expect(player.railV.getBodyB()).toBe(player.head);
      expect(player.revolutes.every(joint => !joint.isMotorEnabled())).toBe(true);
      expect(player.bodies.every(body => Number.isFinite(body.getPosition().y))).toBe(true);
    },
  );

  const combinations = ([1, 2] as const).flatMap(id =>
    ([-1, 1] as const).flatMap(direction =>
      (['direction-first', 'attack-first', 'together'] as const).map(order => ({ id, direction, order }))));
  it.each(combinations)('starts player $id sliding $direction with $order input', ({ id, direction, order }) => {
    const gw = hazardWorld({ hazards: false });
    const player = id === 1 ? gw.p1 : gw.p2;
    const keys = KEYS[id];
    const directionKey = direction === 1 ? keys.right : keys.left;
    if (order === 'direction-first') {
      gw.control.press(directionKey);
      gw.step();
    } else if (order === 'attack-first') {
      gw.control.press(keys.serve);
      gw.step();
      expect(gw.control.chargeLevel(id)).not.toBeNull();
    }
    gw.control.press(directionKey);
    gw.control.press(keys.serve);
    gw.step();
    expect(player.sliding).toBe(true);
    expect(player.diving || player.flipping).toBe(false);
    expect(player.prismBody.getLinearVelocity().x * direction).toBeGreaterThan(0);
    expect(gw.control.chargeLevel(id)).toBeNull();
    gw.control.release(keys.serve);
    gw.step();
    expect(player.flipping).toBe(false);
  });

  it('uses reassigned direction and attack keys', () => {
    const gw = hazardWorld({ hazards: false, bindings: {
      1: { ...KEYS[1], right: 'KeyL', serve: 'KeyG' }, 2: KEYS[2],
    } });
    gw.control.press('KeyG');
    gw.step();
    gw.control.press('KeyL');
    gw.step();
    expect(gw.p1.sliding).toBe(true);
    expect(gw.p1.prismBody.getLinearVelocity().x).toBeGreaterThan(0);
  });

  it('gives down priority over sideways input', () => {
    const gw = hazardWorld({ hazards: false });
    gw.control.press(40);
    gw.control.press(39);
    gw.control.press(32);
    gw.step();
    expect(gw.p1.diving).toBe(true);
    expect(gw.p1.sliding).toBe(false);
  });

  it('cancels opposite directions instead of choosing a slide direction', () => {
    const gw = hazardWorld({ hazards: false });
    gw.control.press(37);
    gw.control.press(39);
    gw.control.press(32);
    gw.step();
    expect(gw.p1.sliding).toBe(false);
    expect(gw.control.chargeLevel(1)).not.toBeNull();
    gw.control.release(32);
    gw.step();
    expect(gw.p1.flipping).toBe(true);
  });

  it('allows another slide and then a dive while the flip is cooling down', () => {
    const gw = hazardWorld({ hazards: false });
    gw.flip(gw.p1);
    run(gw, FLIP.maxFrames + 1);
    gw.control.press(39);
    for (let attempt = 0; attempt < 2; attempt++) {
      gw.control.press(32);
      gw.step();
      expect(gw.p1.sliding).toBe(true);
      gw.control.release(32);
      run(gw, SLIDE.maxFrames + 1);
      expect(gw.p1.sliding).toBe(false);
    }
    gw.control.press(40);
    gw.control.press(32);
    gw.step();
    expect(gw.p1.diving).toBe(true);
    expect(gw.swingCooldownFramesLeft(1)).toBeGreaterThan(0);
    gw.control.release(32);
    run(gw, DIVE.maxFrames + 1);
    expect(gw.p1.performingAcrobatics).toBe(false);
  });

  it('does not repeat a held slide or trigger a flip when attack is released', () => {
    const gw = hazardWorld({ hazards: false });
    gw.control.press(37);
    gw.control.press(32);
    run(gw, SLIDE.maxFrames + 3);
    expect(gw.p1.performingAcrobatics).toBe(false);
    gw.control.release(32);
    gw.step();
    expect(gw.p1.performingAcrobatics).toBe(false);
    expect(gw.swingCooldownFramesLeft(1)).toBe(0);
  });

  it('keeps serving first when the attack key is combined with movement', () => {
    const gw = world();
    run(gw, 90);
    gw.control.press(39);
    gw.control.press(32);
    gw.step();
    expect(gw.ball.held).toBe(false);
    expect(gw.p1.performingAcrobatics).toBe(false);
    gw.control.release(32);
    gw.step();
    expect(gw.p1.performingAcrobatics).toBe(false);
  });

  it('supports starting in the air, freezes on pause and clears on a new round', () => {
    const gw = hazardWorld({ hazards: false });
    gw.p1.jump();
    run(gw, 4);
    expect(gw.p1.touchingGround).toBe(false);
    gw.control.press(37);
    gw.control.press(32);
    run(gw, 3);
    expect(gw.p1.sliding).toBe(true);
    const position = gw.p1.head.getPosition().clone();
    gw.paused = true;
    run(gw, SLIDE.maxFrames);
    expect(gw.p1.head.getPosition()).toEqual(position);
    gw.paused = false;
    gw.game.newRound();
    expect(gw.p1.sliding).toBe(false);
    expect(gw.p1.revolutes.every(joint => !joint.isMotorEnabled())).toBe(true);
  });

  it.each(['tiny', 'giant', 'injury'] as const)('recovers from a slide with %s', change => {
    const gw = hazardWorld({ hazards: false });
    gw.slide(gw.p1, -1);
    run(gw, 3);
    if (change === 'injury') gw.p1.sever('ArmLeft');
    else gw.powerUps.activate(1, change, gw.frame);
    run(gw, SLIDE.maxFrames + 10);
    expect(gw.p1.performingAcrobatics).toBe(false);
    expect(gw.p1.revolutes.every(joint => !joint.isMotorEnabled())).toBe(true);
    expect([...gw.p1.bodies, ...gw.p1.detachedBodies].every(body => Number.isFinite(body.getPosition().y))).toBe(true);
  });
});
