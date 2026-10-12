import type { PartName } from '../sim/constants';
import { outlinePath } from './dollArt';
import type { SceneryFocus } from './resortBackground';
import { ArenaBackground } from './arenaBackground';
import { loadArenaSprites } from './arenaArt';

/** UV placement comes from the original outlines, not the current doll pose. */
const ATLAS: Record<PartName, { col: number; row: number; x: number; y: number; w: number; h: number }> = {
  Head: { col: 0, row: 0, x: -13.515714, y: -12.915714, w: 26.331429, h: 26.331429 },
  Tors: { col: 1, row: 0, x: -25.268619, y: -27.498619, w: 51.407238, h: 51.407238 },
  Ass: { col: 2, row: 0, x: -15.773762, y: -14.583762, w: 32.097524, h: 32.097524 },
  ArmLeft: { col: 3, row: 0, x: -15.651619, y: -16.591619, w: 33.743238, h: 33.743238 },
  ArmRight: { col: 0, row: 1, x: -16.691619, y: -16.591619, w: 33.743238, h: 33.743238 },
  HandLeft: { col: 1, row: 1, x: -15.531857, y: -14.051857, w: 29.293714, h: 29.293714 },
  HandRight: { col: 2, row: 1, x: -13.361857, y: -14.051857, w: 29.293714, h: 29.293714 },
  FingerLeft: { col: 3, row: 1, x: -11.171429, y: -8.596429, w: 16.822857, h: 16.822857 },
  FingerRight: { col: 0, row: 2, x: -6.201429, y: -8.346429, w: 16.822857, h: 16.822857 },
  LegLeft: { col: 1, row: 2, x: -21.437048, y: -24.087048, w: 42.374095, h: 42.374095 },
  LegRight: { col: 2, row: 2, x: -20.237048, y: -24.087048, w: 42.374095, h: 42.374095 },
  FootLeft: { col: 3, row: 2, x: -19.022476, y: -15.362476, w: 40.764952, h: 40.764952 },
  FootRight: { col: 0, row: 3, x: -20.842476, y: -15.362476, w: 40.764952, h: 40.764952 },
};

let background: ArenaBackground | null = null;
const players: Partial<Record<1 | 2, HTMLCanvasElement>> = {};
let loading: Promise<void> | undefined;

function loadImage(file: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load resort art: ' + file));
    img.src = import.meta.env.BASE_URL + 'art/resort/' + file;
  });
}

/** Remove only the connected neutral backdrop; enclosed white fabric stays intact. */
function prepareAtlas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = frame;
  const seen = new Uint8Array(width * height);
  const queue = new Uint32Array(width * height);
  let count = 0;
  const visit = (p: number) => {
    if (seen[p]) return;
    seen[p] = 1;
    const o = p * 4;
    const low = Math.min(data[o], data[o + 1], data[o + 2]);
    const high = Math.max(data[o], data[o + 1], data[o + 2]);
    if (low > 175 && high - low < 30) queue[count++] = p;
  };
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
  for (let n = 0; n < count; n++) {
    const p = queue[n];
    data[p * 4 + 3] = 0;
    if (p % width > 0) visit(p - 1);
    if (p % width < width - 1) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p < width * (height - 1)) visit(p + width);
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
}

/** Shared across renderers and previews. A failed image retains the existing art. */
export function loadResortArt(): Promise<void> {
  loading ??= Promise.allSettled([
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load future arena'));
      image.src = import.meta.env.BASE_URL + 'art/arena/background.webp';
    }).then(image => { background = new ArenaBackground(image); }),
    loadArenaSprites(),
    loadImage('player-1-moonlit.webp').then(img => { players[1] = prepareAtlas(img); }),
    loadImage('player-2-moonlit.webp').then(img => { players[2] = prepareAtlas(img); }),
  ]).then(() => {});
  return loading;
}

export function hasResortBackground(): boolean { return background !== null; }

/** Draw behind the separately cached court, so scenery never paints over the net. */
export function drawResortBackground(ctx: CanvasRenderingContext2D, width: number, height: number, seconds = 0, focus: SceneryFocus = { x: 0, y: 0 }): boolean {
  if (!background) return false;
  background.draw(ctx, width, height, seconds, focus);
  return true;
}

/** Each textured segment uses its original local frame and silhouette. */
export function drawResortPart(ctx: CanvasRenderingContext2D, name: PartName, id: 1 | 2): boolean {
  const image = players[id];
  if (!image) return false;
  const uv = ATLAS[name];
  const cellW = image.width / 4;
  const cellH = image.height / 4;
  const path = outlinePath(name);
  ctx.save();
  ctx.clip(path);
  // A skin undercoat closes any tiny mismatch between painted texture and mask.
  ctx.fillStyle = id === 1 ? '#cc946c' : '#d79e77';
  ctx.fill(path);
  ctx.drawImage(image, uv.col * cellW, uv.row * cellH, cellW, cellH, uv.x, uv.y, uv.w, uv.h);
  ctx.restore();
  return true;
}
