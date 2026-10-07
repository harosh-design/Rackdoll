import type { Body, RevoluteJoint, Vec2Value } from 'planck';
import { toPx } from '../sim/constants';
import type { Player } from '../sim/player';
import type { Interpolator, Pose } from './interp';

/** Anything that can say where to draw a body. */
export type PoseSource = Pick<Interpolator, 'pose'>;

/** A local anchor (metres) carried into world px by a pose. */
function anchorAt(pose: Pose, local: Vec2Value): { x: number; y: number } {
  const c = Math.cos(pose.a);
  const s = Math.sin(pose.a);
  const x = toPx(local.x);
  const y = toPx(local.y);
  return { x: pose.x + c * x - s * y, y: pose.y + s * x + c * y };
}

/** Place `body` at `angle` so its `local` anchor lands on `at`. */
function hang(at: { x: number; y: number }, local: Vec2Value, angle: number): Pose {
  const p = anchorAt({ x: 0, y: 0, a: angle }, local);
  return { x: at.x - p.x, y: at.y - p.y, a: angle };
}

/**
 * Where to draw each of a doll's parts so that every joint meets exactly.
 *
 * The art sits on its body as the original's sprites do, but the solver lets
 * a joint's two anchors drift apart under load. In random play the neck and
 * shoulders are over 1 px apart a quarter of the time, and a hazard's blow
 * can pull a knee tens of px open. Here every part keeps its own angle, and
 * the parts are chained joint by joint out from the torso. Then the whole
 * doll is shifted so its mass-weighted mean offset is zero: the closest
 * placement, in the least-squares sense, in which no joint is open. A doll at
 * rest barely moves. The simulation never sees any of this.
 */
export function closeJoints(p: Player, source: PoseSource, alpha: number, out: Map<Body, Pose>): void {
  const raw = new Map<Body, Pose>();
  for (const b of p.bodies) raw.set(b, source.pose(b, alpha));
  const placed = new Map<Body, Pose>([[p.tors, raw.get(p.tors)!]]);
  // The twelve joints form a tree. Sweep until each has hung its loose end.
  let pending: RevoluteJoint[] = p.revolutes.slice();
  while (pending.length > 0) {
    const left: RevoluteJoint[] = [];
    for (const j of pending) {
      const a = j.getBodyA();
      const b = j.getBodyB();
      const from = placed.has(a) ? a : placed.has(b) ? b : null;
      if (!from) {
        left.push(j);
        continue;
      }
      const to = from === a ? b : a;
      const fromAnchor = from === a ? j.getLocalAnchorA() : j.getLocalAnchorB();
      const toAnchor = from === a ? j.getLocalAnchorB() : j.getLocalAnchorA();
      placed.set(to, hang(anchorAt(placed.get(from)!, fromAnchor), toAnchor, raw.get(to)!.a));
    }
    if (left.length === pending.length) break;
    pending = left;
  }
  let mass = 0;
  let dx = 0;
  let dy = 0;
  for (const b of p.bodies) {
    const m = b.getMass();
    const r = raw.get(b)!;
    const q = placed.get(b) ?? r;
    mass += m;
    dx += m * (r.x - q.x);
    dy += m * (r.y - q.y);
  }
  dx /= mass;
  dy /= mass;
  for (const b of p.bodies) {
    const q = placed.get(b) ?? raw.get(b)!;
    out.set(b, { x: q.x + dx, y: q.y + dy, a: q.a });
  }
}

/**
 * Poses for one drawn frame: the dolls' parts with their joints closed, and
 * a held ball on its hand's drawn joint. Everything else, and any other
 * alpha, comes straight from `source`.
 */
export function closedPoses(source: PoseSource, alpha: number, players: readonly Player[], ball: Body): PoseSource {
  const closed = new Map<Body, Pose>();
  for (const p of players) {
    closeJoints(p, source, alpha, closed);
    const j = p.holdingJoint;
    if (!j) continue;
    const hand = j.getBodyA() === ball ? j.getBodyB() : j.getBodyA();
    const handAnchor = hand === j.getBodyA() ? j.getLocalAnchorA() : j.getLocalAnchorB();
    const ballAnchor = hand === j.getBodyA() ? j.getLocalAnchorB() : j.getLocalAnchorA();
    const handPose = closed.get(hand);
    if (handPose) closed.set(ball, hang(anchorAt(handPose, handAnchor), ballAnchor, source.pose(ball, alpha).a));
  }
  return {
    pose: (b, a) => (a === alpha ? closed.get(b) : undefined) ?? source.pose(b, a),
  };
}
