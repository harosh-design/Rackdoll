import type { PartName } from '../sim/constants';
import type { Player } from '../sim/player';
import { DRAW_ORDER, outlinePath } from './dollArt';
import type { PoseSource } from './dollPose';
import { HorrorBackground } from './horrorBackground';
import layouts from './horrorAtlas.json';
import { loadHorrorProps } from './horrorProps';
import { drawLigaments } from './ligamentArt';
import type { WeatherEffects } from './weather';
import { maskedPartMatrix, MASKED_TORSO_BANDS } from './maskedRig';

const players: Partial<Record<1 | 2, HTMLImageElement>> = {};
// The trouser hips sit behind the rounded thigh roots; the coat tails are
// composited over them separately so no short, horizontal cuff crosses a leg.
const MASKED_DRAW_ORDER: readonly PartName[] = [
  'HandLeft', 'HandRight', 'ArmLeft', 'ArmRight', 'Tors', 'Head',
  'FingerLeft', 'FingerRight', 'FootLeft', 'FootRight', 'Ass', 'LegLeft', 'LegRight',
];
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
    for (const name of player.id === 1 ? MASKED_DRAW_ORDER : DRAW_ORDER) {
      const pose = poses.pose(player.part(name), alpha);
      ctx.save();
      ctx.translate(pose.x, pose.y); ctx.rotate(pose.a);
      const scale = player.partScale(name); ctx.scale(scale, scale);
      drawPart(ctx, name, player.id);
      ctx.restore();
    }
    if (player.id === 1 && players[1]) {
      const pose = poses.pose(player.part('Ass'), alpha);
      ctx.save(); ctx.translate(pose.x, pose.y); ctx.rotate(pose.a);
      const scale = player.partScale('Ass'); ctx.scale(scale, scale);
      // The belt stays above the thigh roots. Both it and the coat tails
      // use the same registered pelvis transform as the trouser hips.
      const uv = layouts.masked.Ass;
      ctx.transform(...maskedPartMatrix('Ass'));
      ctx.beginPath();
      ctx.rect(0, 0, 256, 72);
      ctx.moveTo(0, 0); ctx.lineTo(80, 0); ctx.lineTo(70, 65);
      ctx.lineTo(62, 112); ctx.lineTo(70, 168); ctx.lineTo(78, 256);
      ctx.lineTo(0, 256); ctx.closePath();
      ctx.moveTo(176, 0); ctx.lineTo(256, 0); ctx.lineTo(256, 256);
      ctx.lineTo(178, 256); ctx.lineTo(186, 168); ctx.lineTo(188, 112);
      ctx.lineTo(182, 65); ctx.closePath(); ctx.clip();
      const image = players[1];
      ctx.drawImage(image, uv.col * image.naturalWidth / 4, uv.row * image.naturalHeight / 4,
        image.naturalWidth / 4, image.naturalHeight / 4, 0, 0, 256, 256);
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
  if (id === 1) {
    if (name === 'Tors') {
      // Tuck the vest and coat front under the waistband; the long tails
      // belong to the pelvis pass rather than to this torso's pointed hem.
      ctx.save(); ctx.beginPath();
      ctx.moveTo(-100, -100); ctx.lineTo(100, -100); ctx.lineTo(100, 8);
      ctx.lineTo(9, 12); ctx.lineTo(8.5, 18); ctx.lineTo(-8.5, 18);
      ctx.lineTo(-9, 12); ctx.lineTo(-100, 8); ctx.closePath(); ctx.clip();
      for (const { from, to, matrix } of MASKED_TORSO_BANDS) {
        ctx.save(); ctx.transform(...matrix);
        ctx.drawImage(image, uv.col * cellW, uv.row * cellH + from * cellH / 256,
          cellW, (to - from) * cellH / 256, 0, from, 256, to - from);
        ctx.restore();
      }
      ctx.restore();
    } else {
      ctx.save(); ctx.transform(...maskedPartMatrix(name));
      ctx.drawImage(image, uv.col * cellW, uv.row * cellH, cellW, cellH, 0, 0, 256, 256);
      ctx.restore();
    }
    return;
  }
  // Preserve hat brims and transparent rib gaps; no human silhouette/undercoat.
  ctx.drawImage(image, uv.col * cellW, uv.row * cellH, cellW, cellH, uv.x, uv.y, uv.w, uv.h);
}
