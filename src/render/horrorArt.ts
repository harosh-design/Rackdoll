import type { PartName } from '../sim/constants';
import type { Player } from '../sim/player';
import { DRAW_ORDER, outlinePath } from './dollArt';
import type { PoseSource } from './dollPose';
import { HorrorBackground } from './horrorBackground';
import layouts from './horrorAtlas.json';
import { loadHorrorProps } from './horrorProps';
import { drawLigaments } from './ligamentArt';
import type { WeatherEffects } from './weather';

const players: Partial<Record<1 | 2, HTMLImageElement>> = {};
let background: HorrorBackground | undefined;
let loading: Promise<void> | undefined;

function loadImage(file: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load horror art: ' + file));
    image.src = import.meta.env.BASE_URL + 'art/horror/' + file;
  });
}

/** Prepare new art once; the previous player/background variants are not loaded. */
export function loadHorrorArt(): Promise<void> {
  loading ??= Promise.allSettled([
    loadImage('background-moonlit.webp').then(plate => { background = new HorrorBackground(plate); }),
    loadImage('masked.webp').then(image => { players[1] = image; }),
    loadImage('skeleton.webp').then(image => { players[2] = image; }),
    loadHorrorProps(),
  ]).then(results => {
    for (const result of results) if (result.status === 'rejected') console.warn(result.reason);
  });
  return loading;
}

export function drawHorrorBackground(ctx: CanvasRenderingContext2D, width: number, height: number, floorY: number, seconds: number,
  weather?: WeatherEffects, weatherSeconds = seconds, reducedMotion = false): void {
  if (background) background.draw(ctx, width, height, floorY, seconds, weather, weatherSeconds, reducedMotion);
  else {
    ctx.fillStyle = '#4c66a2'; ctx.fillRect(0, 0, width, floorY);
    ctx.fillStyle = '#75567b'; ctx.fillRect(0, floorY, width, height - floorY);
    weather?.drawSky(ctx, width, height, floorY, weatherSeconds, reducedMotion);
  }
}

/** Cutouts follow existing joint pivots, size powers and detached-part poses. */
export function drawHorrorPlayers(ctx: CanvasRenderingContext2D, dolls: readonly Player[], poses: PoseSource, alpha: number): void {
  for (const player of dolls) {
    drawLigaments(ctx, player, poses, alpha);
    for (const name of DRAW_ORDER) {
      const pose = poses.pose(player.part(name), alpha);
      ctx.save();
      ctx.translate(pose.x, pose.y); ctx.rotate(pose.a);
      const scale = player.partScale(name); ctx.scale(scale, scale);
      drawPart(ctx, name, player.id);
      ctx.restore();
    }
  }
}

function drawPart(ctx: CanvasRenderingContext2D, name: PartName, id: 1 | 2): void {
  const image = players[id];
  if (!image) {
    const path = outlinePath(name);
    ctx.fillStyle = id === 1 ? '#c9a053' : '#ecdbac';
    ctx.fill(path); ctx.strokeStyle = '#111019'; ctx.lineWidth = 1.4; ctx.stroke(path);
    return;
  }
  const uv = layouts[id === 1 ? 'masked' : 'skeleton'][name];
  const cellW = image.naturalWidth / 4, cellH = image.naturalHeight / 4;
  // Preserve hat brims and transparent rib gaps; no human silhouette/undercoat.
  ctx.drawImage(image, uv.col * cellW, uv.row * cellH, cellW, cellH, uv.x, uv.y, uv.w, uv.h);
  if (id === 1 && (name === 'ArmLeft' || name === 'ArmRight')) {
    // The atlas has an open sleeve mouth at the elbow. Cover it with cloth
    // sampled farther up that same sleeve, so the forearm rotates under a
    // rounded fabric end instead of appearing to hang off a black cut edge.
    const side = name === 'ArmLeft' ? -1 : 1;
    const x = side * 9;
    const y = 0.3;
    const radius = 3.3;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(image, uv.col * cellW, uv.row * cellH, cellW, cellH,
      uv.x + side * 4, uv.y, uv.w, uv.h);
    ctx.restore();
  }
}
