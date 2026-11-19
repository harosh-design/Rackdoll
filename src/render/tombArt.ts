import { BALL, FLOOR_TOP_PX, LEFT_WALL_INNER_PX, RIGHT_WALL_INNER_PX } from '../sim/constants';
import { tombSlabs, type Tomb, type TombSlab } from '../sim/tomb';
import { drawBallArt, type BallSkin } from './ballArt';
import { COMIC, hatch } from './comicStyle';
import { drawSkeletonPart } from './horrorArt';
import type { TombScenePose } from './tombScene';

const STONE_DEPTH = 23;
const FLOOR_WIDTH = RIGHT_WALL_INNER_PX - LEFT_WALL_INNER_PX;
const ATLAS_SCALE = 2;
let stoneAtlas: HTMLCanvasElement | undefined;

function paintStone(ctx: CanvasRenderingContext2D, slab: TombSlab, y: number, cracked: boolean): void {
  const left = slab.left + 0.7, right = slab.right - 0.7;
  const width = right - left, center = (left + right) / 2;
  const nick = 2 + slab.index % 4;
  ctx.fillStyle = '#312536';
  ctx.fillRect(left, y + 5, width, STONE_DEPTH - 5);
  ctx.beginPath();
  ctx.moveTo(left, y + 2); ctx.lineTo(left + 3, y + 0.7);
  ctx.lineTo(right - nick, y + 0.7); ctx.lineTo(right, y + 2.8);
  ctx.lineTo(right - 2, y + 17); ctx.lineTo(right - 7, y + 20);
  ctx.lineTo(left + 4, y + 19.5); ctx.closePath();
  ctx.fillStyle = cracked ? '#705665' : '#97808a';
  ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.1; ctx.fill(); ctx.stroke();

  // A worn bevel catches warm light, with ink scratches along the lower edge.
  ctx.strokeStyle = cracked ? '#9b7e7a' : '#c3a693'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(left + 4, y + 2.3); ctx.lineTo(right - nick - 1, y + 2.3); ctx.stroke();
  ctx.fillStyle = cracked ? '#584051' : '#725766';
  ctx.beginPath();
  ctx.moveTo(left + 3, y + 14); ctx.lineTo(right - 2.5, y + 13);
  ctx.lineTo(right - 4, y + 17); ctx.lineTo(right - 8, y + 19);
  ctx.lineTo(left + 5, y + 18.5); ctx.closePath(); ctx.fill();
  hatch(ctx, left + 5, y + 14, width - 12, 4, 4);

  // The incised diamond and short cuts borrow the court frame's ornament.
  ctx.strokeStyle = '#4a3747'; ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(center - 5, y + 8); ctx.lineTo(center, y + 4.6);
  ctx.lineTo(center + 5, y + 8); ctx.lineTo(center, y + 11.4); ctx.closePath();
  for (const side of [-1, 1]) {
    ctx.moveTo(center + side * 8, y + 8); ctx.lineTo(center + side * (17 + nick), y + 8);
    ctx.moveTo(center + side * 10, y + 10.6); ctx.lineTo(center + side * 16, y + 10.6);
  }
  ctx.stroke();
  ctx.fillStyle = '#c6a794';
  ctx.fillRect(center - 0.7, y + 7.5, 1.4, 1.4);
}

function stoneStrip(): HTMLCanvasElement {
  if (stoneAtlas) return stoneAtlas;
  const canvas = document.createElement('canvas');
  canvas.width = FLOOR_WIDTH * ATLAS_SCALE;
  canvas.height = STONE_DEPTH * 2 * ATLAS_SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(ATLAS_SCALE, 0, 0, ATLAS_SCALE, -LEFT_WALL_INNER_PX * ATLAS_SCALE, 0);
  for (const slab of tombSlabs()) {
    paintStone(ctx, slab, 0, false);
    paintStone(ctx, slab, STONE_DEPTH, true);
  }
  stoneAtlas = canvas;
  return canvas;
}

/** Draw all twelve intact stones in one pass, including on the menu card. */
export function drawTombIntactFloor(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
  const strip = stoneStrip();
  ctx.drawImage(strip, 0, 0, strip.width, STONE_DEPTH * ATLAS_SCALE,
    x, y, width, STONE_DEPTH * width / FLOOR_WIDTH);
}

function drawStone(ctx: CanvasRenderingContext2D, slab: TombSlab, y: number, cracked = false): void {
  const width = slab.right - slab.left;
  ctx.drawImage(stoneStrip(), (slab.left - LEFT_WALL_INNER_PX) * ATLAS_SCALE,
    cracked ? STONE_DEPTH * ATLAS_SCALE : 0, width * ATLAS_SCALE, STONE_DEPTH * ATLAS_SCALE,
    slab.left, y, width, STONE_DEPTH);
}

function crackPath(slab: TombSlab, growth: number): Path2D {
  const crack = new Path2D(), y = FLOOR_TOP_PX;
  const width = slab.right - slab.left;
  const hit = slab.hitX;
  const fork = hit + (slab.left + width * 0.5 - hit) * 0.22 * growth;
  crack.moveTo(hit, y + 1); crack.lineTo(fork + 2, y + 5); crack.lineTo(fork, y + 9);
  for (const [fraction, drop] of [[0.08, 17], [0.53, 19], [0.93, 14]]) {
    const end = hit + (slab.left + width * fraction - hit) * growth;
    crack.moveTo(fork, y + 9);
    crack.lineTo(fork + (end - fork) * 0.45, y + 10);
    crack.lineTo(fork + (end - fork) * 0.68, y + 13);
    crack.lineTo(end, y + drop);
  }
  return crack;
}

const settledCracks = new WeakMap<TombSlab, { hit: number; path: Path2D }>();

function drawCrack(ctx: CanvasRenderingContext2D, slab: TombSlab, age: number, reduced: boolean): void {
  const growth = reduced ? 1 : Math.max(0, Math.min(1, (age + 1) / 4));
  let path: Path2D;
  if (growth < 1) {
    path = crackPath(slab, growth);
  } else {
    let cached = settledCracks.get(slab);
    if (cached?.hit !== slab.hitX) {
      cached = { hit: slab.hitX, path: crackPath(slab, 1) };
      settledCracks.set(slab, cached);
    }
    path = cached.path;
  }
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#c8a084'; ctx.lineWidth = 3.1; ctx.stroke(path);
  ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.7; ctx.stroke(path);
  if (!reduced && age >= 0 && age < 14) {
    ctx.fillStyle = COMIC.muted; ctx.globalAlpha = (1 - age / 14) * 0.65;
    for (let i = 0; i < 6; i++) {
      const size = 1.4 + i % 3;
      ctx.fillRect(slab.hitX + Math.sin(i * 4) * age * 1.6,
        FLOOR_TOP_PX - 2 - age * (0.5 + i % 3 * 0.3), size, size);
    }
  }
  ctx.restore();
}

export function drawTombFloor(ctx: CanvasRenderingContext2D, tomb: Tomb, scene: TombScenePose | null,
  frame: number, reduced: boolean): void {
  drawTombIntactFloor(ctx, LEFT_WALL_INNER_PX, FLOOR_TOP_PX, FLOOR_WIDTH);
  for (const slab of tomb.slabs) {
    if (slab.state === 'intact') continue;
    if (scene?.slab === slab && scene.opening > 0) {
      drawOpening(ctx, slab, scene.opening);
      continue;
    }
    if (scene && scene.repair * tomb.slabs.length >= slab.index + 1) continue;
    drawStone(ctx, slab, FLOOR_TOP_PX, true);
    drawCrack(ctx, slab, frame - slab.hitFrame, reduced);
  }
}

/** Only the scored stone opens, with the adjacent slab edges still in view. */
function drawOpening(ctx: CanvasRenderingContext2D, slab: TombSlab, amount: number): void {
  const y = FLOOR_TOP_PX, width = slab.right - slab.left;
  ctx.save(); ctx.beginPath(); ctx.rect(slab.left + 0.5, y, width - 1, STONE_DEPTH + 3); ctx.clip();
  ctx.fillStyle = COMIC.ink; ctx.fillRect(slab.left, y, width, STONE_DEPTH + 3);
  const center = (slab.left + slab.right) / 2;
  for (const side of [-1, 1]) {
    const edge = side < 0 ? slab.left : slab.right;
    ctx.save(); ctx.translate(edge, y); ctx.rotate(-side * amount * 1.2);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(center - edge, 1);
    ctx.lineTo(center - edge + side * 3, 9); ctx.lineTo(center - edge - side * 2, 19);
    ctx.lineTo(0, 21); ctx.closePath(); ctx.fillStyle = '#8d717d';
    ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.4; ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#c09a83'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(center - edge, 3); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawHand(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(size, size);
  drawSkeletonPart(ctx, 'FingerRight');
  ctx.restore();
}

function drawForearm(ctx: CanvasRenderingContext2D, x: number, y: number, wristX: number, wristY: number): void {
  const dx = wristX - x, dy = wristY - y;
  ctx.save(); ctx.translate(x + dx / 2, y + dy / 2); ctx.rotate(Math.atan2(dy, dx));
  ctx.scale(Math.hypot(dx, dy) / 22, 1.55);
  drawSkeletonPart(ctx, 'HandRight');
  ctx.restore();
}

function drawEdgeHands(ctx: CanvasRenderingContext2D, slab: TombSlab, y: number): void {
  drawHand(ctx, slab.left + 12, y, 1.18, -1.18);
  drawHand(ctx, slab.right - 12, y, 1.18, -1.96);
}

/** The goal animation stays registered to the scored slab and saved impact position. */
export function drawTombGoal(ctx: CanvasRenderingContext2D, tomb: Tomb, pose: TombScenePose, skin: BallSkin): void {
  const { slab, repair } = pose;
  const floor = FLOOR_TOP_PX;
  if (repair > 0 && repair < 1) {
    for (const stone of tomb.slabs) {
      const amount = repair * tomb.slabs.length - stone.index;
      if (stone !== slab && stone.state !== 'intact' && amount > 0 && amount < 1) {
        drawEdgeHands(ctx, stone, floor + 5);
      }
    }
  }
  if (!slab) return;
  const width = slab.right - slab.left;
  ctx.save();
  // Below the floor, clip the hand to the actual opening.
  ctx.beginPath(); ctx.moveTo(slab.left - 50, floor - 260);
  ctx.lineTo(slab.right + 50, floor - 260); ctx.lineTo(slab.right + 50, floor);
  ctx.lineTo(slab.right, floor); ctx.lineTo(slab.right, floor + 24);
  ctx.lineTo(slab.left, floor + 24); ctx.lineTo(slab.left, floor);
  ctx.lineTo(slab.left - 50, floor); ctx.closePath(); ctx.clip();
  if (pose.opening > 0.3 && pose.retreat < 1) {
    ctx.fillStyle = COMIC.ochre;
    ctx.beginPath(); ctx.ellipse(pose.originX + 13, floor + 8, 3.5, 1.3, -0.15, 0, Math.PI * 2); ctx.fill();
  }
  if (pose.handVisible) {
    drawForearm(ctx, pose.originX, floor + 25, pose.palmX, pose.palmY + 21);
    drawHand(ctx, pose.palmX, pose.palmY + 7, 4, -Math.PI / 2);
    drawEdgeHands(ctx, slab, floor + 7);
  }
  ctx.restore();
  // A seam impact still uses the ball's true X above the floor.
  if (pose.ballVisible) {
    ctx.save(); ctx.beginPath(); ctx.rect(slab.left - 50, floor - 260, width + 100, 260); ctx.clip();
    ctx.translate(pose.ballX, pose.ballY); ctx.rotate(pose.ballAngle);
    drawBallArt(ctx, skin, BALL.radiusPx);
    ctx.restore();
  }
  if (repair > 0 && repair < 1) {
    const lidY = floor + (1 - repair) * (STONE_DEPTH + 2);
    ctx.save(); ctx.beginPath(); ctx.rect(slab.left, floor, width, STONE_DEPTH + 1); ctx.clip();
    drawStone(ctx, slab, lidY);
    ctx.restore();
    drawEdgeHands(ctx, slab, lidY + 5);
  }
}
