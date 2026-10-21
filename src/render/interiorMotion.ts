import type { GameMapId } from '../sim/maps';
import { COMIC, hatch } from './comicStyle';

export type InteriorMapId = Exclude<GameMapId, 'graveyard'>;

/** All moving scenery is vector geometry, anchored to the painted environment. */
export function drawInteriorMotion(ctx: CanvasRenderingContext2D, id: InteriorMapId,
  width: number, floorY: number, seconds: number): void {
  const scale = width / 640, floor = floorY / scale;
  ctx.save(); ctx.scale(scale, scale);
  if (id === 'crematorium') {
    for (const [side, x] of [80.5, 556.5].entries()) {
      drawFirebox(ctx, x, floor * 0.912, seconds, side * 2.1);
      drawVentSteam(ctx, side ? 520 : 119, floor * 0.23, seconds, side);
      drawLamp(ctx, side ? 528 : 112, side ? 88 : 99, seconds, side * 1.7);
    }
  } else {
    drawCurtain(ctx, floor, seconds, false);
    drawCurtain(ctx, floor, seconds, true);
    drawGarland(ctx, seconds);
  }
  ctx.restore();
}

/** Low, warm ink flames stay inside the two raster firebox openings. */
function drawFirebox(ctx: CanvasRenderingContext2D, x: number, y: number, seconds: number, phase: number): void {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.rect(-15, -39, 30, 39); ctx.clip();
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = '#8d5938';
  ctx.beginPath(); ctx.ellipse(0, -2, 15, 4, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 5; i++) {
    const center = (i - 2) * 5.4;
    const lift = 13 + 4 * Math.sin(seconds * 1.9 + phase + i * 1.7) + (i === 2 ? 9 : 0);
    const lean = Math.sin(seconds * 1.15 + phase + i) * 2.5;
    ctx.fillStyle = i % 2 ? '#bd8848' : '#a87341';
    ctx.beginPath(); ctx.moveTo(center - 4, 0);
    ctx.bezierCurveTo(center - 7, -lift * 0.35, center + lean + 2, -lift * 0.55, center + lean, -lift);
    ctx.bezierCurveTo(center + lean + 7, -lift * 0.47, center + 5, -lift * 0.3, center + 4, 0);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 0.5; ctx.fillStyle = '#d4aa65';
  ctx.beginPath(); ctx.ellipse(0, -2.2, 10, 2.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1; ctx.strokeStyle = '#241d26'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-14, -3); ctx.lineTo(14, -3); ctx.stroke();
  ctx.restore();
}

/** Wisps remain at the pipework rather than crossing the ball's flight area. */
function drawVentSteam(ctx: CanvasRenderingContext2D, x: number, y: number, seconds: number, side: number): void {
  ctx.save(); ctx.strokeStyle = '#c4c6bc'; ctx.lineWidth = 0.75;
  for (let i = 0; i < 3; i++) {
    const progress = (seconds * 0.12 + i / 3 + side * 0.21) % 1;
    const rise = progress * 29, drift = Math.sin(progress * 4 + seconds * 0.3 + side) * 4;
    ctx.globalAlpha = Math.sin(progress * Math.PI) * 0.2;
    ctx.beginPath(); ctx.moveTo(x, y - rise);
    ctx.bezierCurveTo(x - 7 + drift, y - rise - 6, x + 5 + drift, y - rise - 11, x + drift, y - rise - 16);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLamp(ctx: CanvasRenderingContext2D, x: number, length: number, seconds: number, phase: number): void {
  ctx.save(); ctx.translate(x, -3); ctx.rotate(Math.sin(seconds * 0.43 + phase) * 0.018);
  ctx.strokeStyle = '#302b34'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, length); ctx.stroke();
  ctx.translate(0, length);
  ctx.fillStyle = '#77624e'; ctx.strokeStyle = '#1d1a25'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(-7, 3); ctx.quadraticCurveTo(-5, -4, 0, -5);
  ctx.quadraticCurveTo(5, -4, 7, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ac8e5e'; ctx.beginPath(); ctx.ellipse(0, 3, 5.4, 1.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3c3034'; ctx.fillRect(-1.5, -7, 3, 3);
  ctx.restore();
}

/** Stripes, folds, stitching and torn hems move with the same curtain contour. */
function drawCurtain(ctx: CanvasRenderingContext2D, floor: number, seconds: number, right: boolean): void {
  const sway = Math.sin(seconds * 0.48 + (right ? 2.1 : 0)) * 1.3;
  const tie = floor * 0.57;
  ctx.save(); ctx.translate(right ? 640 : 0, 0); ctx.scale(right ? -1 : 1, 1);
  const outline = new Path2D();
  outline.moveTo(0, 0); outline.lineTo(81, 0);
  outline.bezierCurveTo(68, 38, 54, tie - 39, 29 + sway, tie);
  outline.lineTo(23 + sway, tie + 7);
  outline.bezierCurveTo(29 + sway, floor - 68, 23 + sway * 0.5, floor - 27, 22 + sway, floor - 3);
  outline.lineTo(18 + sway, floor - 6); outline.lineTo(16 + sway, floor - 1);
  outline.lineTo(12 + sway * 0.5, floor - 5); outline.lineTo(8, floor - 1);
  outline.lineTo(0, floor); outline.closePath();
  ctx.fillStyle = '#592e3a'; ctx.fill(outline);
  ctx.save(); ctx.clip(outline);
  for (let i = 0; i < 4; i++) {
    const top = 9 + i * 23, waist = 3 + i * 7;
    ctx.fillStyle = i % 2 ? '#9b8267' : '#713b44';
    ctx.beginPath(); ctx.moveTo(top, 0); ctx.lineTo(top + 11, 0);
    ctx.bezierCurveTo(top + 4, 53, waist + 9 + sway, tie - 23, waist + 6 + sway, tie);
    ctx.bezierCurveTo(waist + 8 + sway, tie + 42, waist + 5 + sway, floor - 27, waist + 4 + sway, floor + 1);
    ctx.lineTo(waist - 1 + sway, floor + 1);
    ctx.bezierCurveTo(waist + 2 + sway, floor - 63, waist + 2 + sway, tie + 28, waist + 1 + sway, tie);
    ctx.bezierCurveTo(waist + 5 + sway, tie - 30, top - 1, 43, top, 0); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(20,15,25,0.22)';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(20, 0); ctx.quadraticCurveTo(15, tie * 0.55, 12, tie);
  ctx.lineTo(8, floor); ctx.lineTo(0, floor); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.globalAlpha = 0.35; hatch(ctx, 0, 0, 84, floor, 5); ctx.restore();
  ctx.strokeStyle = '#251923'; ctx.lineWidth = 0.5;
  for (let i = 0; i < 18; i++) {
    const y = 16 + i * 20, x = 6 + (i * 31 % 39);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1.5, y + 7); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1; ctx.stroke(outline);
  ctx.strokeStyle = '#b79b6b'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.ellipse(18 + sway, tie + 2, 10, 3, -0.25, 0, Math.PI * 2); ctx.stroke();
  ctx.save(); ctx.translate(25 + sway, tie + 6); ctx.rotate(Math.sin(seconds * 0.61 + (right ? 1 : 0)) * 0.07);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(6, 7, 3, 18); ctx.stroke();
  ctx.fillStyle = '#9a7c55';
  ctx.beginPath(); ctx.moveTo(3, 15); ctx.lineTo(-0.5, 23); ctx.lineTo(6.5, 23); ctx.closePath(); ctx.fill();
  ctx.restore(); ctx.restore();
}

function wireY(ratio: number, seconds: number): number {
  return 31 + Math.sin(ratio * Math.PI) * (18 + Math.sin(seconds * 0.31) * 0.6);
}

/** The garland stays above the main rally area; every bulb remains attached. */
function drawGarland(ctx: CanvasRenderingContext2D, seconds: number): void {
  ctx.save(); ctx.strokeStyle = '#3c2934'; ctx.lineWidth = 0.85;
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const ratio = i / 24, x = 64 + ratio * 512, y = wireY(ratio, seconds);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (let i = 0; i < 11; i++) {
    const ratio = (i + 0.5) / 11, x = 64 + ratio * 512, y = wireY(ratio, seconds);
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(seconds * 0.55 + i * 0.7) * 0.055);
    ctx.strokeStyle = '#392933'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 4); ctx.stroke();
    ctx.fillStyle = i === 1 || i === 9 ? '#a88450' : '#65514b';
    ctx.beginPath(); ctx.ellipse(0, 5.6, 1.35, 2.1, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#34262f'; ctx.fillRect(-1, 2.8, 2, 1.5);
    ctx.restore();
  }
  for (const [index, ratio] of [0.2, 0.36, 0.64, 0.8].entries()) {
    const x = 64 + ratio * 512, y = wireY(ratio, seconds);
    ctx.fillStyle = index % 2 ? '#785151' : '#8e795b';
    ctx.beginPath(); ctx.moveTo(x - 3.5, y); ctx.lineTo(x + 3.5, y);
    ctx.lineTo(x + Math.sin(seconds * 0.6 + index) * 0.8, y + 8); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
