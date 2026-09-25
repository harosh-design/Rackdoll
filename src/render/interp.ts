import type { Body } from 'planck';
import { toPx } from '../sim/constants';

export interface Pose {
  x: number; // world px
  y: number; // world px
  a: number; // radians
}

/**
 * Render-side interpolation. The simulation stays locked to the original's
 * 30 fps frame / 1/28 s step; this only blends the two most recent frames so a
 * 60/120 Hz display draws in-between poses. Physics never sees it.
 */
export class Interpolator {
  private prev = new Map<Body, Pose>();
  private curr = new Map<Body, Pose>();

  /** Call right after each simulation frame. */
  commit(bodies: Iterable<Body>): void {
    const recycled = this.prev;
    this.prev = this.curr;
    this.curr = recycled;
    this.curr.clear();
    for (const b of bodies) this.curr.set(b, sample(b));
  }

  /** Blend between the last two frames; alpha 0 = previous, 1 = latest. */
  pose(b: Body, alpha: number): Pose {
    const c = this.curr.get(b) ?? sample(b);
    const p = this.prev.get(b);
    if (!p) return c;
    // Teleports (round reset, taking the ball) snap instead of smearing.
    if (Math.abs(c.x - p.x) > 60 || Math.abs(c.y - p.y) > 60) return c;
    let da = c.a - p.a;
    if (da > Math.PI) da -= Math.PI * 2;
    else if (da < -Math.PI) da += Math.PI * 2;
    return { x: p.x + (c.x - p.x) * alpha, y: p.y + (c.y - p.y) * alpha, a: p.a + da * alpha };
  }

  reset(): void {
    this.prev.clear();
    this.curr.clear();
  }
}

function sample(b: Body): Pose {
  const p = b.getPosition();
  return { x: toPx(p.x), y: toPx(p.y), a: b.getAngle() };
}
