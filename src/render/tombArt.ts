import { BALL, FLOOR_TOP_PX } from '../sim/constants';
import type { Tomb, TombSlab } from '../sim/tomb';
import { COMIC, comicPanel, hatch } from './comicStyle';
import { drawBallArt, type BallSkin } from './ballArt';
import { tombScenePose } from './tombScene';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
let background: HTMLImageElement | undefined;
let backgroundLoading: Promise<void> | undefined;

export function loadTombArt(): Promise<void> {
  return backgroundLoading ??= (async () => {
    try {
      const image = new Image();
      image.src = import.meta.env.BASE_URL + 'art/horror/background-tomb.webp';
      await image.decode();
      background = image;
    } catch { console.warn('Could not load Tomb background art'); }
  })();
}


/** Quiet pencil stone, with architecture and burial details around the edges. */
export function drawTombHall(ctx: CanvasRenderingContext2D, width: number, height: number, floorY: number,
  seconds = 0, reducedMotion = false): void {
  ctx.save(); ctx.scale(width / 640, height / 400);
  const floor = floorY * 400 / height, time = reducedMotion ? 0 : seconds;
  if (background) {
    const sourceFloor = background.naturalHeight * 0.95;
    ctx.drawImage(background, 0, 0, background.naturalWidth, sourceFloor, 0, 0, 640, floor);
    ctx.drawImage(background, 0, sourceFloor, background.naturalWidth, background.naturalHeight - sourceFloor, 0, floor, 640, 400 - floor);
  } else {
    ctx.fillStyle = '#62646e'; ctx.fillRect(0, 0, 640, 400);
    ctx.fillStyle = '#77747c'; ctx.fillRect(45, 60, 550, floor - 60);
    ctx.strokeStyle = '#3f3b4a'; ctx.lineWidth = 1.3;
    // Tall vault ribs stay above the ball's principal flight path.
    for (const inset of [0, 20, 39]) {
      ctx.beginPath(); ctx.moveTo(inset, floor); ctx.lineTo(inset, 126);
      ctx.bezierCurveTo(inset, -14 + inset, 640 - inset, -14 + inset, 640 - inset, 126);
      ctx.lineTo(640 - inset, floor); ctx.stroke();
    }
    for (const side of [0, 1]) {
      ctx.save(); ctx.translate(side * 640, 0); ctx.scale(side ? -1 : 1, 1);
      ctx.fillStyle = '#36333f'; ctx.fillRect(0, 94, 45, floor - 94);
      hatch(ctx, 0, 90, 45, floor - 90, 8);
      for (let n = 0; n < 3; n++) {
        const y = 133 + n * 61;
        ctx.fillStyle = '#1b1924';
        ctx.beginPath(); ctx.moveTo(7, y + 35); ctx.lineTo(7, y + 6);
        ctx.quadraticCurveTo(21, y - 13, 36, y + 6); ctx.lineTo(36, y + 35); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#726574'; ctx.strokeRect(11, y + 14, 21, 18);
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(13, y + 19 + k * 4); ctx.lineTo(29 - k * 2, y + 19 + k * 4); ctx.stroke(); }
      }
      ctx.fillStyle = '#292633'; ctx.fillRect(48, floor - 76, 34, 76);
      hatch(ctx, 48, floor - 76, 34, 76, 6);
      ctx.strokeStyle = '#9c8a85'; ctx.lineWidth = 2;
      for (let y = floor - 70; y < floor; y += 13) { ctx.beginPath(); ctx.moveTo(49, y); ctx.lineTo(80, y + 1); ctx.stroke(); }
      // Candles, wax drips and restrained, warm light.
      for (const [x, lift] of [[35, 0], [89, 3], [99, -2]]) {
        const y = floor - 8 - lift;
        ctx.fillStyle = COMIC.muted; ctx.fillRect(x, y - 14, 3, 14);
        ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 0.6; ctx.strokeRect(x, y - 14, 3, 14);
        ctx.fillStyle = '#d6b66e'; ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.ellipse(x + 1.5, y - 18, 1.5, 3 + Math.sin(time * 3 + x) * 0.5, 0.1, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    ctx.fillStyle = '#39323e'; ctx.fillRect(0, floor, 640, 400 - floor);
    hatch(ctx, 0, floor, 640, 400 - floor, 13);
  }
  ctx.fillStyle = COMIC.paper;
  for (let i = 0; i < 20; i++) {
    ctx.globalAlpha = 0.08 + (i % 3) * 0.02;
    const x = (i * 137 + time * 1.1) % 640, y = (i * 83 + time * 1.7) % floor;
    ctx.fillRect(x, y, 0.7, 0.7);
  }
  ctx.restore();
}

export function drawBurialColumn(ctx: CanvasRenderingContext2D, x: number, top: number, floor: number): void {
  ctx.save();
  comicPanel(ctx, x - 3, top, 6, floor - top, '#99908b');
  hatch(ctx, x - 3, top + 2, 3, floor - top - 2, 5);
  ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 0.65;
  for (let y = top + 14; y < floor - 5; y += 18) {
    ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x + 1.5, y); ctx.lineTo(x, y + 3); ctx.lineTo(x - 1.5, y); ctx.closePath(); ctx.stroke();
  }
  comicPanel(ctx, x - 3, top, 6, 3, COMIC.muted);
  ctx.restore();
}

function drawSlab(ctx: CanvasRenderingContext2D, slab: TombSlab, y: number, age: number, reduced: boolean, repaired = false): void {
  const cracked = !repaired && slab.state !== 'intact';
  const wobble = cracked && !reduced && age < 12 ? Math.sin(age * 1.7) * (1 - age / 12) * 1.4 : 0;
  const left = slab.left + 0.6, right = slab.right - 0.6, w = right - left;
  ctx.save(); ctx.translate(0, wobble);
  ctx.fillStyle = '#302b38'; ctx.fillRect(left, y, w, 23);
  ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y);
  ctx.lineTo(right - 2, y + 18 + (cracked ? 1 : 0)); ctx.lineTo(left + 2, y + 19); ctx.closePath();
  ctx.fillStyle = cracked ? '#8d8185' : '#a79b95'; ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.3; ctx.fill(); ctx.stroke();
  hatch(ctx, left + 3, y + 12, w - 6, 5, 9);
  ctx.strokeStyle = '#665b65'; ctx.lineWidth = 0.7;
  ctx.strokeRect(left + w * 0.34, y + 4, w * 0.32, 8);
  for (let n = 0; n < 3; n++) { ctx.beginPath(); ctx.moveTo(left + w * 0.4, y + 6 + n * 2); ctx.lineTo(left + w * 0.62 - n * 2, y + 6 + n * 2); ctx.stroke(); }
  if (cracked) {
    const hit = Math.max(left + 3, Math.min(right - 3, slab.hitX));
    const growth = reduced ? 1 : clamp((age + 1) / 4);
    ctx.save(); ctx.beginPath(); ctx.rect(left, y - 2, w, 26); ctx.clip();
    for (const [color, line] of [[COMIC.mint, 3.4], [COMIC.ink, 2.2]] as const) {
      ctx.strokeStyle = color; ctx.lineWidth = line; ctx.beginPath();
      for (let n = 0; n < 5; n++) {
        const end = left + w * n / 4;
        ctx.moveTo(hit, y + 1);
        ctx.lineTo(hit + (end - hit) * growth * 0.4, y + 6);
        ctx.lineTo(hit + (end - hit) * growth * 0.65 + (n % 2 ? 3 : -3), y + 9);
        ctx.lineTo(hit + (end - hit) * growth, y + 19);
      }
      ctx.stroke();
    }
    ctx.restore();
    if (!reduced && age >= 0 && age < 15) {
      ctx.fillStyle = COMIC.muted; ctx.globalAlpha = (1 - age / 15) * 0.6;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath(); ctx.arc(hit + Math.sin(i * 4) * age * 1.6, y - 2 - age * (0.5 + i % 3 * 0.3), 1.2 + i % 2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  ctx.restore();
}

export function drawTombFloor(ctx: CanvasRenderingContext2D, tomb: Tomb, frame: number, reduced: boolean): void {
  const pose = tombScenePose(tomb, frame, reduced);
  for (const slab of tomb.slabs) {
    const repaired = !!pose && pose.repair > 0 && pose.repair >= (slab.index + 1) / 12;
    if (pose?.slab === slab && pose.opening > 0) {
      drawOpening(ctx, slab, pose.opening);
      continue;
    }
    drawSlab(ctx, slab, FLOOR_TOP_PX, frame - slab.hitFrame, reduced, repaired);
  }
}

/** The gap occupies exactly one real slab; neighboring stones never move. */
function drawOpening(ctx: CanvasRenderingContext2D, slab: TombSlab, amount: number): void {
  const y = FLOOR_TOP_PX, width = slab.right - slab.left;
  ctx.save(); ctx.beginPath(); ctx.rect(slab.left + 0.5, y, width - 1, 26); ctx.clip();
  ctx.fillStyle = COMIC.ink; ctx.fillRect(slab.left, y, width, 26);
  for (const side of [-1, 1]) {
    const center = (slab.left + slab.right) / 2;
    const edge = side < 0 ? slab.left : slab.right;
    ctx.save(); ctx.translate(edge, y); ctx.rotate(-side * amount * 1.2);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(center - edge, 1);
    ctx.lineTo(center - edge + side * 3, 9); ctx.lineTo(center - edge - side * 2, 19);
    ctx.lineTo(0, 21); ctx.closePath(); ctx.fillStyle = '#95868c';
    ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.4; ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** Jointed ink-and-bone fingers. Also reused by the hands replacing the slabs. */
function bone(ctx: CanvasRenderingContext2D, points: number[][], width: number): void {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [color, line] of [[COMIC.ink, width + 3], [COMIC.paper, width]] as const) {
    ctx.strokeStyle = color; ctx.lineWidth = line; ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
  }
  ctx.fillStyle = COMIC.muted;
  for (const [x, y] of points.slice(1, -1)) { ctx.beginPath(); ctx.arc(x, y, width * 0.5, 0, Math.PI * 2); ctx.fill(); }
}

/** World-space animation at the scored slab and the saved ball impact position. */
export function drawTombGoal(ctx: CanvasRenderingContext2D, tomb: Tomb, frame: number,
  reduced: boolean, skin: BallSkin): void {
  const pose = tombScenePose(tomb, frame, reduced);
  const scene = tomb.transition;
  if (!pose || !scene) return;
  const { slab, repair } = pose;
  // Repair the whole court in place, rather than a detached miniature strip.
  for (const stone of tomb.slabs) {
    if (stone.state === 'intact' || repair <= 0 || repair >= 1 || stone === slab) continue;
    const amount = clamp(repair * 12 - stone.index);
    if (amount <= 0 || amount >= 1) continue;
    const center = (stone.left + stone.right) / 2;
    for (const side of [-1, 1]) bone(ctx, [[center + side * 16, FLOOR_TOP_PX + 24],
      [center + side * 18, FLOOR_TOP_PX + 5], [center + side * 12, FLOOR_TOP_PX + 3]], 2.5);
  }
  if (!slab) return;
  const floor = FLOOR_TOP_PX, width = slab.right - slab.left;
  ctx.save();
  // Nothing belonging to the creature can appear through an adjacent slab.
  ctx.beginPath(); ctx.moveTo(slab.left - 50, floor - 260);
  ctx.lineTo(slab.right + 50, floor - 260); ctx.lineTo(slab.right + 50, floor);
  ctx.lineTo(slab.right, floor); ctx.lineTo(slab.right, floor + 24);
  ctx.lineTo(slab.left, floor + 24); ctx.lineTo(slab.left, floor);
  ctx.lineTo(slab.left - 50, floor); ctx.closePath(); ctx.clip();
  if (pose.opening > 0.3 && pose.retreat < 1) {
    ctx.fillStyle = COMIC.ochre;
    ctx.beginPath(); ctx.ellipse(pose.originX + 17, floor + 10, 3.5, 1.3, -0.15, 0, Math.PI * 2); ctx.fill();
  }
  if (pose.handVisible) {
    const x = pose.palmX, y = pose.palmY;
    // The two forearm bones emerge inside the actual hole and bend to the ball.
    bone(ctx, [[pose.originX - 7, floor + 24], [x - 15, (floor + y) / 2], [x - 9, y + 18]], 6);
    bone(ctx, [[pose.originX + 8, floor + 24], [x - 2, (floor + y) / 2 + 3], [x + 8, y + 20]], 4.5);
    ctx.fillStyle = COMIC.paper; ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(x, y + 8, 14, 18, -0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const fingerX = x - 13 + i * 7;
      bone(ctx, [[fingerX, y + 4], [fingerX - 4, y - 12 - i],
        [fingerX + 1, y - 29], [fingerX + 7, y - 23]], 3.3);
    }
    // Grip fingers curl over the real edges of this particular stone opening.
    for (const side of [-1, 1]) for (let i = 0; i < 2; i++) {
      const edge = side < 0 ? slab.left + 4 + i * 5 : slab.right - 4 - i * 5;
      bone(ctx, [[edge + side * 4, floor + 19], [edge, floor - 6], [edge - side * 4, floor - 2]], 2.5);
    }
  }
  ctx.restore();
  // Above the floor the ball keeps its true impact X, even at a slab seam.
  ctx.save(); ctx.beginPath(); ctx.rect(slab.left - 50, floor - 260, width + 100, 260); ctx.clip();
  if (pose.ballVisible) {
    ctx.save(); ctx.translate(pose.ballX, pose.ballY); ctx.rotate(scene.ballAngle);
    drawBallArt(ctx, skin, BALL.radiusPx); ctx.restore();
    if (pose.handVisible && pose.grab >= 0.9) {
      bone(ctx, [[pose.palmX + 9, pose.palmY + 12], [pose.palmX + 22, pose.palmY - 3],
        [pose.palmX + 12, pose.palmY - 17]], 4);
    }
  }
  ctx.restore();
  if (repair > 0 && repair < 1) {
    ctx.save(); ctx.beginPath(); ctx.rect(slab.left, floor, width, 24); ctx.clip();
    drawSlab(ctx, slab, floor + (1 - repair) * 25, 100, true, true);
    ctx.restore();
    for (const side of [-1, 1]) bone(ctx, [[pose.originX + side * 14, floor + 24],
      [pose.originX + side * 18, floor + (1 - repair) * 23 + 2],
      [pose.originX + side * 10, floor + (1 - repair) * 23]], 2.5);
  }
}
