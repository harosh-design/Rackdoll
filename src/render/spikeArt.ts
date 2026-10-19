import type { CenterObstacle } from '../sim/centerObstacle';
import { SHARP_SPIKE } from '../sim/centerObstacle';
import { FLOOR_TOP_PX, NET_X_PX } from '../sim/constants';

/** Blood accumulates on the blade and trickles down its silhouette until reset. */
export function drawSpikeBlood(ctx: CanvasRenderingContext2D, obstacle: CenterObstacle, basePx: number, alpha: number): void {
  if (!obstacle.bloodstains.length || obstacle.id !== 'sharp') return;
  const x = NET_X_PX, tip = SHARP_SPIKE.topPx;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, tip);
  ctx.lineTo(x + SHARP_SPIKE.halfWidthPx, FLOOR_TOP_PX);
  ctx.lineTo(x - SHARP_SPIKE.halfWidthPx, FLOOR_TOP_PX);
  ctx.closePath(); ctx.clip();
  ctx.lineCap = 'round';
  for (let i = 0; i < obstacle.bloodstains.length; i++) {
    const stain = obstacle.bloodstains[i];
    const age = Math.max(0, stain.age - 1 + alpha);
    const y = Math.max(tip + 0.5, stain.height - 7 * stain.scale);
    const end = Math.min(basePx - 3, stain.height + (28 + age * 0.65) * stain.scale);
    const side = (i % 3 - 1) * 1.1;
    ctx.strokeStyle = '#670c24'; ctx.lineWidth = 5 * stain.scale;
    ctx.beginPath(); ctx.moveTo(x + side, y);
    ctx.quadraticCurveTo(x - side + 1, y + 14, x + side * 0.5, end); ctx.stroke();
    ctx.fillStyle = '#bc1230';
    ctx.beginPath(); ctx.ellipse(x - side, stain.height + 3, 5 * stain.scale, 12 * stain.scale, -0.15, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ec3046'; ctx.lineWidth = 1.2 * stain.scale;
    ctx.beginPath(); ctx.moveTo(x + side - 0.8, y + 3);
    ctx.quadraticCurveTo(x - side, y + 15, x + side * 0.5 - 0.6, end - 2); ctx.stroke();
  }
  ctx.restore();

  // A brief burst makes the instant of impalement readable at the court scale.
  ctx.save(); ctx.fillStyle = '#c51635';
  for (let i = 0; i < obstacle.bloodstains.length; i++) {
    const stain = obstacle.bloodstains[i];
    const age = Math.max(0, stain.age - 1 + alpha);
    if (age >= 14) continue;
    ctx.globalAlpha = 1 - age / 14;
    for (let drop = 0; drop < 5; drop++) {
      const direction = (drop % 2 ? -1 : 1);
      const dx = direction * (2 + age * (0.7 + drop * 0.2));
      const dy = -age * (0.65 + drop * 0.18) + age * age * 0.075;
      ctx.beginPath();
      ctx.ellipse(x + dx * stain.scale, stain.height + dy * stain.scale, 1.1 * stain.scale, 1.8 * stain.scale, direction * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
