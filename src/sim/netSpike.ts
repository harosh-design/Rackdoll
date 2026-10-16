import { Box, Circle, Transform, Vec2, type Body } from 'planck';
import { NET_SPIKE, NET_TOP_PX, NET_X_PX, PARTS, toM, toPx, type PartName } from './constants';
import type { Player } from './player';

interface Sample { x: number; y: number; angle: number }
export interface SpikeHit { part: PartName; localAnchor: Vec2; height: number }

/** Swept blade checks also catch a fast flip that crosses the tip in one step. */
export class NetSpike {
  private readonly tip = Vec2(toM(NET_X_PX), toM(NET_TOP_PX - NET_SPIKE.heightPx));
  private readonly previous = new Map<Body, Sample>();

  constructor(private readonly halfWidthPx: number = NET_SPIKE.halfWidthPx) {}

  capture(players: readonly Player[]): void {
    this.previous.clear();
    for (const player of players) for (const body of player.bodies) {
      const p = body.getPosition();
      this.previous.set(body, { x: p.x, y: p.y, angle: body.getAngle() });
    }
  }

  hits(player: Player): PartName[] {
    return this.impacts(player).map(hit => hit.part);
  }

  /** Both spikes act only on deep insertion: the classic one cuts, the sharp one catches. */
  impacts(player: Player): SpikeHit[] {
    if (player.power === 'shield') return [];
    const hits: SpikeHit[] = [];
    for (const def of PARTS) {
      if (!player.isAttached(def.name)) continue;
      const body = player.part(def.name);
      const start = this.previous.get(body);
      if (!start) continue;
      const end = body.getPosition();
      const radius = toM(def.shape.kind === 'circle' ? def.shape.r : Math.hypot(def.shape.hw, def.shape.hh)) * player.sizeScale;
      if (Math.min(start.x, end.x) - radius > toM(NET_X_PX + this.halfWidthPx)
        || Math.max(start.x, end.x) + radius < toM(NET_X_PX - this.halfWidthPx)
        || Math.min(start.y, end.y) - radius > toM(NET_TOP_PX)
        || Math.max(start.y, end.y) + radius < toM(NET_TOP_PX - NET_SPIKE.heightPx)) continue;
      const angle = body.getAngle() - start.angle;
      const travel = Math.hypot(end.x - start.x, end.y - start.y) + Math.abs(angle) * radius;
      const shape = body.getFixtureList()!.getShape();
      const halfThickness = toM(def.shape.kind === 'circle' ? def.shape.r : Math.min(def.shape.hw, def.shape.hh)) * player.sizeScale;
      const inset = halfThickness * NET_SPIKE.cutInsetRatio;
      const core = def.shape.kind === 'circle'
        ? Circle(halfThickness - inset)
        : Box(toM(def.shape.hw) * player.sizeScale - inset, toM(def.shape.hh) * player.sizeScale - inset);
      // Both ends of this segment must be inside the convex part: that much
      // of the blade is embedded, with the tip clear of grazing contacts.
      const depth = Math.min(toM(NET_SPIKE.heightPx), halfThickness * 2) * NET_SPIKE.cutDepthRatio;
      const embedded = Vec2(this.tip.x, this.tip.y + depth);
      // Small parts have a narrower insertion window, especially under size powers.
      const step = Math.min(toM(NET_SPIKE.sweepStepPx), halfThickness * 0.25);
      const steps = Math.max(1, Math.ceil(travel / step));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const pose = Transform(Vec2(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t), start.angle + angle * t);
        if (core.testPoint(pose, this.tip) && shape.testPoint(pose, embedded)) {
          const height = Math.max(NET_TOP_PX - NET_SPIKE.heightPx, Math.min(NET_TOP_PX, toPx(pose.p.y)));
          const width = this.halfWidthPx * (height - NET_TOP_PX + NET_SPIKE.heightPx) / NET_SPIKE.heightPx;
          const x = Math.max(NET_X_PX - width, Math.min(NET_X_PX + width, toPx(pose.p.x)));
          hits.push({ part: def.name, localAnchor: Transform.mulTVec2(pose, Vec2(toM(x), toM(height))), height });
          break;
        }
      }
    }
    return hits;
  }
}
