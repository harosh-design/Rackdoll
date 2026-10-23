import { AIR_HEATER } from '../sim/centerObstacle';
import { COMIC, hatch, inkRect } from './comicStyle';

/** Blunt outlets and moving ink streaks show the fan's strong sides and gentler lift. */
export function drawSteamPipe(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number, seconds: number): void {
  const half = AIR_HEATER.halfWidthPx;
  ctx.save();
  ctx.lineCap = ctx.lineJoin = 'round';
  // Sparse strokes stay inside the physical reach and leave the ball easy to track.
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
    const progress = (seconds * 1.8 + i * 0.173) % 1;
    const distance = 3 + progress * (AIR_HEATER.rangePx - 3);
    const y = top + 12 + i * (bottom - top - 30) / 5;
    const edge = x + side * (half + distance);
    ctx.globalAlpha = 0.72 * Math.sin(progress * Math.PI);
    for (const [width, color] of [[2.5, COMIC.ink], [1.1, COMIC.paper]] as const) {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(edge - side * Math.min(distance, 13), y + 1);
      ctx.quadraticCurveTo(edge - side * 5, y - 1.5, edge, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(edge - side * 3.5, y - 2.1); ctx.lineTo(edge, y);
      ctx.lineTo(edge - side * 3.5, y + 2.1); ctx.stroke();
    }
    // A fine companion stroke makes the side blast look compressed and forceful.
    ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(edge - side * Math.min(distance, 7), y + 4);
    ctx.lineTo(edge - side * 2, y + 4); ctx.stroke();
  }
  // The upward traces travel at exactly one third of the lateral animation rate.
  for (let i = 0; i < 3; i++) {
    const progress = (seconds * 1.8 * AIR_HEATER.upwardRatio + i / 3) % 1;
    const distance = 3 + progress * (AIR_HEATER.rangePx - 3), y = top - distance;
    const dx = (i - 1) * 2.2;
    ctx.globalAlpha = 0.5 * Math.sin(progress * Math.PI);
    ctx.strokeStyle = COMIC.paper; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(x + dx, y + Math.min(distance, 6));
    ctx.quadraticCurveTo(x + dx - 1.7, y + 3, x + dx, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + dx - 1.3, y + 1.8); ctx.lineTo(x + dx, y);
    ctx.lineTo(x + dx + 1.3, y + 1.8); ctx.stroke();
  }
  for (const side of [-1, 1]) {
    const progress = (seconds * 1.8 + 0.2) % 1, distance = progress * AIR_HEATER.rangePx;
    ctx.globalAlpha = 0.45 * Math.sin(progress * Math.PI);
    ctx.strokeStyle = COMIC.paper; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x + side * (half + Math.max(0, distance - 9)), top - distance / 3 + 2);
    ctx.quadraticCurveTo(x + side * (half + distance - 3), top - distance / 3,
      x + side * (half + distance), top - distance / 3 - 1); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#795443'; ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.2;
  inkRect(ctx, x - half, top, half * 2, bottom - top, 1.5); ctx.fill(); ctx.stroke();
  hatch(ctx, x - half, top + 2, half * 2, bottom - top - 2, 7);
  ctx.strokeStyle = '#c89a68'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(x - 1.4, top + 3); ctx.lineTo(x - 1.4, bottom - 3); ctx.stroke();
  ctx.fillStyle = '#a6815d'; ctx.strokeStyle = COMIC.ink;
  for (const y of [top + 3, top + 37, bottom - 12]) {
    inkRect(ctx, x - half - 1.4, y, half * 2 + 2.8, 3, 1); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = COMIC.ink;
  for (let y = top + 12; y < bottom - 15; y += 12) {
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(x + side * 1.2, y, 0.65, 1.6, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Rounded, slotted cap replaces any pointed silhouette: this divider cannot impale.
  ctx.fillStyle = '#ba9671'; ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(x, top + 1.2, half + 1.2, 2.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 2, top + 0.5); ctx.lineTo(x - 2, top + 2);
  ctx.moveTo(x, top); ctx.lineTo(x, top + 2); ctx.moveTo(x + 2, top + 0.5); ctx.lineTo(x + 2, top + 2); ctx.stroke();
  ctx.fillStyle = '#4e3936'; ctx.strokeStyle = COMIC.ink;
  inkRect(ctx, x - 8, bottom - 10, 16, 17, 3); ctx.fill(); ctx.stroke();
  ctx.save(); ctx.translate(x, bottom - 2); ctx.rotate(-seconds * 7);
  ctx.strokeStyle = COMIC.ochre; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(5, -3, 3, 3); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.arc(x, bottom - 2, 5.5, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = COMIC.paper; ctx.beginPath(); ctx.arc(x, bottom - 2, 1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

interface DividerPoint { x: number; y: number }

/** Seams and patches follow the interpolated spring segments, including bends. */
export function drawStitchedPole(ctx: CanvasRenderingContext2D, points: readonly DividerPoint[]): void {
  ctx.save(); ctx.lineJoin = ctx.lineCap = 'round';
  for (const [width, color] of [[9, COMIC.ink], [6, '#735063'], [1.1, '#a87888']] as const) {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      ctx.quadraticCurveTo(points[i].x, points[i].y,
        (points[i].x + points[i + 1].x) / 2, (points[i].y + points[i + 1].y) / 2);
    }
    const tip = points[points.length - 1]; ctx.lineTo(tip.x, tip.y); ctx.stroke();
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    ctx.save(); ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
    ctx.rotate(Math.atan2(b.x - a.x, a.y - b.y));
    ctx.strokeStyle = COMIC.paper; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-2.7, -2); ctx.lineTo(2.7, 2);
    ctx.moveTo(-2.7, 2); ctx.lineTo(2.7, -2); ctx.stroke();
    if (i === 2 || i === 5) {
      ctx.fillStyle = '#bca47a'; ctx.fillRect(-1.8, 5, 3.6, 6);
      ctx.strokeStyle = COMIC.ink; ctx.setLineDash([1, 1]); ctx.strokeRect(-1.8, 5, 3.6, 6);
    }
    ctx.restore();
  }
  ctx.restore();
}
