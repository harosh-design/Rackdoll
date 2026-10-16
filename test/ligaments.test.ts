import { Vec2 } from 'planck';
import { describe, expect, it } from 'vitest';
import { NET_TOP_PX, NET_X_PX, toM, toPx } from '../src/sim/constants';
import { closedPoses } from '../src/render/dollPose';
import { Interpolator } from '../src/render/interp';
import { ligamentSegments } from '../src/render/ligamentArt';
import { hazardWorld, run, world } from './helpers';

describe('impaled doll rendering', () => {
  it.each([1, 2] as const)('keeps player %s on its real pin and bridges its joint gaps at every size', id => {
    const gw = world({ centerObstacle: 'sharp' });
    const player = id === 1 ? gw.p1 : gw.p2;
    const hand = player.part('FingerLeft');
    hand.setTransform(Vec2(toM(NET_X_PX), toM(NET_TOP_PX - 6)), 0);
    gw.centerObstacle.beforeStep([player]); gw.centerObstacle.afterStep([player]);
    const frames = new Interpolator();
    for (const scale of [2 / 3, 1, 1.5]) {
      player.resizeTo(scale, true);
      const pin = gw.centerObstacle.pins.get(hand)!;
      for (const alpha of [0.25, 0.5, 1]) {
        const poses = closedPoses(frames, alpha, [gw.p1, gw.p2], gw.ball.body);
        for (const body of player.bodies) expect(poses.pose(body, alpha)).toEqual(frames.pose(body, alpha));
        const links = ligamentSegments(player, poses, alpha);
        expect(links.length).toBeGreaterThan(0);
        const wrist = player.skeletonJoints.find(j => j.getBodyA() === hand || j.getBodyB() === hand)!;
        const endpoint = wrist.getBodyA() === hand ? wrist.getAnchorA() : wrist.getAnchorB();
        expect(links.some(link => [link.a, link.b].some(p =>
          Math.hypot(p.x - toPx(endpoint.x), p.y - toPx(endpoint.y)) < 1e-6))).toBe(true);
        // The pin retains its original local wound anchor when the doll resizes.
        expect(pin.getBodyB()).toBe(hand);
        for (const link of links) expect(link.width).toBeGreaterThan(0);
      }
    }
    gw.game.newRound();
    const healed = closedPoses(frames, 1, [player], gw.ball.body);
    expect(ligamentSegments(player, healed, 1)).toEqual([]);
    expect(player.impaled).toBe(false);
  });

  it('does not expose ordinary solver gaps or bridge a severed limb', () => {
    const gw = world();
    const frames = new Interpolator();
    gw.p1.part('FingerLeft').setTransform(Vec2(toM(NET_X_PX), toM(NET_TOP_PX - 6)), 0);
    const poses = closedPoses(frames, 1, [gw.p1], gw.ball.body);
    expect(ligamentSegments(gw.p1, poses, 1)).toEqual([]);
    gw.p1.sever('ArmLeft');
    const severed = closedPoses(frames, 1, [gw.p1], gw.ball.body);
    expect(ligamentSegments(gw.p1, severed, 1)).toEqual([]);
  });
});

describe('elastic spike joints', () => {
  it.each([2 / 3, 1, 1.5])('stretches under load with bounded gaps and restores all hinges at scale %s', scale => {
    const gw = hazardWorld({ centerObstacle: 'sharp' });
    const originalJointCount = gw.world.getJointCount();
    const player = gw.p1;
    player.resizeTo(scale, true);
    const hand = player.part('FingerRight');
    const delta = Vec2.sub(Vec2(toM(NET_X_PX), toM(NET_TOP_PX - 10)), hand.getPosition());
    for (const body of [...player.bodies, player.prismBody]) {
      body.setTransform(Vec2.add(body.getPosition(), delta), body.getAngle());
      body.setLinearVelocity(Vec2(0, 0)); body.setAngularVelocity(0);
    }
    gw.centerObstacle.beforeStep([player]); gw.centerObstacle.afterStep([player]);
    gw.control.press(37);
    run(gw, 45);
    gw.control.release(37);
    expect(gw.centerObstacle.pins.has(hand)).toBe(true);
    expect(player.injured).toBe(false);
    expect(player.skeletonJoints).toHaveLength(12);
    const gaps = player.ligaments.map(link => toPx(Vec2.distance(link.spring.getAnchorA(), link.spring.getAnchorB())));
    expect(Math.max(...gaps)).toBeGreaterThan(12 * scale);
    expect(Math.max(...gaps)).toBeLessThan(53 * scale);
    // Resizing a pinned doll rebuilds elastic anchors without dropping its pin.
    player.resizeTo(1, true);
    run(gw, 15);
    expect(gw.centerObstacle.pins.has(hand)).toBe(true);
    expect(player.skeletonJoints).toHaveLength(12);
    gw.game.newRound();
    expect(player.revolutes).toHaveLength(12);
    expect(player.ligaments).toHaveLength(0);
    expect(player.impaled).toBe(false);
    // The new round adds a serve joint; no pin, rope or spring leaks remain.
    expect(gw.world.getJointCount()).toBe(originalJointCount + 1);
  });
});
