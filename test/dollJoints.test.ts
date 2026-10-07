import type { Body, Vec2Value } from 'planck';
import { describe, expect, it } from 'vitest';
import { JOINTS, PARTS, toPx, type PartName } from '../src/sim/constants';
import { OUTLINES } from '../src/render/dollArt';
import { closedPoses } from '../src/render/dollPose';
import { Interpolator, type Pose } from '../src/render/interp';
import type { GameWorld } from '../src/sim/world';
import { rng, run, world } from './helpers';

const bodiesOf = (gw: GameWorld): Body[] => {
  const out: Body[] = [];
  for (let b = gw.world.getBodyList(); b; b = b.getNext()) out.push(b);
  return out;
};

const anchor = (pose: Pose, local: Vec2Value) => {
  const c = Math.cos(pose.a);
  const s = Math.sin(pose.a);
  return { x: pose.x + c * toPx(local.x) - s * toPx(local.y), y: pose.y + s * toPx(local.x) + c * toPx(local.y) };
};

const bounds = (name: Exclude<PartName, 'Head'>) => {
  const pts = OUTLINES[name];
  const xs = pts.filter((_, i) => i % 2 === 0);
  const ys = pts.filter((_, i) => i % 2 === 1);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

/** A joint's pivot in a part's own frame, from the joint table. */
const pivot = (part: PartName, other: PartName) => {
  const j = JOINTS.find((d) => (d.a === part && d.b === other) || (d.a === other && d.b === part))!;
  const p = PARTS.find((d) => d.name === part)!;
  return { x: j.dx - p.dx, y: j.dy - p.dy };
};

describe('doll art placement', () => {
  // The original sprites' bitmap rectangles, relative to their bodies
  // (mc_ArmR, mc_HandR, mc_LegL, mc_FootL, mc_Body, mc_Ass).
  it.each([
    ['ArmRight', -13.7, 14.17, -4.7, 5.17],
    ['HandRight', -10.9, 13.37, -3.3, 4.77],
    ['LegLeft', -6.77, 6.25, -20.5, 14.57],
    ['FootLeft', -3.07, 5.9, -11.75, 21.97],
    ['Tors', -11.2, 12.17, -22.9, 19.37],
    ['Ass', -12.9, 13.62, -7.4, 10.12],
  ] as const)('%s fills its original sprite', (name, x0, x1, y0, y1) => {
    const b = bounds(name);
    for (const [got, want] of [[b.x0, x0], [b.x1, x1], [b.y0, y0], [b.y1, y1]]) {
      expect(Math.abs(got - want)).toBeLessThan(0.5);
    }
  });

  it('meets at the knee as the original does: the shin starts at the pivot, under the thigh', () => {
    for (const side of ['Left', 'Right'] as const) {
      const shinPivot = pivot(`Foot${side}`, `Leg${side}`);
      const thighPivot = pivot(`Leg${side}`, `Foot${side}`);
      const shinTop = shinPivot.y - bounds(`Foot${side}`).y0;
      const thighReach = bounds(`Leg${side}`).y1 - thighPivot.y;
      expect(shinTop).toBeGreaterThan(1);
      expect(shinTop).toBeLessThan(2.5);
      expect(thighReach).toBeGreaterThan(3);
      expect(thighReach).toBeLessThan(4);
    }
  });

  it('hangs the feet below the shin colliders, onto the drawn floor', () => {
    const foot = PARTS.find((p) => p.name === 'FootLeft')!.shape;
    const below = bounds('FootLeft').y1 - (foot.kind === 'box' ? foot.hh : 0);
    expect(below).toBeGreaterThan(10);
    expect(below).toBeLessThan(11.5);
  });
});

describe('drawn joints', () => {
  it('meet exactly in every frame of random play, however far the solver opens them', () => {
    const r = rng(3);
    const gw = world({ hazards: true });
    const interp = new Interpolator();
    let open = 0;
    let gap = 0;
    let ballGap = 0;
    for (let i = 0; i < 30 * 40; i++) {
      for (const c of [37, 39, 38, 40, 32, 65, 68, 87, 83, 82]) (r() < 0.12 ? gw.control.press(c) : gw.control.release(c));
      gw.step();
      gw.reap();
      if (gw.game.phase === 'matchOver') gw.game.resetMatch();
      interp.commit(bodiesOf(gw));
      const alpha = 0.25 + (i % 4) * 0.25;
      const poses = closedPoses(interp, alpha, [gw.p1, gw.p2], gw.ball.body);
      for (const p of [gw.p1, gw.p2]) {
        for (const j of p.revolutes) {
          const a = anchor(poses.pose(j.getBodyA(), alpha), j.getLocalAnchorA());
          const b = anchor(poses.pose(j.getBodyB(), alpha), j.getLocalAnchorB());
          gap = Math.max(gap, Math.hypot(a.x - b.x, a.y - b.y));
          const pa = j.getAnchorA();
          const pb = j.getAnchorB();
          open = Math.max(open, toPx(Math.hypot(pa.x - pb.x, pa.y - pb.y)));
        }
        const held = p.holdingJoint;
        if (held) {
          const a = anchor(poses.pose(held.getBodyA(), alpha), held.getLocalAnchorA());
          const b = anchor(poses.pose(held.getBodyB(), alpha), held.getLocalAnchorB());
          ballGap = Math.max(ballGap, Math.hypot(a.x - b.x, a.y - b.y));
        }
      }
    }
    expect(open).toBeGreaterThan(5);
    expect(gap).toBeLessThan(1e-6);
    expect(ballGap).toBeLessThan(1e-6);
  });

  it('leaves a doll at rest where the physics has it, and its centre of mass always', () => {
    const gw = world();
    run(gw, 90);
    const interp = new Interpolator();
    interp.commit(bodiesOf(gw));
    const poses = closedPoses(interp, 1, [gw.p1, gw.p2], gw.ball.body);
    for (const p of [gw.p1, gw.p2]) {
      // The held ball's weight holds the server's elbow and wrist 3-4 px
      // open, so its hand is drawn up to that far from its body.
      const limit = p.holdingJoint ? 4 : 0.5;
      let mass = 0;
      let dx = 0;
      let dy = 0;
      for (const b of p.bodies) {
        const drawn = poses.pose(b, 1);
        const raw = interp.pose(b, 1);
        expect(Math.hypot(drawn.x - raw.x, drawn.y - raw.y)).toBeLessThan(limit);
        expect(drawn.a).toBe(raw.a);
        mass += b.getMass();
        dx += b.getMass() * (drawn.x - raw.x);
        dy += b.getMass() * (drawn.y - raw.y);
      }
      expect(Math.abs(dx / mass)).toBeLessThan(1e-9);
      expect(Math.abs(dy / mass)).toBeLessThan(1e-9);
    }
  });
});
