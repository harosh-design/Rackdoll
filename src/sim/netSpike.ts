import { Polygon, Transform, Vec2, testOverlap, type Body } from 'planck';
import { NET_SPIKE, NET_TOP_PX, NET_X_PX, PARTS, toM, type PartName } from './constants';
import type { Player } from './player';

interface Sample { x: number; y: number; angle: number }

/** Swept blade checks also catch a fast flip that crosses the tip in one step. */
export class NetSpike {
  private readonly blade = Polygon([
    Vec2(toM(-NET_SPIKE.halfWidthPx), 0),
    Vec2(0, toM(-NET_SPIKE.heightPx)),
    Vec2(toM(NET_SPIKE.halfWidthPx), 0),
  ]);
  private readonly transform = Transform(Vec2(toM(NET_X_PX), toM(NET_TOP_PX)));
  private readonly previous = new Map<Body, Sample>();

  capture(players: readonly Player[]): void {
    this.previous.clear();
    for (const player of players) for (const body of player.bodies) {
      const p = body.getPosition();
      this.previous.set(body, { x: p.x, y: p.y, angle: body.getAngle() });
    }
  }

  hits(player: Player): PartName[] {
    if (player.power === 'shield') return [];
    const hits: PartName[] = [];
    for (const def of PARTS) {
      if (!player.isAttached(def.name)) continue;
      const body = player.part(def.name);
      const start = this.previous.get(body);
      if (!start) continue;
      const end = body.getPosition();
      const radius = toM(def.shape.kind === 'circle' ? def.shape.r : Math.hypot(def.shape.hw, def.shape.hh)) * player.sizeScale;
      if (Math.min(start.x, end.x) - radius > toM(NET_X_PX + NET_SPIKE.halfWidthPx)
        || Math.max(start.x, end.x) + radius < toM(NET_X_PX - NET_SPIKE.halfWidthPx)
        || Math.min(start.y, end.y) - radius > toM(NET_TOP_PX)
        || Math.max(start.y, end.y) + radius < toM(NET_TOP_PX - NET_SPIKE.heightPx)) continue;
      const angle = body.getAngle() - start.angle;
      const travel = Math.hypot(end.x - start.x, end.y - start.y) + Math.abs(angle) * radius;
      const steps = Math.max(1, Math.ceil(travel / toM(NET_SPIKE.sweepStepPx)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const pose = Transform(Vec2(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t), start.angle + angle * t);
        if (testOverlap(this.blade, 0, body.getFixtureList()!.getShape(), 0, this.transform, pose)) {
          hits.push(def.name);
          break;
        }
      }
    }
    return hits;
  }
}
