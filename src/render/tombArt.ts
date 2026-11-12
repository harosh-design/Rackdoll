import { BALL, FLOOR_TOP_PX, MS_PER_FRAME, TIMERS } from '../sim/constants';
import type { Tomb, TombSlab } from '../sim/tomb';
import { COMIC, COMIC_TEXT, COMIC_TITLE, comicPanel, hatch } from './comicStyle';
import { drawBallArt, type BallSkin } from './ballArt';

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Quiet pencil stone, with architecture and burial details around the edges. */
export function drawTombHall(ctx: CanvasRenderingContext2D, width: number, height: number, floorY: number,
  seconds = 0, reducedMotion = false): void {
  ctx.save(); ctx.scale(width / 640, height / 400);
  const floor = floorY * 400 / height, time = reducedMotion ? 0 : seconds;
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
  for (const slab of tomb.slabs) drawSlab(ctx, slab, FLOOR_TOP_PX, frame - slab.hitFrame, reduced);
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

/** An opaque comic cutaway replaces the players before the opening is revealed. */
export function drawTombGoal(ctx: CanvasRenderingContext2D, tomb: Tomb, frame: number, width: number, height: number,
  reduced: boolean, skin: BallSkin): void {
  const scene = tomb.transition;
  if (!scene) return;
  const t = clamp((frame - scene.frame) / (TIMERS.goalMs / MS_PER_FRAME - 1));
  const repair = clamp((t - 0.69) / 0.23), broken = scene.broken !== null;
  ctx.save(); ctx.scale(width / 640, height / 400);
  comicPanel(ctx, 27, 85, 586, 275, '#69616c');
  hatch(ctx, 29, 88, 582, 269, 14);
  ctx.fillStyle = COMIC.paper; ctx.font = '19px ' + COMIC_TITLE; ctx.textAlign = 'center';
  ctx.fillText(repair > 0 ? 'THE TOMB RESETS' : broken ? 'SOMETHING BELOW CLAIMS THE BALL' : 'THE STONES REMEMBER', 320, 114);
  ctx.font = '10px ' + COMIC_TEXT;
  ctx.fillText(repair > 0 ? 'All twelve slabs restored before the next serve' : 'Rally over', 320, 132);
  ctx.save(); ctx.beginPath(); ctx.rect(45, 145, 550, 145); ctx.clip();
  if (broken) {
    const open = reduced ? 1 : clamp(t / 0.09);
    ctx.fillStyle = COMIC.ink;
    ctx.beginPath(); ctx.ellipse(320, 258, 112 * open * (1 - repair * 0.3), 24 * (reduced && repair > 0 ? 0 : 1 - repair), 0, 0, Math.PI * 2); ctx.fill();
    // Fractured stone halves move away only after active play has ended.
    for (const side of [-1, 1]) {
      ctx.save(); ctx.translate(320 + side * (69 + open * 66), 250 + open * 8); ctx.rotate(side * open * 0.16);
      drawSlab(ctx, { ...tomb.slabs[scene.broken!], left: -62, right: 62, hitX: 0, state: 'cracked' }, 0, 20, true); ctx.restore();
    }
    const reach = reduced ? (repair > 0 ? 0 : 1) : clamp((t - 0.04) / 0.18) * (1 - clamp((t - 0.47) / 0.2));
    if (reach > 0) {
      // Only a forearm, a palm and gripping fingertips ever leave the dark.
      const palmY = 286 - reach * 94;
      bone(ctx, [[303, 294], [296, palmY + 40], [317, palmY + 13]], 12);
      bone(ctx, [[330, 294], [322, palmY + 43], [326, palmY + 15]], 8);
      ctx.fillStyle = COMIC.paper; ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(321, palmY + 10, 18, 22, -0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const x = 308 + i * 9;
        bone(ctx, [[x, palmY + 8], [x - 8, palmY - 12 - i * 2], [x - 3, palmY - 29], [x + 5, palmY - 23]], 4.5);
      }
      ctx.save(); ctx.translate(327, palmY - 17); ctx.rotate(scene.ballAngle);
      drawBallArt(ctx, skin, BALL.radiusPx); ctx.restore();
      bone(ctx, [[334, palmY + 19], [349, palmY - 1], [339, palmY - 15]], 5);
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
        const x = 320 + side * (83 + i * 9);
        bone(ctx, [[x - side * 9, 282], [x, 251], [x + side * 8, 253]], 4);
      }
      ctx.fillStyle = COMIC.ochre; ctx.beginPath(); ctx.ellipse(356, 269, 5, 2, -0.2, 0, Math.PI * 2); ctx.fill();
    }
    if (repair > 0) {
      const slide = reduced ? 0 : (1 - repair) * 120;
      drawSlab(ctx, { ...tomb.slabs[scene.broken!], left: 205 + slide, right: 435 + slide, hitX: 320 }, 246, 99, true, true);
      if (repair < 1) for (const x of [257, 380]) bone(ctx, [[x + slide, 281], [x + slide - 9, 263], [x + slide + 9, 257]], 4);
    }
  } else {
    ctx.fillStyle = COMIC.muted; ctx.font = '18px ' + COMIC_TITLE;
    ctx.fillText('THE KEEPERS REPLACE EVERY DAMAGED STONE', 320, 213);
  }
  ctx.restore();
  // Show the complete court being renewed, including slabs away from the goal.
  ctx.font = '9px ' + COMIC_TEXT; ctx.fillStyle = COMIC.paper;
  ctx.fillText(repair >= 1 ? 'COURT SEALED · READY TO SERVE' : 'LEFT COURT                         RIGHT COURT', 320, 341);
  for (const slab of tomb.slabs) {
    const x = 60 + slab.index * 43 + (slab.owner === 2 ? 4 : 0);
    const renewed = repair > 0 && repair >= (slab.index + 1) / 12;
    const offset = renewed && !reduced ? (1 - repair) * 15 : 0;
    drawSlab(ctx, { ...slab, left: x, right: x + 40, hitX: x + 20 }, 302 - offset, 99, true, renewed);
    if (repair > 0 && repair < 1) bone(ctx, [[x + 5, 328], [x + 7, 316 - offset], [x + 15, 315 - offset]], 2);
  }
  ctx.restore();
}
