import fs from 'node:fs';
const layout=JSON.parse(fs.readFileSync('output/resort-work/atlas-layout.json','utf8'));
const entries=Object.entries(layout).map(([k,v])=>`  ${k}: { col: ${v.col}, row: ${v.row}, x: ${v.x.toFixed(6)}, y: ${v.y.toFixed(6)}, w: ${v.w.toFixed(6)}, h: ${v.h.toFixed(6)} },`).join('\n');
const code=`import type { PartName } from '../sim/constants';
import { outlinePath } from './dollArt';

/** UV placement comes from the original outlines, not the current doll pose. */
const ATLAS: Record<PartName, { col: number; row: number; x: number; y: number; w: number; h: number }> = {
${entries}
};

let background: HTMLImageElement | null = null;
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
    loadImage('background.webp').then(img => { background = img; }),
    loadImage('player-1.webp').then(img => { players[1] = prepareAtlas(img); }),
    loadImage('player-2.webp').then(img => { players[2] = prepareAtlas(img); }),
  ]).then(() => {});
  return loading;
}

/** Align the photographed sand to the unchanged physical ground at every size. */
export function drawResortBackground(ctx: CanvasRenderingContext2D, width: number, height: number, groundY: number): boolean {
  if (!background) return false;
  const shoreY = background.naturalHeight * 0.94;
  ctx.drawImage(background, 0, 0, background.naturalWidth, shoreY, 0, 0, width, groundY);
  ctx.drawImage(background, 0, shoreY, background.naturalWidth, background.naturalHeight - shoreY,
    0, groundY, width, height - groundY);
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
`;
fs.writeFileSync('src/render/resortArt.ts',code);
let renderer=fs.readFileSync('src/render/renderer.ts','utf8');
renderer=renderer.replace("import type { Interpolator, Pose } from './interp';", "import type { Interpolator, Pose } from './interp';\nimport { drawResortBackground, drawResortPart, loadResortArt } from './resortArt';");
renderer=renderer.replace('  private k = 1;', '  private k = 1;\n  readonly ready: Promise<void>;');
renderer=renderer.replace('    this.resize();\n  }', '    this.resize();\n    this.ready = loadResortArt().then(() => this.paintBackground());\n  }');
const start=renderer.indexOf('    const sky = ctx.createLinearGradient');
const end=renderer.indexOf('    // Walls.',start);
const fallback=renderer.slice(start,end).trimEnd();
renderer=renderer.slice(0,start)+`    const sandY = VIEW.offsetY + SAND_TOP_PX * VIEW.scale;\n    if (!drawResortBackground(ctx, W, H, sandY)) {\n`+fallback.split('\n').map(l=>'  '+l).join('\n')+`\n    }\n    this.worldSpace(ctx);\n\n`+renderer.slice(end);
renderer=renderer.replace('    const path = outlinePath(name);\n    const jersey', '    if (drawResortPart(ctx, name, id)) return;\n    const path = outlinePath(name);\n    const jersey');
fs.writeFileSync('src/render/renderer.ts',renderer);
