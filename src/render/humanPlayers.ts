import { JOINTS, PARTS, type PartName } from '../sim/constants';
import type { Player } from '../sim/player';
import { ANKLE_Y, DRAW_ORDER, HEAD, HEM_Y, NECKLINE_Y, outlinePath, SLEEVE_PX } from './dollArt';
import type { PoseSource } from './dollPose';
import { drawResortPart } from './resortArt';

/** Preserve the previous textured people and their original Canvas fallback. */
const PAL = {
  skin: '#f1c7a0', skinShade: '#d8a57a',
  hair: { 1: '#4a3222', 2: '#2d2320' },
  jersey: { 1: '#2f6fde', 2: '#e2453b' },
  jerseyShade: { 1: '#1f4fa8', 2: '#a92d25' },
  shorts: { 1: '#1d3a7d', 2: '#7b1f1a' }, shoe: '#f4f4f0',
} as const;
const partDef = (name: PartName) => PARTS.find(part => part.name === name)!;

const SHOULDER_X = Object.fromEntries((['ArmLeft', 'ArmRight'] as const).map((arm) => {
  const j = JOINTS.find((j) => j.a === arm && j.b === 'Tors')!;
  return [arm, j.dx - partDef(arm).dx];
})) as Record<'ArmLeft' | 'ArmRight', number>;

/** Joint frames, drawing order and size powers match the existing human art. */
export function drawHumanPlayers(ctx: CanvasRenderingContext2D, players: readonly Player[], interp: PoseSource, alpha: number): void {
  for (const player of players) {
    for (const name of DRAW_ORDER) {
      const pose = interp.pose(player.part(name), alpha);
      ctx.save();
      ctx.translate(pose.x, pose.y);
      ctx.rotate(pose.a);
      const scale = player.partScale(name);
      ctx.scale(scale, scale);
      partArt(ctx, name, player.id);
      ctx.restore();
    }
  }
}

function partArt(ctx: CanvasRenderingContext2D, name: PartName, id: 1 | 2): void {
  if (drawResortPart(ctx, name, id)) return;
  const path = outlinePath(name);
  const jersey = PAL.jersey[id];
  const shorts = PAL.shorts[id];
  const inside = (paint: () => void) => {
    ctx.save();
    ctx.clip(path);
    paint();
    ctx.restore();
  };
  switch (name) {
    case 'Head': {
      const { cx, cy, rx, ry } = HEAD;
      ctx.fillStyle = PAL.skin;
      ctx.fill(path);
      // Hair cap.
      ctx.fillStyle = PAL.hair[id];
      ctx.beginPath();
      ctx.ellipse(cx, cy - ry * 0.28, rx * 1.02, ry * 0.78, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      // Face toward the net.
      const face = id === 1 ? 1 : -1;
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(cx + face * 4.2, cy + 0.5, 1.35, 0, Math.PI * 2);
      ctx.arc(cx + face * 0.2, cy + 0.5, 1.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8a4b3a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx + face * 2.4, cy + 4.2, 2.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      return;
    }
    case 'Tors': {
      // A bare neck, and the jersey from the shoulders down.
      ctx.fillStyle = PAL.skin;
      ctx.fill(path);
      inside(() => {
        ctx.fillStyle = jersey;
        ctx.fillRect(-13, NECKLINE_Y, 26, 40);
        ctx.fillStyle = PAL.jerseyShade[id];
        ctx.fillRect(-2.37, NECKLINE_Y + 3, 5.6, 27);
      });
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(id), 0.5, -2.5);
      return;
    }
    case 'Ass':
      ctx.fillStyle = shorts;
      ctx.fill(path);
      return;
    case 'LegLeft':
    case 'LegRight':
      ctx.fillStyle = PAL.skin;
      ctx.fill(path);
      // Shorts cover the top of the thigh.
      inside(() => {
        ctx.fillStyle = shorts;
        ctx.fillRect(-8, -21, 16, HEM_Y + 21);
      });
      return;
    case 'FootLeft':
    case 'FootRight':
      ctx.fillStyle = PAL.skinShade;
      ctx.fill(path);
      inside(() => {
        ctx.fillStyle = PAL.shoe;
        ctx.fillRect(-6, ANKLE_Y, 12, 10);
      });
      return;
    case 'ArmLeft':
    case 'ArmRight': {
      ctx.fillStyle = PAL.skin;
      ctx.fill(path);
      // A sleeve over the shoulder's ball, reaching down toward the elbow.
      const shoulder = SHOULDER_X[name];
      inside(() => {
        ctx.fillStyle = jersey;
        ctx.fillRect(shoulder < 0 ? -16 : shoulder - SLEEVE_PX, -6, 16 - Math.abs(shoulder) + SLEEVE_PX, 12);
      });
      return;
    }
    case 'HandLeft':
    case 'HandRight':
    case 'FingerLeft':
    case 'FingerRight':
      ctx.fillStyle = PAL.skin;
      ctx.fill(path);
      return;
  }
}

