import { BEES } from '../sim/constants';
import { BEE_FLIGHT, beePosition, beeRadiusPx, type Bee, type BeePop } from '../sim/bees';
import type { GameWorld } from '../sim/world';
import { POWER_LABELS, type PowerId } from '../sim/powerUps';
import type { Interpolator } from './interp';

/**
 * Bee gifts, drawn in world space. Each bee shows its power before it is
 * hit: the giant's bee is big with arrows pushing out, the tiny's small with
 * arrows pulling in. The feather, high jump and magnet bees carry a feather,
 * a spring and a horseshoe magnet. The speed bee trails streaks, and the
 * shield bee flies inside a bubble. A halo in the power's colour and a small
 * label back that up.
 */

/** Each power's colour, as r,g,b, for halos, arrows and the pop. */
const BEE_RGB: Record<PowerId, string> = {
  giant: '255,140,42', tiny: '176,124,255', feather: '255,255,255', highJump: '56,208,122',
  speed: '255,79,160', magnet: '232,57,46', shield: '79,210,255',
};

/** The label's ink, a darker shade of the same colour so it reads on the sky. */
const BEE_INK: Record<PowerId, string> = {
  giant: '#b4520a', tiny: '#6a3dc0', feather: '#4f5d6b', highJump: '#16804a',
  speed: '#c4246f', magnet: '#b5261d', shield: '#16739f',
};

/** How far below the bee's centre its label sits, in the bee's own units. */
const LABEL_DROP: Record<PowerId, number> = {
  giant: 15, tiny: 15, feather: 37, highJump: 33, speed: 15, magnet: 35, shield: 25,
};

/** Wing beat, radians per frame: a big bee beats slowly, a small one fast. */
const FLAP: Record<PowerId, number> = {
  giant: 1.05, tiny: 2.6, feather: 1.5, highJump: 1.8, speed: 2.3, magnet: 1.8, shield: 1.8,
};

const INK = '#2a2118';

export function drawBees(ctx: CanvasRenderingContext2D, gw: GameWorld, now: number, alpha: number): void {
  for (const bee of gw.bees.bees) {
    const age = bee.prevAge + (bee.age - bee.prevAge) * alpha;
    drawBee(ctx, bee, age, now);
  }
}

function drawBee(ctx: CanvasRenderingContext2D, bee: Bee, age: number, now: number): void {
  const kind = bee.kind;
  const f = BEE_FLIGHT[kind];
  const s = f.scale;
  const { xPx, yPx } = beePosition(bee, age);
  // Pitch with the flight: nose up while climbing.
  const ahead = beePosition(bee, age + 0.05);
  const pitch = Math.max(-0.4, Math.min(0.4, 0.7 * Math.atan2(ahead.yPx - yPx, f.speed * 0.05)));
  const w = f.freq * age + bee.phase;
  const flap = now * FLAP[kind] + bee.phase * 7;

  ctx.save();
  ctx.translate(xPx, yPx);
  halo(ctx, kind, beeRadiusPx(kind) * 1.9);
  if (kind === 'giant' || kind === 'tiny') sizeArrows(ctx, kind, now + bee.phase * 10);

  ctx.save();
  ctx.rotate(bee.dir * pitch);
  ctx.scale(bee.dir * s, s);
  if (kind === 'speed') {
    speedStreaks(ctx, now);
    for (const [dx, a] of [[-26, 0.14], [-13, 0.28]] as const) {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(dx, 0);
      beeBody(ctx, flap - dx);
      ctx.restore();
    }
  }
  if (kind === 'feather') feather(ctx, Math.sin(w * 1.3));
  if (kind === 'highJump') spring(ctx, 1 - Math.abs(Math.sin(w)));
  if (kind === 'magnet') magnet(ctx, now);
  beeBody(ctx, flap);
  if (kind === 'shield') bubble(ctx, now);
  ctx.restore();

  label(ctx, kind, LABEL_DROP[kind] * s + 4);
  ctx.restore();
}

function halo(ctx: CanvasRenderingContext2D, kind: PowerId, r: number): void {
  const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
  g.addColorStop(0, `rgba(${BEE_RGB[kind]},0.42)`);
  g.addColorStop(1, `rgba(${BEE_RGB[kind]},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Four arrowheads on the diagonals: pushing out for giant, pulling in for tiny. */
function sizeArrows(ctx: CanvasRenderingContext2D, kind: PowerId, t: number): void {
  const grow = kind === 'giant';
  const r = beeRadiusPx(kind);
  const p = (((t % 26) + 26) % 26) / 26;
  const d = grow ? r + 8 + 12 * p : r + 22 - 12 * p;
  const size = grow ? 6.5 : 4.5;
  ctx.fillStyle = `rgba(${BEE_RGB[kind]},${0.95 * Math.sin(p * Math.PI)})`;
  ctx.strokeStyle = `rgba(255,255,255,${0.8 * Math.sin(p * Math.PI)})`;
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.rotate(Math.PI / 4 + (k * Math.PI) / 2);
    ctx.translate(d, 0);
    if (!grow) ctx.scale(-1, 1);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.5, -size * 0.85);
    ctx.lineTo(-size * 0.5, size * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** The bee itself, facing +x, at unit size: about 43 px nose to sting. */
function beeBody(ctx: CanvasRenderingContext2D, flap: number): void {
  const beat = 0.5 + 0.5 * Math.sin(flap);
  wing(ctx, 2, -8, -0.85, beat, 0.65);

  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(-13, -3);
  ctx.lineTo(-21, 0.8);
  ctx.lineTo(-13, 3.8);
  ctx.closePath();
  ctx.fill();

  const g = ctx.createLinearGradient(0, -11, 0, 11);
  g.addColorStop(0, '#ffe36e');
  g.addColorStop(0.55, '#ffc21a');
  g.addColorStop(1, '#df9600');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = INK;
  for (const x of [-9, -1]) {
    ctx.beginPath();
    ctx.ellipse(x, 0, 2.7, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = '#3a2a10';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 11, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(3, -6, 6, 2.4, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // Head, antennae and a big eye.
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(14.5, -1.5, 7.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(16.5, -8);
  ctx.quadraticCurveTo(19, -14, 23, -15);
  ctx.moveTo(13, -8.5);
  ctx.quadraticCurveTo(13.5, -15.5, 17, -17.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(23, -15, 1.8, 0, Math.PI * 2);
  ctx.arc(17, -17.5, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(17, -3, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(18.1, -2.6, 1.6, 0, Math.PI * 2);
  ctx.fill();

  wing(ctx, -2, -9, -0.6, beat, 1);
}

/** A wing hinged on the back, foreshortened through the beat. */
function wing(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, beat: number, alpha: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + 0.35 * beat);
  ctx.scale(1, 0.3 + 0.7 * beat);
  ctx.fillStyle = `rgba(236,248,255,${0.82 * alpha})`;
  ctx.strokeStyle = `rgba(80,112,145,${0.7 * alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, -9, 5.5, 9.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Two legs reaching down to whatever the bee carries. */
function legs(ctx: CanvasRenderingContext2D, toY: number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-3, 9);
  ctx.lineTo(-1.5, toY);
  ctx.moveTo(4, 9);
  ctx.lineTo(2.5, toY);
  ctx.stroke();
}

function feather(ctx: CanvasRenderingContext2D, sway: number): void {
  legs(ctx, 14);
  ctx.save();
  ctx.translate(1, 12);
  ctx.rotate(0.15 * sway);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(70,90,110,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.bezierCurveTo(10, 7, 9, 19, 1, 27);
  ctx.bezierCurveTo(-8, 19, -9, 7, 0, 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120,140,160,0.55)';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const y = 7 + i * 4;
    ctx.moveTo(0.4, y);
    ctx.lineTo(6, y - 3);
    ctx.moveTo(0.4, y);
    ctx.lineTo(-5.5, y - 3);
  }
  ctx.stroke();
  ctx.strokeStyle = '#a8946a';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.quadraticCurveTo(1.5, 14, 1, 29);
  ctx.stroke();
  ctx.restore();
}

/** A coiled spring under the bee, squashed as it bounces. */
function spring(ctx: CanvasRenderingContext2D, squash: number): void {
  const top = 10;
  const len = 19 * (1 - 0.5 * squash);
  const coils = 4;
  ctx.strokeStyle = '#7d8a96';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, top);
  for (let i = 0; i < coils * 2; i++) {
    ctx.lineTo(i % 2 === 0 ? 6 : -6, top + (len * (i + 0.5)) / (coils * 2));
  }
  ctx.lineTo(0, top + len);
  ctx.stroke();
  ctx.fillStyle = '#26a65f';
  ctx.strokeStyle = '#13693a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, top + len + 2, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** A red horseshoe magnet, poles down, with a pulsing field. */
function magnet(ctx: CanvasRenderingContext2D, now: number): void {
  legs(ctx, 14);
  ctx.save();
  ctx.translate(1, 21);
  ctx.lineCap = 'butt';
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#e8392e';
  ctx.beginPath();
  ctx.arc(0, 0, 7, Math.PI, 0);
  ctx.lineTo(7, 6);
  ctx.moveTo(-7, 0);
  ctx.lineTo(-7, 6);
  ctx.stroke();
  ctx.strokeStyle = '#dfe4e8';
  ctx.beginPath();
  ctx.moveTo(-7, 6);
  ctx.lineTo(-7, 11);
  ctx.moveTo(7, 6);
  ctx.lineTo(7, 11);
  ctx.stroke();
  const p = (now % 18) / 18;
  ctx.strokeStyle = `rgba(232,57,46,${0.7 * (1 - p)})`;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(0, 11, 4 + 9 * p, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

/** Speed lines streaming off the back. */
function speedStreaks(ctx: CanvasRenderingContext2D, now: number): void {
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const shift = ((now * 4 + i * 7) % 14);
    ctx.strokeStyle = `rgba(255,79,160,${0.75 - i * 0.15})`;
    ctx.lineWidth = 2.2 - i * 0.4;
    ctx.beginPath();
    ctx.moveTo(-22 - shift, -6 + i * 6);
    ctx.lineTo(-40 - shift - i * 4, -6 + i * 6);
    ctx.stroke();
  }
}

function bubble(ctx: CanvasRenderingContext2D, now: number): void {
  const r = 24 + Math.sin(now * 0.2) * 0.8;
  const g = ctx.createRadialGradient(-7, -8, 2, 0, 0, r);
  g.addColorStop(0, 'rgba(255,255,255,0.3)');
  g.addColorStop(0.7, 'rgba(79,210,255,0.12)');
  g.addColorStop(1, 'rgba(79,210,255,0.42)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,170,230,0.9)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, r - 4, 3.65, 4.45);
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, kind: PowerId, y: number): void {
  ctx.font = '800 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeText(POWER_LABELS[kind], 0, y);
  ctx.fillStyle = BEE_INK[kind];
  ctx.fillText(POWER_LABELS[kind], 0, y);
}

/**
 * A popped bee: a ring in the power's colour, bits of bee flying off, and a
 * spark that flies to the head of whoever got the power.
 */
export function drawBeePops(
  ctx: CanvasRenderingContext2D, gw: GameWorld, interp: Interpolator, alpha: number, now: number,
): void {
  for (const pop of gw.bees.pops) {
    const since = now - pop.frame;
    if (!(since >= 0 && since < BEES.popFrames)) continue;
    drawPop(ctx, gw, interp, alpha, pop, since);
  }
}

function drawPop(
  ctx: CanvasRenderingContext2D, gw: GameWorld, interp: Interpolator, alpha: number, pop: BeePop, since: number,
): void {
  const rgb = BEE_RGB[pop.kind];
  const p = since / BEES.popFrames;
  const r = beeRadiusPx(pop.kind);
  ctx.save();
  for (const [lag, r1, width, color] of [[0, r + 40, 4, rgb], [2, r + 22, 2.5, '255,194,26']] as const) {
    const q = (since - lag) / (BEES.popFrames - 4);
    if (q < 0 || q >= 1) continue;
    ctx.strokeStyle = `rgba(${color},${0.85 * (1 - q)})`;
    ctx.lineWidth = width * (1 - q) + 0.8;
    ctx.beginPath();
    ctx.arc(pop.xPx, pop.yPx, r * 0.6 + (r1 - r * 0.6) * (1 - (1 - q) ** 3), 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + 0.4;
    const d = r * 0.5 + 34 * (1 - (1 - p) ** 2);
    ctx.fillStyle = k % 2 === 0 ? `rgba(255,194,26,${1 - p})` : `rgba(42,33,24,${1 - p})`;
    ctx.beginPath();
    ctx.arc(pop.xPx + Math.cos(a) * d, pop.yPx + Math.sin(a) * d + 10 * p * p, 2.6 * (1 - 0.5 * p), 0, Math.PI * 2);
    ctx.fill();
  }
  const travel = Math.min(1, since / 12);
  if (travel < 1) {
    const head = interp.pose((pop.owner === 1 ? gw.p1 : gw.p2).head, alpha);
    const e = travel < 0.5 ? 2 * travel * travel : 1 - (-2 * travel + 2) ** 2 / 2;
    const x = pop.xPx + (head.x - pop.xPx) * e;
    const y = pop.yPx + (head.y - pop.yPx) * e - 40 * Math.sin(travel * Math.PI);
    ctx.fillStyle = `rgba(${rgb},0.9)`;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
