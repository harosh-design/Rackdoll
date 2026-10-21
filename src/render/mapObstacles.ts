import { AIR_HEATER } from '../sim/centerObstacle';
import { COMIC, hatch, inkRect } from './comicStyle';

/** Steam remains inside the same reach as the physical repulsion field. */
export function drawSteamPipe(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number, seconds: number): void {
  const half = AIR_HEATER.halfWidthPx;
  ctx.save();
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
  ctx.strokeStyle = COMIC.paper; ctx.lineWidth = 0.85;
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const progress = (seconds * 0.55 + i * 0.21) % 1;
    const distance = progress * AIR_HEATER.rangePx;
    const y = top + 15 + i * (bottom - top - 30) / 4;
    const edge = x + side * (half + distance);
    ctx.globalAlpha = 0.48 * Math.sin(progress * Math.PI);
    ctx.beginPath(); ctx.moveTo(edge - side * 9, y + 1);
    ctx.bezierCurveTo(edge - side * 3, y + 4, edge + side * 3, y - 6, edge - side * 1, y - 5);
    ctx.bezierCurveTo(edge - side * 5, y - 5, edge - side * 4, y - 1, edge, y - 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#4e3936'; ctx.strokeStyle = COMIC.ink;
  inkRect(ctx, x - 8, bottom - 10, 16, 17, 3); ctx.fill(); ctx.stroke();
  ctx.fillStyle = COMIC.ochre;
  for (let dx = -3; dx <= 3; dx += 3) ctx.fillRect(x + dx - 0.5, bottom - 5, 1, 7);
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
