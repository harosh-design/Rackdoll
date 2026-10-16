import type { Vec2Value } from 'planck';
import { toPx } from '../sim/constants';
import type { Player } from '../sim/player';
import type { PoseSource } from './dollPose';
import type { Pose } from './interp';

interface Point { x: number; y: number }
export interface LigamentSegment { a: Point; b: Point; width: number }

const anchorAt = (pose: Pose, local: Vec2Value): Point => ({
  x: pose.x + Math.cos(pose.a) * toPx(local.x) - Math.sin(pose.a) * toPx(local.y),
  y: pose.y + Math.sin(pose.a) * toPx(local.x) + Math.cos(pose.a) * toPx(local.y),
});

/** The same interpolated anchors as the cutouts, including size powers. */
export function ligamentSegments(player: Player, poses: PoseSource, alpha: number): LigamentSegment[] {
  if (!player.stretched) return [];
  const segments: LigamentSegment[] = [];
  for (const joint of player.skeletonJoints) {
    const a = anchorAt(poses.pose(joint.getBodyA(), alpha), joint.getLocalAnchorA());
    const b = anchorAt(poses.pose(joint.getBodyB(), alpha), joint.getLocalAnchorB());
    const gap = Math.hypot(b.x - a.x, b.y - a.y);
    if (gap < 1.5 * player.sizeScale) continue;
    const torso = joint.getBodyA() === player.ass && joint.getBodyB() === player.tors;
    segments.push({ a, b, width: (torso ? 6 : 3.8) * player.sizeScale });
  }
  return segments;
}

/** Draw behind the body parts so the red tissue emerges from their joints. */
export function drawLigaments(ctx: CanvasRenderingContext2D, player: Player, poses: PoseSource, alpha: number): void {
  const segments = ligamentSegments(player, poses, alpha);
  if (!segments.length) return;
  ctx.save();
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const { a, b, width } of segments) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const waist = width * Math.max(0.2, 0.5 - length / 240);
    ctx.beginPath();
    ctx.moveTo(a.x + nx * width / 2, a.y + ny * width / 2);
    ctx.quadraticCurveTo(mx + nx * waist, my + ny * waist, b.x + nx * width / 2, b.y + ny * width / 2);
    ctx.lineTo(b.x - nx * width / 2, b.y - ny * width / 2);
    ctx.quadraticCurveTo(mx - nx * waist, my - ny * waist, a.x - nx * width / 2, a.y - ny * width / 2);
    ctx.closePath();
    ctx.fillStyle = '#be102e'; ctx.fill();
    ctx.strokeStyle = '#5d1026'; ctx.lineWidth = 0.8 * player.sizeScale; ctx.stroke();
    ctx.strokeStyle = '#f34651'; ctx.lineWidth = 0.9 * player.sizeScale;
    ctx.beginPath(); ctx.moveTo(a.x + nx * width * 0.18, a.y + ny * width * 0.18);
    ctx.quadraticCurveTo(mx, my, b.x + nx * width * 0.18, b.y + ny * width * 0.18); ctx.stroke();
  }
  ctx.restore();
}
