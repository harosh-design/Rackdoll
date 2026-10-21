import { gameMap, type GameMapId } from '../sim/maps';
import { drawHorrorBackground } from './horrorArt';
import { COMIC } from './comicStyle';
import { drawSteamPipe, drawStitchedPole } from './mapObstacles';
import { drawInteriorMotion, type InteriorMapId } from './interiorMotion';

const PLATES: Record<InteriorMapId, { file: string; floor: number; wall: string; ground: string }> = {
  crematorium: { file: 'background-crematorium.webp', floor: 0.84, wall: '#526b86', ground: '#805a79' },
  'dead-circus': { file: 'background-dead-circus.webp', floor: 0.84, wall: '#896875', ground: '#613e5a' },
};

/** Fixed seeds keep dust stable across frames, previews, pauses and reloads. */
const MOTES = Array.from({ length: 12 }, (_, i) => ({
  x: ((i * 73 + 19) % 383) / 383,
  y: ((i * 137 + 41) % 379) / 379,
  speed: 0.6 + (i % 5) * 0.16,
  phase: i * 2.39,
}));

export class MapScenery {
  private readonly plates: Partial<Record<InteriorMapId, HTMLImageElement>> = {};

  async load(): Promise<void> {
    const results = await Promise.allSettled(Object.entries(PLATES).map(([id, plate]) => new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => { this.plates[id as InteriorMapId] = image; resolve(); };
      image.onerror = () => reject(new Error('Could not load map art: ' + plate.file));
      image.src = import.meta.env.BASE_URL + 'art/horror/' + plate.file;
    })));
    for (const result of results) if (result.status === 'rejected') console.warn(result.reason);
  }

  /** Interior maps have their own dust and ash instead of outdoor weather. */
  draw(ctx: CanvasRenderingContext2D, id: InteriorMapId, width: number, height: number, floorY: number,
    seconds: number, reducedMotion = false): void {
    const plate = PLATES[id], image = this.plates[id];
    ctx.save();
    if (image) {
      const sourceFloor = image.naturalHeight * plate.floor;
      ctx.drawImage(image, 0, 0, image.naturalWidth, sourceFloor, 0, 0, width, floorY);
      ctx.drawImage(image, 0, sourceFloor, image.naturalWidth, image.naturalHeight - sourceFloor,
        0, floorY, width, height - floorY);
    } else {
      ctx.fillStyle = plate.wall; ctx.fillRect(0, 0, width, floorY);
      ctx.fillStyle = plate.ground; ctx.fillRect(0, floorY, width, height - floorY);
    }
    const time = reducedMotion ? 0 : seconds;
    ctx.beginPath(); ctx.rect(0, 0, width, floorY); ctx.clip();
    if (!image) drawFallbackScenery(ctx, id, width, floorY);
    drawInteriorMotion(ctx, id, width, floorY, time);
    ctx.fillStyle = id === 'crematorium' ? '#e1d8bc' : '#d8b980';
    const count = id === 'crematorium' ? MOTES.length : 8;
    for (let i = 0; i < count; i++) {
      const mote = MOTES[i];
      const x = ((mote.x * width + time * (id === 'crematorium' ? 2.5 : 1.2) + Math.sin(time * 0.25 + mote.phase) * 7) % width + width) % width;
      const y = (mote.y * floorY + time * mote.speed * (id === 'crematorium' ? 4 : 1)) % floorY;
      ctx.globalAlpha = id === 'crematorium' ? 0.1 + (i % 3) * 0.025 : 0.08 + (i % 3) * 0.02;
      ctx.fillRect(x, y, 0.6, 0.5);
    }
    ctx.restore();
  }

  /** Render each card from its actual backdrop, with a miniature map divider. */
  drawPreview(canvas: HTMLCanvasElement, id: GameMapId): void {
    const ctx = canvas.getContext('2d')!, { width, height } = canvas;
    const floorY = height * 0.91;
    if (id === 'graveyard') drawHorrorBackground(ctx, width, height, floorY, 0);
    else this.draw(ctx, id, width, height, floorY, 0, true);
    ctx.save(); ctx.translate(width / 2, floorY); ctx.scale(height / 280, height / 280);
    const map = gameMap(id);
    if (map.obstacle === 'blower') drawSteamPipe(ctx, 0, -149, 0, 0.6);
    else if (map.obstacle === 'rubber') {
      drawStitchedPole(ctx, Array.from({ length: 7 }, (_, i) => ({ x: Math.sin(i / 6 * Math.PI) * 13, y: -149 * i / 6 })));
    } else {
      ctx.fillStyle = COMIC.paper; ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(0, -161); ctx.lineTo(5, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
}

/** Keep the court readable while a background plate is still loading. */
function drawFallbackScenery(ctx: CanvasRenderingContext2D, id: InteriorMapId, width: number, floorY: number): void {
  const scale = width / 640, floor = floorY / scale;
  ctx.save(); ctx.scale(scale, scale);
  ctx.fillStyle = '#11101a';
  ctx.beginPath(); ctx.moveTo(0, floor);
  for (let x = 0; x <= 640; x += 4) {
    const edge = Math.abs(x - 320) / 320;
    const rise = 14 + 38 * edge ** 4 + Math.sin(x * 0.045) * 2.5 + Math.sin(x * 0.29) * 0.7;
    ctx.lineTo(x, floor - rise);
  }
  ctx.lineTo(640, floor); ctx.closePath(); ctx.fill();
  if (id === 'crematorium') drawFallbackFurnaces(ctx, floor);
  ctx.restore();
}

function drawFallbackFurnaces(ctx: CanvasRenderingContext2D, floor: number): void {
  for (const side of [0, 1]) {
    ctx.save(); ctx.translate(side * 640, 0); ctx.scale(side ? -1 : 1, 1);
    ctx.strokeStyle = '#11101a'; ctx.lineWidth = 7; ctx.lineJoin = 'round';
    const elbow = side ? 53 : 79;
    ctx.beginPath(); ctx.moveTo(36, -5); ctx.lineTo(36, elbow); ctx.lineTo(81, elbow); ctx.lineTo(81, elbow + 22); ctx.stroke();
    ctx.fillStyle = '#11101a'; ctx.fillRect(77, elbow + 16, 8, 4);
    ctx.fillRect(59, floor - 111, 10, 45); ctx.fillRect(56, floor - 113, 16, 4);
    ctx.beginPath(); ctx.moveTo(36, floor); ctx.lineTo(36, floor - 45);
    ctx.bezierCurveTo(36, floor - 80, 93, floor - 80, 93, floor - 45);
    ctx.lineTo(93, floor); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#725447';
    ctx.beginPath(); ctx.moveTo(55, floor - 23); ctx.lineTo(55, floor - 36);
    ctx.quadraticCurveTo(64, floor - 52, 73, floor - 36);
    ctx.lineTo(73, floor - 23); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
