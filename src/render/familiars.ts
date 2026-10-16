import { BEES } from '../sim/constants';
import { BEE_FLIGHT, beePosition, beeRadiusPx, type BeePop } from '../sim/bees';
import type { GameWorld } from '../sim/world';
import { POWER_LABELS, type PowerId } from '../sim/powerUps';
import type { PoseSource } from './dollPose';
import { drawHorrorBat, drawHorrorProp } from './horrorProps';
import { COMIC, COMIC_TEXT, burstPath } from './comicStyle';

const POWER_INK: Record<PowerId, string> = {
  giant: COMIC.ochre, tiny: COMIC.plum, feather: COMIC.paper, highJump: COMIC.mint,
  speed: COMIC.rust, magnet: COMIC.ochre, shield: COMIC.mint,
};
const GLYPHS: Record<PowerId, string> = {
  giant: '+', tiny: '−', feather: '≈', highJump: '↑', speed: '»', magnet: '∩', shield: '◇',
};

/** Bats carry power seals on the original collectible flight and hit circle. */
export function drawFamiliars(ctx: CanvasRenderingContext2D, gw: GameWorld, now: number, alpha: number): void {
  for (const familiar of gw.bees.bees) {
    const age = familiar.prevAge + (familiar.age - familiar.prevAge) * alpha;
    const flight = BEE_FLIGHT[familiar.kind], point = beePosition(familiar, age);
    ctx.save(); ctx.translate(point.xPx, point.yPx); ctx.scale(flight.scale, flight.scale);
    ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-3, -21); ctx.lineTo(-4, -10); ctx.moveTo(3, -21); ctx.lineTo(4, -10); ctx.stroke();
    ctx.save(); ctx.translate(0, -29); drawHorrorBat(ctx, now / 30); ctx.restore();
    drawHorrorProp(ctx, 'talisman', 0, 0, 32, 34);
    ctx.fillStyle = COMIC.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px ' + COMIC_TEXT; ctx.fillText(GLYPHS[familiar.kind], 0, -3.5);
    ctx.font = 'bold ' + Math.max(7, 7 / flight.scale) + 'px ' + COMIC_TEXT; ctx.lineWidth = 2.4;
    ctx.strokeText(POWER_LABELS[familiar.kind], 0, 24);
    ctx.fillStyle = COMIC.paper; ctx.fillText(POWER_LABELS[familiar.kind], 0, 24);
    ctx.restore();
  }
}

/** An ink burst and traveling seal communicate the unchanged pickup ownership. */
export function drawFamiliarPops(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number, now: number): void {
  for (const pop of gw.bees.pops) {
    const since = now - pop.frame;
    if (since >= 0 && since < BEES.popFrames) drawPop(ctx, gw, interp, alpha, pop, since);
  }
}

function drawPop(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number, pop: BeePop, since: number): void {
  const p = since / BEES.popFrames, radius = beeRadiusPx(pop.kind);
  ctx.save(); ctx.globalAlpha = 1 - p;
  burstPath(ctx, pop.xPx, pop.yPx, radius + 30 * (1 - (1 - p) ** 3));
  ctx.strokeStyle = POWER_INK[pop.kind]; ctx.lineWidth = 2 * (1 - p) + 0.8; ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + 0.4, distance = radius * 0.5 + 34 * (1 - (1 - p) ** 2);
    ctx.save(); ctx.translate(pop.xPx + Math.cos(a) * distance, pop.yPx + Math.sin(a) * distance + 10 * p * p);
    ctx.rotate(a); ctx.fillStyle = i % 2 ? COMIC.ink : COMIC.paper; ctx.fillRect(-1, -2, 2, 5); ctx.restore();
  }
  const travel = Math.min(1, since / 12);
  if (travel < 1) {
    const head = interp.pose((pop.owner === 1 ? gw.p1 : gw.p2).head, alpha);
    const e = travel < 0.5 ? 2 * travel * travel : 1 - (-2 * travel + 2) ** 2 / 2;
    const x = pop.xPx + (head.x - pop.xPx) * e, y = pop.yPx + (head.y - pop.yPx) * e - 40 * Math.sin(travel * Math.PI);
    ctx.globalAlpha = 1; drawHorrorProp(ctx, 'talisman', x, y, 14, 16);
  }
  ctx.restore();
}
