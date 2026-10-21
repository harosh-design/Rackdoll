import type { Body } from 'planck';
import { PARTS, type PartName } from '../sim/constants';
import type { Player } from '../sim/player';
import { drawBallArt } from './ballArt';
import { closeJoints } from './dollPose';
import { drawHorrorPlayers } from './horrorArt';
import type { Pose } from './interp';

/** Reuse the game's jointed cutouts in a fixed, inward-facing lobby pose. */
export function drawMenuCharacter(canvas: HTMLCanvasElement, player: Player): void {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d')!;
  const angles: Partial<Record<PartName, number>> = {
    Head: -0.07, Tors: 0.04, Ass: -0.03,
    ArmLeft: -0.93, HandLeft: -1.12, FingerLeft: -1.12,
    ArmRight: 0.92, HandRight: 1.1, FingerRight: 1.1,
    LegLeft: 0.15, FootLeft: 0.08, LegRight: -0.19, FootRight: -0.08,
  };
  const raw = new Map<Body, Pose>(PARTS.map(part => [
    player.part(part.name), { x: part.dx, y: part.dy, a: angles[part.name] ?? 0 },
  ]));
  const closed = new Map<Body, Pose>();
  closeJoints(player, { pose: body => raw.get(body)! }, 1, closed);
  const scale = Math.min(rect.width / 110, rect.height / 137) * dpr;
  // The mask's atlas faces right and the skull's atlas already faces left.
  ctx.setTransform(scale, 0, 0, scale, canvas.width / 2, 26 * scale);
  if (player.id === 1) {
    ctx.save(); ctx.translate(-33, 64); ctx.rotate(-0.2);
    drawBallArt(ctx, 'stitched', 11);
    ctx.restore();
  }
  drawHorrorPlayers(ctx, [player], { pose: body => closed.get(body)! }, 1);
}
