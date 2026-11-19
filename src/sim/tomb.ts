import type { Ball } from './ball';
import { SHARP_SPIKE } from './centerObstacle';
import { BALL, BODYTYPE, COURT, FLOOR_TOP_PX, LEFT_WALL_INNER_PX, NET_X_PX, RIGHT_WALL_INNER_PX, toPx } from './constants';
import { bodyTypeOf } from './types';

export interface TombSlab {
  readonly index: number;
  readonly owner: 1 | 2;
  readonly left: number;
  readonly right: number;
  state: 'intact' | 'cracked' | 'broken';
  hitFrame: number;
  hitX: number;
}

/** Slabs cover the floor between the wall faces and the foot of the spike. */
export function tombSlabs(): TombSlab[] {
  return ([1, 2] as const).flatMap(owner => {
    const left = owner === 1 ? LEFT_WALL_INNER_PX : NET_X_PX + SHARP_SPIKE.halfWidthPx;
    const right = owner === 1 ? NET_X_PX - SHARP_SPIKE.halfWidthPx : RIGHT_WALL_INNER_PX;
    return Array.from({ length: 6 }, (_, i) => ({
      index: (owner - 1) * 6 + i, owner,
      left: left + (right - left) * i / 6, right: left + (right - left) * (i + 1) / 6,
      state: 'intact' as const, hitFrame: -100, hitX: left + (right - left) * (i + 0.5) / 6,
    }));
  });
}

/** Authoritative rally damage; the solid floor remains unchanged throughout play. */
export class Tomb {
  readonly slabs = tombSlabs();
  impacts = 0;
  transition: { frame: number; broken: number | null; ballX: number; ballY: number; ballAngle: number } | null = null;
  private armed = true;

  slabAt(x: number): TombSlab {
    // Half-open intervals assign a seam to its right-hand slab. The spike
    // covers the center gap; clamp numerical edge contacts to the nearest slab.
    const side = x < COURT.net.x ? this.slabs.slice(0, 6) : this.slabs.slice(6);
    return side.find(slab => x < slab.right) ?? side[5];
  }

  landing(ball: Ball, hits: number[], frame: number): TombSlab | null {
    const x = hits[0];
    hits.length = 0;
    if (ball.held || ball.ballOfPlayer !== 0) {
      this.armed = false;
      return null;
    }
    if (x !== undefined) {
      if (!this.armed) return null;
      this.armed = false;
      const slab = this.slabAt(x);
      if (slab.state === 'broken') return null;
      slab.hitFrame = frame;
      slab.hitX = Math.max(slab.left + 2, Math.min(slab.right - 2, x));
      this.impacts++;
      if (slab.state === 'cracked') return slab;
      slab.state = 'cracked';
      return null;
    }
    // A contact ending for a jittery step is insufficient: the ball must clear
    // the surface before a new landing can count, including after a held ball.
    if (this.armed || toPx(ball.position.y) + BALL.radiusPx >= FLOOR_TOP_PX - 3) return null;
    for (let edge = ball.body.getContactList(); edge; edge = edge.next) {
      if (edge.contact.isTouching() && edge.other && bodyTypeOf(edge.other) === BODYTYPE.GROUND) return null;
    }
    this.armed = true;
    return null;
  }

  startTransition(frame: number, ball: Ball): void {
    this.transition = { frame, broken: null, ballX: toPx(ball.position.x), ballY: toPx(ball.position.y), ballAngle: ball.body.getAngle() };
  }

  breakSlab(slab: TombSlab): void {
    // Called only after Game has committed the point and left the play phase.
    slab.state = 'broken';
    if (this.transition) this.transition.broken = slab.index;
  }

  reset(): void {
    for (const slab of this.slabs) { slab.state = 'intact'; slab.hitFrame = -100; }
    this.transition = null;
    this.armed = false;
  }
}
