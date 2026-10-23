import { Vec2, World } from 'planck';
import { describe, expect, it } from 'vitest';
import { DIVE, FLOOR_TOP_PX, PARTS, SWING, toM } from '../src/sim/constants';
import { Ground } from '../src/sim/ground';
import { Player } from '../src/sim/player';
import { KEYS } from '../src/sim/control';
import { ud } from '../src/sim/types';
import { hazardWorld, jointErrPx, run } from './helpers';

describe('floor contact for the rally action', () => {
  it.each(PARTS.map(part => part.name))('recognizes a lone %s touching the floor', name => {
    const physics = new World();
    const ground = new Ground(physics, 'sharp');
    const player = new Player(physics, physics.createBody(), 100, 100, 1);
    const part = player.part(name);
    const shape = PARTS.find(def => def.name === name)!.shape;
    const halfHeight = shape.kind === 'circle' ? shape.r : shape.hh;
    part.setTransform(Vec2(toM(100), toM(FLOOR_TOP_PX - halfHeight + 0.1)), 0);
    physics.step(0);
    expect(player.touchingGround).toBe(true);
    expect(player.bodies.filter(body => {
      for (let edge = body.getContactList(); edge; edge = edge.next) {
        if (edge.other === ground.floor && edge.contact.isTouching()) return true;
      }
      return false;
    })).toEqual([part]);
  });

  it('ignores a detached foot, sensor contacts, walls, and a low airborne doll', () => {
    const gw = hazardWorld({ hazards: false });
    expect(gw.p1.touchingGround).toBe(true);
    gw.ground.floor.getFixtureList()!.setSensor(true);
    expect(gw.p1.touchingGround).toBe(false);
    gw.ground.floor.getFixtureList()!.setSensor(false);
    for (const body of gw.p1.bodies) {
      const position = body.getPosition();
      body.setTransform(Vec2(position.x, position.y - toM(12)), body.getAngle());
    }
    gw.world.step(0);
    expect(gw.p1.grounded).toBe(true);
    expect(gw.p1.touchingGround).toBe(false);
    gw.p1.sever('FootLeft');
    gw.p1.part('FootLeft').setTransform(Vec2(toM(100), toM(FLOOR_TOP_PX - 10)), 0);
    gw.world.step(0);
    expect(gw.p1.touchingGround).toBe(false);
    gw.p1.head.setTransform(Vec2(toM(-205), toM(200)), 0);
    gw.world.step(0);
    expect(gw.p1.touchingGround).toBe(false);
  });
});

describe('grounded volleyball dive', () => {
  it.each([[1, -1], [1, 1], [2, -1], [2, 1]] as const)(
    'launches player %s toward a ball in direction %s without a somersault', (id, direction) => {
      const gw = hazardWorld({ hazards: false });
      const player = id === 1 ? gw.p1 : gw.p2;
      const startX = player.head.getWorldCenter().x;
      gw.ball.body.setTransform(Vec2(startX + direction * toM(100), toM(315)), 0);
      gw.ball.body.setLinearVelocity(Vec2(0, 0));
      expect(gw.swing(player)).toBe(true);
      expect(player.diving).toBe(true);
      expect(player.flipping).toBe(false);
      expect(player.ass.getLinearVelocity().x * direction).toBeGreaterThan(0);
      expect(gw.swingCooldownFramesLeft(id)).toBe(SWING.cooldownFrames);
      expect(gw.swing(player)).toBe(false);
      let largestAngle = 0;
      let reached = false;
      for (let frame = 0; frame < DIVE.maxFrames + 1; frame++) {
        gw.step();
        largestAngle = Math.max(largestAngle, Math.abs(player.head.getAngle()));
        if (frame >= 5 && frame < DIVE.reachFrames) {
          const head = player.head.getWorldCenter();
          reached ||= (['FingerLeft', 'FingerRight'] as const).every(name =>
            (player.part(name).getWorldCenter().x - head.x) * direction > toM(8));
        }
      }
      expect((player.head.getWorldCenter().x - startX) * direction).toBeGreaterThan(toM(35));
      expect(largestAngle).toBeGreaterThan(1);
      expect(largestAngle).toBeLessThan(Math.PI);
      expect(reached).toBe(true);
      expect(player.diving).toBe(false);
      expect(Math.abs(player.head.getAngle())).toBeLessThan(0.06);
      expect(player.revolutes.every(joint => !joint.isMotorEnabled())).toBe(true);
      run(gw, 10);
      expect(jointErrPx(player)).toBeLessThan(8);
      expect(player.bodies.every(body => Number.isFinite(body.getPosition().y))).toBe(true);
    },
  );

  it('dives on press, does not charge, and does not flip on release or while held', () => {
    const gw = hazardWorld({ hazards: false });
    gw.control.press(32);
    gw.step();
    expect(gw.p1.diving).toBe(true);
    expect(gw.control.chargeLevel(1)).toBeNull();
    run(gw, DIVE.maxFrames + 2);
    expect(gw.p1.performingAcrobatics).toBe(false);
    gw.control.release(32);
    gw.step();
    expect(gw.p1.performingAcrobatics).toBe(false);
  });

  it.each([-1, 1])('can save a low ball with the hands while diving in direction %s', direction => {
    const gw = hazardWorld({ hazards: false });
    gw.ball.body.setTransform(Vec2(gw.p1.head.getPosition().x + direction * toM(100), toM(300)), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 2));
    gw.flags.onBallDown = false;
    let handsMetBall = false;
    gw.world.on('begin-contact', contact => {
      const a = contact.getFixtureA().getBody(), b = contact.getFixtureB().getBody();
      const part = a === gw.ball.body ? ud(b)?.part : b === gw.ball.body ? ud(a)?.part : undefined;
      if (part?.startsWith('Hand') || part?.startsWith('Finger')) handsMetBall = true;
    });
    gw.swing(gw.p1);
    let saved = false;
    for (let frame = 0; frame < DIVE.maxFrames; frame++) {
      gw.step();
      saved ||= handsMetBall && !gw.flags.onBallDown && gw.ball.velocity.y < 0;
    }
    expect(saved).toBe(true);
    expect(gw.perfectEffects[1].frame).toBe(-100);
  });

  it('uses a reassigned rally key for the grounded dive', () => {
    const gw = hazardWorld({ hazards: false, bindings: { 1: { ...KEYS[1], serve: 'KeyG' }, 2: KEYS[2] } });
    gw.control.press(32);
    gw.step();
    expect(gw.p1.diving).toBe(false);
    gw.control.press('KeyG');
    gw.step();
    expect(gw.p1.diving).toBe(true);
    expect(gw.control.chargeLevel(1)).toBeNull();
  });

  it.each(['tiny', 'giant'] as const)('recovers safely when %s changes body size during a dive', power => {
    const gw = hazardWorld({ hazards: false });
    gw.swing(gw.p1);
    gw.powerUps.activate(1, power, gw.frame);
    run(gw, DIVE.maxFrames + 10);
    expect(gw.p1.diving).toBe(false);
    expect(gw.p1.railV.getBodyB()).toBe(gw.p1.head);
    expect(gw.p1.bodies.every(body => Number.isFinite(body.getPosition().y))).toBe(true);
  });

  it('releases dive motors before a limb is severed', () => {
    const gw = hazardWorld({ hazards: false });
    gw.swing(gw.p1);
    run(gw, 3);
    gw.p1.sever('ArmLeft');
    expect(gw.p1.diving).toBe(false);
    expect(gw.p1.revolutes.every(joint => !joint.isMotorEnabled())).toBe(true);
    run(gw, 10);
    expect([...gw.p1.bodies, ...gw.p1.detachedBodies].every(body => Number.isFinite(body.getPosition().y))).toBe(true);
  });

  it('preserves the charged flip when no attached part touches the floor', () => {
    const gw = hazardWorld({ hazards: false });
    gw.world.setGravity(Vec2(0, 0));
    for (const body of gw.p1.bodies) {
      const position = body.getPosition();
      body.setTransform(Vec2(position.x, position.y - toM(20)), body.getAngle());
    }
    gw.p1.setLinVelZero();
    gw.world.step(0);
    expect(gw.p1.touchingGround).toBe(false);
    gw.control.press(32);
    run(gw, 4);
    expect(gw.control.chargeLevel(1)?.power).toBeGreaterThan(0);
    expect(gw.p1.performingAcrobatics).toBe(false);
    gw.control.release(32);
    gw.step();
    expect(gw.p1.flipping).toBe(true);
    expect(gw.p1.diving).toBe(false);
  });

  it('freezes during pause and clears the dive and cooldown on a new round', () => {
    const gw = hazardWorld({ hazards: false });
    gw.swing(gw.p1);
    run(gw, 3);
    const angle = gw.p1.head.getAngle();
    const cooldown = gw.swingCooldownFramesLeft(1);
    gw.paused = true;
    run(gw, DIVE.maxFrames);
    expect(gw.p1.head.getAngle()).toBe(angle);
    expect(gw.swingCooldownFramesLeft(1)).toBe(cooldown);
    gw.paused = false;
    gw.game.newRound();
    expect(gw.p1.diving).toBe(false);
    expect(gw.p1.revolutes.every(joint => !joint.isMotorEnabled())).toBe(true);
    expect(gw.swingCooldownFramesLeft(1)).toBe(0);
  });
});
