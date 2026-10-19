import { CHAMELEON, TIME_STEP, toPx } from '../sim/constants';
import type { Executer } from '../sim/executer';
import type { PoseSource } from './dollPose';
import type { Pose } from './interp';
import { COMIC, hatch } from './comicStyle';
import { CHAMELEON_BODY_ANGLE, chameleonLegPoses, type ChameleonLegPose, type ChameleonPlacement, type ChameleonPoint } from './chameleonGait';

let bodySprite: HTMLImageElement | undefined;
let legSprite: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
let reducedMotion: MediaQueryList | undefined;

/** The approved fern-and-lichen cutout is also used by the hazard queue icon. */
export function loadChameleonArt(): Promise<void> {
  const load = (part: string, accept: (image: HTMLImageElement) => void) => new Promise<void>(resolve => {
    const image = new Image();
    image.onload = () => { accept(image); resolve(); };
    image.onerror = () => { console.warn('Could not load chameleon ' + part + ' art'); resolve(); };
    image.src = import.meta.env.BASE_URL + 'art/horror/props/chameleon-' + part + '.webp';
  });
  loading ??= Promise.all([load('body', image => { bodySprite = image; }), load('leg', image => { legSprite = image; })]).then(() => {});
  return loading;
}

const LEG_SOURCE = {
  shoulder: { x: 980, y: 200 }, elbow: { x: 390, y: 470 }, wrist: { x: 745, y: 850 },
  size: 1280, footAngle: 1.38, footScale: 0.016,
} as const;

/** Split through the joint crease; a small overlap covers the rotating ink seam. */
function clipJoint(ctx: CanvasRenderingContext2D, slope: number, intercept: number, below: boolean): void {
  const size = LEG_SOURCE.size;
  ctx.beginPath(); ctx.moveTo(0, intercept); ctx.lineTo(size, slope * size + intercept);
  ctx.lineTo(size, below ? size : 0); ctx.lineTo(0, below ? size : 0); ctx.closePath(); ctx.clip();
}

/** Map a textured limb section between two bones, retaining the original printed skin. */
function legSection(ctx: CanvasRenderingContext2D, sourceA: ChameleonPoint, sourceB: ChameleonPoint,
  a: ChameleonPoint, b: ChameleonPoint, upper: boolean, width: number): void {
  if (!legSprite) return;
  const sourceAngle = Math.atan2(sourceB.y - sourceA.y, sourceB.x - sourceA.x);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const sourceLength = Math.hypot(sourceB.x - sourceA.x, sourceB.y - sourceA.y);
  ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
  ctx.scale(length / sourceLength, width); ctx.rotate(-sourceAngle); ctx.translate(-sourceA.x, -sourceA.y);
  if (upper) clipJoint(ctx, 0.197, 399, false);
  else { clipJoint(ctx, 0.197, 387, true); clipJoint(ctx, -0.535, 1255, false); }
  ctx.drawImage(legSprite, 0, 0, LEG_SOURCE.size, LEG_SOURCE.size); ctx.restore();
}

function drawLegJoint(ctx: CanvasRenderingContext2D, at: ChameleonPoint, source: ChameleonPoint, radius: number): void {
  if (!legSprite) return;
  const scale = legSprite.naturalWidth / LEG_SOURCE.size;
  ctx.save(); ctx.beginPath(); ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#94a15e'; ctx.fill(); ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 0.4; ctx.stroke(); ctx.clip();
  ctx.drawImage(legSprite, (source.x - 80) * scale, (source.y - 80) * scale, 160 * scale, 160 * scale,
    at.x - radius, at.y - radius, radius * 2, radius * 2); ctx.restore();
}

function drawLeg(ctx: CanvasRenderingContext2D, leg: ChameleonLegPose): void {
  if (!legSprite) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(leg.root.x, leg.root.y); ctx.lineTo(leg.elbow.x, leg.elbow.y);
    ctx.lineTo(leg.wrist.x, leg.wrist.y); ctx.lineTo(leg.foot.x + 1, leg.foot.y);
    for (const [width, color] of [[5, COMIC.ink], [2.8, COMIC.mint]] as const) {
      ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
    }
    ctx.strokeStyle = COMIC.paper; ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(leg.foot.x, leg.foot.y - 2); ctx.lineTo(leg.foot.x + 2, leg.foot.y);
    ctx.lineTo(leg.foot.x, leg.foot.y + 2); ctx.stroke();
    return;
  }
  // Draw the lower section first; overlapping flesh conceals the rotating elbow seam.
  legSection(ctx, LEG_SOURCE.elbow, LEG_SOURCE.wrist, leg.elbow, leg.wrist, false, leg.far ? 0.011 : 0.014);
  legSection(ctx, LEG_SOURCE.shoulder, LEG_SOURCE.elbow, leg.root, leg.elbow, true, leg.far ? 0.013 : 0.017);
  drawLegJoint(ctx, leg.elbow, LEG_SOURCE.elbow, leg.far ? 1.2 : 1.65);
  ctx.save(); ctx.translate(leg.wrist.x, leg.wrist.y); ctx.rotate(LEG_SOURCE.footAngle);
  ctx.scale(LEG_SOURCE.footScale, LEG_SOURCE.footScale); ctx.translate(-LEG_SOURCE.wrist.x, -LEG_SOURCE.wrist.y);
  clipJoint(ctx, -0.535, 1243, true);
  ctx.drawImage(legSprite, 0, 0, LEG_SOURCE.size, LEG_SOURCE.size); ctx.restore();
  drawLegJoint(ctx, leg.wrist, LEG_SOURCE.wrist, leg.far ? 0.9 : 1.15);
}

function drawMossBody(ctx: CanvasRenderingContext2D, inward: number, gaze: number): void {
  if (!bodySprite) return;
  const x = -31, y = -40, w = 56, h = 84;
  ctx.drawImage(bodySprite, x, y, w, h);
  // Rotate the original golden iris inside its fixed ink rim to follow the target.
  ctx.save();
  ctx.beginPath(); ctx.arc(17.3, 20.5, 2.65, 0, Math.PI * 2); ctx.clip();
  ctx.translate(17.3, 20.5);
  ctx.rotate(Math.atan2(Math.sin(gaze), Math.cos(gaze) * inward) - CHAMELEON_BODY_ANGLE + 0.6);
  ctx.translate(-17.3, -20.5); ctx.drawImage(bodySprite, x, y, w, h); ctx.restore();
}

/** Downward-facing wall crawler, with a curled tail and four grasping feet. */
export function drawChameleonArt(ctx: CanvasRenderingContext2D, inward: number, gaze: number, t: number, pulling = false,
  placement: ChameleonPlacement = { wallX: -27, travelPx: t * CHAMELEON.crawlSpeedPx * TIME_STEP }): void {
  reducedMotion ??= window.matchMedia('(prefers-reduced-motion: reduce)');
  const legs = chameleonLegPoses({ ...placement, travelPx: reducedMotion.matches ? 0 : placement.travelPx });
  ctx.save(); ctx.scale(inward, 1);
  for (const leg of legs) if (leg.far) drawLeg(ctx, leg);
  ctx.save(); ctx.rotate(CHAMELEON_BODY_ANGLE);
  if (bodySprite) drawMossBody(ctx, inward, gaze);
  else drawFallbackBody(ctx, inward, gaze, pulling);
  ctx.restore();
  for (const leg of legs) if (!leg.far) drawLeg(ctx, leg);
  if (pulling) {
    ctx.fillStyle = COMIC.rust; ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.ellipse(CHAMELEON.mouthOffsetXPx, CHAMELEON.mouthOffsetYPx, 2.1, 1.2, CHAMELEON_BODY_ANGLE - 0.2, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function drawFallbackBody(ctx: CanvasRenderingContext2D, inward: number, gaze: number, pulling: boolean): void {
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
