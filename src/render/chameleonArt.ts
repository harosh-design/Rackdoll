import { CHAMELEON, toPx } from '../sim/constants';
import type { Executer } from '../sim/executer';
import type { PoseSource } from './dollPose';
import type { Pose } from './interp';
import { COMIC, hatch } from './comicStyle';

let sprite: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
let reducedMotion: MediaQueryList | undefined;

/** The approved fern-and-lichen cutout is also used by the hazard queue icon. */
export function loadChameleonArt(): Promise<void> {
  loading ??= new Promise<void>(resolve => {
    const image = new Image();
    image.onload = () => { sprite = image; resolve(); };
    image.onerror = () => { console.warn('Could not load chameleon art'); resolve(); };
    image.src = import.meta.env.BASE_URL + 'art/horror/props/chameleon.webp';
  });
  return loading;
}

/** A tiny travelling bend animates the printed cutout while its mouth stays fixed. */
function drawMossChameleon(ctx: CanvasRenderingContext2D, inward: number, gaze: number, t: number, pulling: boolean): void {
  if (!sprite) return;
  reducedMotion ??= window.matchMedia('(prefers-reduced-motion: reduce)');
  const phase = reducedMotion.matches ? 0 : t * 0.16 * 1.15;
  const x = -31, y = -40, w = 56, h = 84, bands = 28;
  ctx.save(); ctx.scale(inward, 1);
  for (let band = 0; band < bands; band++) {
    const f = band / bands;
    const sy = sprite.naturalHeight * f;
    const sh = Math.min(sprite.naturalHeight - sy, sprite.naturalHeight / bands + 1);
    const bend = reducedMotion.matches ? 0 : Math.sin(phase + f * Math.PI * 3) * 0.65 * Math.max(0, 1 - f / 0.7);
    ctx.drawImage(sprite, 0, sy, sprite.naturalWidth, sh, x + bend, y + h * f, w, h * sh / sprite.naturalHeight);
  }
  // Rotate the original golden iris inside its fixed ink rim to follow the target.
  ctx.save();
  ctx.beginPath(); ctx.arc(17.3, 20.5, 2.65, 0, Math.PI * 2); ctx.clip();
  ctx.translate(17.3, 20.5);
  ctx.rotate(Math.atan2(Math.sin(gaze), Math.cos(gaze) * inward) + 0.6);
  ctx.translate(-17.3, -20.5); ctx.drawImage(sprite, x, y, w, h); ctx.restore();
  if (pulling) {
    ctx.fillStyle = COMIC.rust; ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.ellipse(CHAMELEON.mouthOffsetXPx, CHAMELEON.mouthOffsetYPx, 2.5, 1.4, -0.2, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** Downward-facing wall crawler, with a curled tail and four grasping feet. */
export function drawChameleonArt(ctx: CanvasRenderingContext2D, inward: number, gaze: number, t: number, pulling = false): void {
  if (sprite) { drawMossChameleon(ctx, inward, gaze, t, pulling); return; }
  ctx.save(); ctx.scale(inward, 1);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 2;

  // A spiral tail makes its silhouette readable even in the queue preview.
  ctx.beginPath(); ctx.moveTo(-2, -17);
  ctx.bezierCurveTo(-12, -30, 1, -42, 15, -34);
  ctx.bezierCurveTo(29, -26, 17, -13, 9, -20);
  ctx.bezierCurveTo(3, -26, 13, -32, 17, -26);
  for (const [width, color] of [[8, COMIC.ink], [4.5, COMIC.mint]] as const) {
    ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
  }

  // Opposite pairs step together, with split toes pressed against the wall.
  for (const [row, side] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const step = Math.sin(t * 0.184 + (row === side ? 0 : Math.PI)) * 2.5;
    const y = row * 12;
    const toeX = side < 0 ? -25 : 12;
    const toeY = y + 8 + step;
    ctx.beginPath(); ctx.moveTo(side * 5, y);
    ctx.lineTo(side < 0 ? -17 : 18, y - 3 + step); ctx.lineTo(toeX, toeY);
    for (const [width, color] of [[6, COMIC.ink], [3, COMIC.mint]] as const) {
      ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
    }
    ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(toeX - 3, toeY + 3); ctx.lineTo(toeX, toeY);
    ctx.lineTo(toeX + 3, toeY + 3); ctx.stroke();
    ctx.fillStyle = COMIC.paper;
    for (const dx of [-3, 3]) {
      ctx.beginPath(); ctx.arc(toeX + dx, toeY + 3, 1.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Uneven dorsal spines, a pale belly, and inked scales match the comic props.
  ctx.lineWidth = 2; ctx.strokeStyle = COMIC.ink; ctx.fillStyle = COMIC.mint;
  ctx.beginPath(); ctx.moveTo(3, -21);
  ctx.bezierCurveTo(18, -13, 14, 12, 5, 22);
  ctx.quadraticCurveTo(-10, 24, -12, 9);
  ctx.lineTo(-16, 5); ctx.lineTo(-12, 1); ctx.lineTo(-17, -4);
  ctx.lineTo(-12, -7); ctx.lineTo(-15, -12); ctx.lineTo(-9, -13);
  ctx.quadraticCurveTo(-7, -23, 3, -21); ctx.fill(); ctx.stroke();
  ctx.fillStyle = COMIC.paper;
  ctx.beginPath(); ctx.ellipse(6, 0, 5, 16, -0.1, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.ellipse(-4, -1, 6, 17, 0, 0, Math.PI * 2); ctx.clip();
  hatch(ctx, -11, -18, 15, 36, 6); ctx.restore();
  ctx.fillStyle = COMIC.plum;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.ellipse(-4 + (i % 2) * 3, -13 + i * 6, 1.6, 1, 0.5, 0, Math.PI * 2); ctx.fill();
  }

  // Casque, bulging turret eye, and a blunt snout turned toward the arena.
  ctx.fillStyle = COMIC.mint;
  ctx.beginPath(); ctx.moveTo(-6, 13); ctx.lineTo(-8, 4); ctx.lineTo(4, 10);
  ctx.quadraticCurveTo(17, 9, 22, 25); ctx.quadraticCurveTo(17, 33, 2, 29);
  ctx.quadraticCurveTo(-9, 26, -6, 13); ctx.fill(); ctx.stroke();
  ctx.fillStyle = COMIC.ochre;
  ctx.beginPath(); ctx.arc(10, 17, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = COMIC.paper; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(10, 17, 5.8, -2.8, -0.4); ctx.stroke();
  const lookX = Math.cos(gaze) * inward * 3, lookY = Math.sin(gaze) * 3;
  ctx.fillStyle = COMIC.ink;
  ctx.beginPath(); ctx.ellipse(10 + lookX, 17 + lookY, 2.4, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COMIC.paper; ctx.beginPath(); ctx.arc(9 + lookX, 16 + lookY, 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(6, 26); ctx.quadraticCurveTo(13, pulling ? 30 : 28, 20, 25); ctx.stroke();
  if (pulling) {
    ctx.fillStyle = COMIC.rust;
    ctx.beginPath(); ctx.ellipse(18, 26, 3, 2.4, -0.3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** The shot flies to a fixed aim point, follows a caught body, then coils back. */
export function drawChameleonTongue(ctx: CanvasRenderingContext2D, e: Executer, pose: Pose, interp: PoseSource, alpha: number): void {
  if (e.phase === 'crawl') return;
  const inward = e.side === 1 ? 1 : -1;
  const mouth = { x: pose.x + inward * CHAMELEON.mouthOffsetXPx, y: pose.y + CHAMELEON.mouthOffsetYPx };
  const frame = Math.max(0, e.phaseAge - 1 + alpha);
  const attached = e.phase === 'tongue-pull' && e.tongueTarget;
  const end = attached ? interp.pose(attached, alpha) : { x: toPx(e.tongueAim.x), y: toPx(e.tongueAim.y) };
  const reach = e.phase === 'tongue-extend' ? Math.min(1, frame / CHAMELEON.extendFrames)
    : e.phase === 'tongue-retract' ? Math.max(0, 1 - frame / CHAMELEON.retractFrames) : 1;
  const x = mouth.x + (end.x - mouth.x) * reach;
  const y = mouth.y + (end.y - mouth.y) * reach;
  const sag = attached ? Math.sin(frame * 0.8) * 2 : 9 * Math.sin(reach * Math.PI);
  ctx.save(); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(mouth.x, mouth.y);
  ctx.quadraticCurveTo((mouth.x + x) / 2, (mouth.y + y) / 2 + sag, x, y);
  for (const [width, color] of [[5, COMIC.ink], [2.8, COMIC.rust]] as const) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  ctx.fillStyle = COMIC.rust; ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.ellipse(x, y, attached ? 6 : 4, 3.5, Math.atan2(y - mouth.y, x - mouth.x), 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
