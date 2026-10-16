import { Vec2 } from 'planck';
import { describe, expect, it } from 'vitest';
import { BallSquash } from '../src/render/ballDeformation';
import { FPS } from '../src/sim/constants';
import type { GameWorld } from '../src/sim/world';
import { world } from './helpers';

function freeBall(gw: GameWorld, x: number, y: number, vx: number, vy: number): void {
  gw.game.update = () => {};
  for (const player of [gw.p1, gw.p2]) {
    if (player.holdingJoint) gw.world.destroyJoint(player.holdingJoint);
    player.forgetBallJoint();
  }
  gw.ball.reset(x, y);
  gw.ball.body.setLinearVelocity(Vec2(vx, vy));
}

function impactAt(x: number, y: number, vx: number, vy: number) {
  const gw = world({ physics: { gravity: 0 } });
  const squash = new BallSquash(gw);
  freeBall(gw, x, y, vx, vy);
  for (let frame = 0; frame < 20; frame++) {
    gw.step();
    const deformation = squash.sample(gw.frame - 1);
    if (deformation) return { gw, squash, deformation, at: gw.frame - 1 };
  }
  throw new Error('The ball did not produce an impact animation');
}

describe('Ball impact animation', () => {
  it.each([
    { surface: 'floor', x: 200, y: 325, vx: 0, vy: 5, vertical: true },
    { surface: 'wall', x: 810, y: 100, vx: 5, vy: 0, vertical: false },
    { surface: 'head', x: 100, y: 210, vx: 0, vy: 5, vertical: true },
  ])('squashes along the $surface contact normal while preserving visual area', scenario => {
    const { deformation } = impactAt(scenario.x, scenario.y, scenario.vx, scenario.vy);
    expect(deformation.normalScale).toBeLessThan(1);
    expect(deformation.normalScale).toBeGreaterThanOrEqual(0.84);
    expect(deformation.tangentScale).toBeGreaterThan(1);
    expect(deformation.normalScale * deformation.tangentScale).toBeCloseTo(1);
    expect(Math.abs(Math.sin(deformation.angle))).toBeCloseTo(scenario.vertical ? 1 : 0, 2);
  });

  it('makes hard hits more visible and recovers with a small elastic overshoot', () => {
    const soft = impactAt(200, 325, 0, 2);
    const hard = impactAt(200, 325, 0, 12);
    expect(hard.deformation.normalScale).toBeLessThan(soft.deformation.normalScale);
    const rebound = hard.squash.sample(hard.at + FPS * 0.12)!;
    expect(rebound.normalScale).toBeGreaterThan(1);
    expect(rebound.normalScale).toBeLessThan(1.04);
    expect(hard.squash.sample(hard.at + FPS * 0.3)).toBeNull();
  });

  it('stays stable on pause and clears the deformation for a new serve', () => {
    const { gw, squash, deformation, at } = impactAt(200, 325, 0, 5);
    gw.paused = true;
    gw.step();
    expect(squash.sample(gw.frame - 1)).toEqual(deformation);
    gw.game.newRound();
    expect(squash.sample(at)).toBeNull();
  });

  it('leaves held balls and resting floor contacts round', () => {
    const gw = world({ physics: { ballRestitution: 0 } });
    const squash = new BallSquash(gw);
    for (let frame = 0; frame < 10; frame++) {
      gw.step();
      expect(squash.sample(gw.frame - 1)).toBeNull();
    }
    freeBall(gw, 200, 340, 0, 0);
    for (let frame = 0; frame < 30; frame++) {
      gw.step();
      expect(squash.sample(gw.frame - 1)).toBeNull();
    }
  });

  it('keeps simulated motion identical with and without the visual listener', () => {
    const original = world();
    const animated = world();
    const squash = new BallSquash(animated);
    for (const gw of [original, animated]) freeBall(gw, 200, 80, 8, 12);
    let sawImpact = false;
    for (let frame = 0; frame < 180; frame++) {
      original.step();
      animated.step();
      sawImpact ||= squash.sample(animated.frame - 1) !== null;
      expect(animated.ball.position).toEqual(original.ball.position);
      expect(animated.ball.velocity).toEqual(original.ball.velocity);
      expect(animated.p1.head.getPosition()).toEqual(original.p1.head.getPosition());
      expect(animated.p2.head.getPosition()).toEqual(original.p2.head.getPosition());
    }
    expect(sawImpact).toBe(true);
    expect(animated.ball.body.getFixtureList()!.getShape().getRadius())
      .toBe(original.ball.body.getFixtureList()!.getShape().getRadius());
    expect(animated.ball.body.getMass()).toBe(original.ball.body.getMass());
    expect(animated.ball.body.getInertia()).toBe(original.ball.body.getInertia());
  });
});
