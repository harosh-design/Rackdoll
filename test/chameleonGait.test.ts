import { describe, expect, it } from 'vitest';
import { chameleonLegPoses, CHAMELEON_STRIDE_PX } from '../src/render/chameleonGait';

describe('chameleon wall grip', () => {
  it.each([1, -1])('keeps at least two toe pads on the actual wall when facing %i', inward => {
    const bodyX = inward === 1 ? -188 : 814;
    const wall = inward === 1 ? -215 : 840;
    const wallX = (wall - bodyX) * inward;
    for (let distance = 0; distance < 60; distance += 0.2) {
      const legs = chameleonLegPoses({ wallX, travelPx: distance });
      const planted = legs.filter(leg => leg.planted);
      expect(planted.length).toBeGreaterThanOrEqual(2);
      for (const leg of planted) expect(bodyX + leg.foot.x * inward).toBeCloseTo(wall, 8);
      for (const leg of legs.filter(leg => !leg.planted)) expect(leg.foot.x).toBeGreaterThan(wallX);
    }
  });

  it('holds planted toes at the same world height as the body moves down', () => {
    const a = chameleonLegPoses({ wallX: -27, travelPx: 1 });
    const b = chameleonLegPoses({ wallX: -27, travelPx: 2 });
    for (let i = 0; i < a.length; i++) {
      expect(a[i].planted && b[i].planted).toBe(true);
      expect(a[i].foot.y + 1).toBeCloseTo(b[i].foot.y + 2, 8);
      expect(b[i].elbow).not.toEqual(a[i].elbow);
    }
  });

  it('lifts and advances the free feet, then grips one stride lower', () => {
    const midSwing = chameleonLegPoses({ wallX: -27, travelPx: CHAMELEON_STRIDE_PX * 0.84 })[0];
    expect(midSwing.planted).toBe(false);
    expect(midSwing.foot.x).toBeCloseTo(-23, 8);
    const before = chameleonLegPoses({ wallX: -27, travelPx: 0 })[0];
    const after = chameleonLegPoses({ wallX: -27, travelPx: CHAMELEON_STRIDE_PX })[0];
    expect(after.planted).toBe(true);
    expect(after.foot.y + CHAMELEON_STRIDE_PX - before.foot.y).toBeCloseTo(CHAMELEON_STRIDE_PX, 8);
  });

  it('keeps limb segments connected and their lengths fixed throughout a stride', () => {
    const length = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const resting = chameleonLegPoses({ wallX: -27, travelPx: 0 });
    for (let distance = 0; distance < CHAMELEON_STRIDE_PX; distance += 0.1) {
      const legs = chameleonLegPoses({ wallX: -27, travelPx: distance });
      legs.forEach((leg, i) => {
        expect(length(leg.root, leg.elbow)).toBeCloseTo(length(resting[i].root, resting[i].elbow), 8);
        expect(length(leg.elbow, leg.wrist)).toBeCloseTo(length(resting[i].elbow, resting[i].wrist), 8);
      });
    }
  });
});
