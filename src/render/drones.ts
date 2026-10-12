import { BEES } from '../sim/constants';
import { BEE_FLIGHT, beePosition, beeRadiusPx, type Bee, type BeePop } from '../sim/bees';
import type { GameWorld } from '../sim/world';
import { POWER_LABELS, type PowerId } from '../sim/powerUps';
import type { PoseSource } from './dollPose';
import { drawArenaSprite } from './arenaArt';

/** The existing collectible flight and hit sweep now drive gift-delivery drones. */
const BEE_RGB: Record<PowerId, string> = {
  giant: '255,140,42', tiny: '176,124,255', feather: '226,240,255', highJump: '56,208,122',
  speed: '255,120,135', magnet: '232,87,70', shield: '79,210,255',
};
const GLYPHS: Record<PowerId, string> = {
  giant: '+', tiny: '−', feather: '≈', highJump: '↑', speed: '»', magnet: '∩', shield: '◇',
};

export function drawDrones(ctx: CanvasRenderingContext2D, gw: GameWorld, now: number, alpha: number): void {
  for (const drone of gw.bees.bees) {
    const age = drone.prevAge + (drone.age - drone.prevAge) * alpha;
    drawDrone(ctx, drone, age, now);
  }
}

function drawDrone(ctx: CanvasRenderingContext2D, drone: Bee, age: number, now: number): void {
  const flight = BEE_FLIGHT[drone.kind];
  const point = beePosition(drone, age);
  const ahead = beePosition(drone, age + 0.05);
  const pitch = Math.max(-0.16, Math.min(0.16, Math.atan2(ahead.yPx - point.yPx, flight.speed * 0.05) * 0.2));
  const rgb = BEE_RGB[drone.kind];
  ctx.save();
  ctx.translate(point.xPx, point.yPx);
  ctx.scale(flight.scale, flight.scale);
  // The parcel remains centred on the actual collectible hit circle.
  ctx.save();
  ctx.rotate(drone.dir * pitch);
  ctx.scale(drone.dir, 1);
  ctx.strokeStyle = '#c9ab79'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-4, -16); ctx.lineTo(-3, -10); ctx.moveTo(4, -16); ctx.lineTo(3, -10); ctx.stroke();
  if (!drawArenaSprite(ctx, 'courier', 0, -29, 82, 32)) {
    const hull = ctx.createLinearGradient(0, -32, 0, -16);
    hull.addColorStop(0, '#f4eee1'); hull.addColorStop(1, '#73818c');
    ctx.fillStyle = hull; ctx.beginPath(); ctx.roundRect(-14, -31, 28, 14, 6); ctx.fill();
    ctx.strokeStyle = '#b9a06c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-27, -25); ctx.lineTo(27, -25); ctx.stroke();
  }
  // Independent rotors animate over the four motor hubs on the rigid hull.
  for (const [x, y] of [[-29, -40], [-26, -29], [29, -34], [26, -24]]) {
    ctx.strokeStyle = 'rgba(223,239,244,0.48)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(x, y, 13.5, 3, 0, 0, Math.PI * 2); ctx.stroke();
    const angle = now * 2.7 + x;
    ctx.strokeStyle = 'rgba(248,240,216,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(angle) * 13, y - Math.sin(angle) * 2.6);
    ctx.lineTo(x + Math.cos(angle) * 10, y + Math.sin(angle) * 2); ctx.stroke();
  }
  ctx.restore();
  if (!drawArenaSprite(ctx, 'parcel', 0, 0, 30, 30)) {
    ctx.fillStyle = '#eee4d0'; ctx.fillRect(-11, -9, 22, 19);
    ctx.fillStyle = '#298d99'; ctx.fillRect(-2, -9, 4, 19);
  }
  ctx.fillStyle = '#102638'; ctx.beginPath(); ctx.roundRect(-5.5, -3.5, 11, 10, 2); ctx.fill();
  ctx.fillStyle = `rgb(${rgb})`; ctx.font = '900 10px system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(GLYPHS[drone.kind], 0, 1.5);
  ctx.font = '700 7px system-ui'; ctx.fillStyle = '#e6e9e8';
  ctx.shadowColor = '#071525'; ctx.shadowBlur = 3;
  ctx.fillText(POWER_LABELS[drone.kind], 0, 23);
  ctx.restore();
}

/** A parcel pickup sends its power spark to the collecting player. */
export function drawDronePops(
  ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number, now: number,
): void {
  for (const pop of gw.bees.pops) {
    const since = now - pop.frame;
    if (!(since >= 0 && since < BEES.popFrames)) continue;
    drawPop(ctx, gw, interp, alpha, pop, since);
  }
}

function drawPop(
  ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number, pop: BeePop, since: number,
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
