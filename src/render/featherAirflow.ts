import {
  FLOOR_TOP_PX, FPS, LANDING_CENTRE_M, LEFT_WALL_INNER_PX, RIGHT_WALL_INNER_PX, toPx,
} from '../sim/constants';
import type { GameWorld } from '../sim/world';
import { COMIC } from './comicStyle';

/** Quiet rising pencil strokes mark each feather holder's low-gravity half. */
export function drawFeatherAirflow(ctx: CanvasRenderingContext2D, gw: GameWorld, now: number): void {
  const center = toPx(LANDING_CENTRE_M);
  const top = -160;
  const height = FLOOR_TOP_PX - top;
  for (const player of [gw.p1, gw.p2]) {
    const power = gw.powerUps.active[player.id];
    if (player.power !== 'feather' || power?.kind !== 'feather') continue;
    const age = now - power.startedAt;
    const remaining = power.expiresAt - now;
    if (age < 0 || remaining <= 0) continue;
    const strength = Math.min(1, age / (FPS * 0.5), remaining / (FPS * 0.6));
    const seconds = age / FPS;
    const left = player.id === 1 ? LEFT_WALL_INNER_PX : center;
    const right = player.id === 1 ? center : RIGHT_WALL_INNER_PX;

    ctx.save();
    ctx.beginPath(); ctx.rect(left, top, right - left, height); ctx.clip();
    ctx.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const phase = (seconds * (0.13 + (i % 4) * 0.012) + i * 0.618) % 1;
      const x = left + 24 + (right - left - 48) * (i + 0.5) / 12
        + Math.sin(seconds * 0.75 + i * 2.1) * 7;
      const y = FLOOR_TOP_PX - phase * height;
      const length = 34 + (i % 4) * 9;
      const curl = Math.sin(seconds * 0.65 + i * 1.7) * 7;
      const opacity = strength * Math.sin(phase * Math.PI);

      ctx.globalAlpha = opacity * 0.3;
      ctx.strokeStyle = COMIC.paper;
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - 7, y - length * 0.35, x + 9, y - length * 0.7, x + curl, y - length);
      ctx.stroke();

      ctx.globalAlpha = opacity * 0.16;
      ctx.strokeStyle = COMIC.mint;
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(x + 7, y + 8);
      ctx.bezierCurveTo(x + 3, y - length * 0.1, x + 14, y - length * 0.3, x + 10, y - length * 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }
}
