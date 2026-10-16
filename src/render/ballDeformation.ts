import { FPS } from '../sim/constants';
import type { GameWorld } from '../sim/world';

export interface BallDeformation {
  /** World-space contact normal, independent of the sprite's spin. */
  angle: number;
  normalScale: number;
  tangentScale: number;
}

interface BallImpact {
  frame: number;
  angle: number;
  compression: number;
}

const RECOVERY_FRAMES = FPS * 0.28;

/** Read-only collision feedback. Only the ball's canvas transform changes. */
export class BallSquash {
  private impact: BallImpact | null = null;

  constructor(private readonly gw: GameWorld) {
    gw.world.on('post-solve', (contact, impulse) => {
      const ball = gw.ball;
      if (ball.held || ball.ballOfPlayer !== 0 || !contact.isTouching()) return;
      if (contact.getFixtureA().getBody() !== ball.body
        && contact.getFixtureB().getBody() !== ball.body) return;

      let normalImpulse = 0;
      for (let i = 0; i < contact.getManifold().pointCount; i++) {
        normalImpulse += impulse.normalImpulses[i] ?? 0;
      }
      // Ignore resting pressure; normalize by mass so debug tuning feels consistent.
      const speedChange = normalImpulse / ball.body.getMass();
      if (speedChange < 1.5) return;
      const compression = 0.04 + 0.12 * (1 - Math.exp(-(speedChange - 1.5) / 10));
      if (this.impact?.frame === gw.frame && this.impact.compression >= compression) return;
      const normal = contact.getWorldManifold(null)?.normal;
      if (!normal) return;
      this.impact = { frame: gw.frame, angle: Math.atan2(normal.y, normal.x), compression };
    });
  }

  /** Simulation time keeps recovery smooth between frames and frozen on pause. */
  sample(now: number): BallDeformation | null {
    if (this.gw.ball.held || this.gw.ball.ballOfPlayer !== 0) this.impact = null;
    if (!this.impact) return null;
    const t = (now - this.impact.frame) / RECOVERY_FRAMES;
    if (t < 0 || t >= 1) return null;
    // A quick squash, one small elastic overshoot, then a soft return to round.
    const compression = this.impact.compression * Math.cos(t * Math.PI * 2) * (1 - t) ** 3;
    const normalScale = 1 - compression;
    return { angle: this.impact.angle, normalScale, tangentScale: 1 / normalScale };
  }
}
