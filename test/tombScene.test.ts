import { Vec2 } from 'planck';
import { describe, expect, it } from 'vitest';
import { tombScenePose } from '../src/render/tombScene';
import { BALL, FLOOR_TOP_PX } from '../src/sim/constants';
import { Tomb } from '../src/sim/tomb';
import { world } from './helpers';

function scene(index: number, impactX?: number) {
  const gw = world({ map: 'tomb' }), tomb = gw.tomb!;
  const slab = tomb.slabs[index], x = impactX ?? (slab.left + slab.right) / 2;
  gw.ball.body.setTransform(Vec2(x / 30, (FLOOR_TOP_PX - BALL.radiusPx) / 30), 0.7);
  tomb.startTransition(100, gw.ball); tomb.breakSlab(slab);
  return { tomb, slab, x };
}

describe('Tomb hand placement', () => {
  it.each(Array.from({ length: 12 }, (_, i) => i))('emerges from real slab %i and keeps the ball at its saved impact X', index => {
    const { tomb, slab, x } = scene(index);
    for (const elapsed of [0, 8, 16, 24, 33, 40, 48, 59]) {
      const pose = tombScenePose(tomb, 100 + elapsed)!;
      expect(pose.slab).toBe(slab);
      expect(pose.originX).toBeGreaterThan(slab.left);
      expect(pose.originX).toBeLessThan(slab.right);
      expect(pose.palmX).toBeCloseTo(x, 8);
      expect(pose.ballX).toBeCloseTo(x, 8);
    }
  });

  it('keeps the forearm inside the scored slab at a seam while reaching the actual ball', () => {
    const tomb = new Tomb(), index = 8, x = tomb.slabs[index].left;
    const { tomb: scored, slab } = scene(index, x);
    const pose = tombScenePose(scored, 124)!;
    expect(pose.ballX).toBe(x);
    expect(pose.originX).toBeGreaterThan(slab.left);
    expect(pose.originX).toBeLessThan(slab.right);
  });

  it('removes the players before opening a hole, including reduced motion', () => {
    const { tomb } = scene(2);
    for (const reduced of [false, true]) for (let elapsed = 0; elapsed < 60; elapsed++) {
      const pose = tombScenePose(tomb, 100 + elapsed, reduced)!;
      if (pose.opening > 0) expect(pose.playerOpacity).toBe(0);
    }
  });

  it('takes the ball from its landing position, lifts it, retreats and seals the court', () => {
    const { tomb } = scene(9);
    const start = tombScenePose(tomb, 100)!, lifted = tombScenePose(tomb, 126)!;
    expect(start.ballY).toBe(FLOOR_TOP_PX - BALL.radiusPx);
    expect(lifted.ballY).toBeLessThan(start.ballY - 70);
    expect(lifted.handVisible).toBe(true);
    const retreat = tombScenePose(tomb, 140)!;
    expect(retreat.ballY).toBeGreaterThan(FLOOR_TOP_PX);
    const sealed = tombScenePose(tomb, 159)!;
    expect(sealed.repair).toBe(1); expect(sealed.opening).toBe(0);
    expect(sealed.handVisible).toBe(false); expect(sealed.ballVisible).toBe(false);
  });

  it('holds a fixed grip in reduced motion and has no hand for a touch violation', () => {
    const { tomb } = scene(4);
    const first = tombScenePose(tomb, 112, true)!, later = tombScenePose(tomb, 126, true)!;
    expect(first.palmY).toBe(later.palmY); expect(first.ballY).toBe(later.ballY);
    tomb.transition!.broken = null;
    expect(tombScenePose(tomb, 120)!.handVisible).toBe(false);
    tomb.reset(); expect(tombScenePose(tomb, 120)).toBeNull();
  });
});
