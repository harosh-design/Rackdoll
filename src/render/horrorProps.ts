import type { ExecuterId } from '../sim/executerVariants';

export const HORROR_HAZARD_LABELS: Record<ExecuterId, string> = {
  magnet: 'MAGNET', boxer: 'VOODOO', comet: 'FIRE SKULL', spring: 'BONE TRAP', slime: 'ECTOPLASM',
  chameleon: 'CHAMELEON',
};
export type HorrorProp = 'magnet' | 'voodoo' | 'fire-skull' | 'jaw-base' | 'jaw-cap' | 'ectoplasm' | 'bat' | 'talisman' | 'fist';
const names: readonly HorrorProp[] = ['magnet', 'voodoo', 'fire-skull', 'jaw-base', 'jaw-cap', 'ectoplasm', 'bat', 'talisman', 'fist'];
const sprites = new Map<HorrorProp, HTMLImageElement>();
let reducedMotion: MediaQueryList | undefined;
let loading: Promise<void> | undefined;

export function loadHorrorProps(): Promise<void> {
  loading ??= Promise.all(names.map(name => new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => { sprites.set(name, image); resolve(); };
    image.onerror = () => reject(new Error('Could not load horror prop: ' + name));
    image.src = import.meta.env.BASE_URL + 'art/horror/props/' + name + '.webp';
  }))).then(() => {});
  return loading;
}

/** Transparent art stays centered on the unchanged physical prop or attachment. */
export function drawHorrorProp(ctx: CanvasRenderingContext2D, name: HorrorProp, x: number, y: number, width: number, height: number): boolean {
  const image = sprites.get(name);
  if (!image) return false;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.drawImage(image, x - w / 2, y - h / 2, w, h);
  return true;
}

/** Wing cutouts flap at the shoulders; the bat's face stays rigid. */
export function drawHorrorBat(ctx: CanvasRenderingContext2D, seconds: number): void {
  const image = sprites.get('bat');
  if (!image) return;
  reducedMotion ??= window.matchMedia('(prefers-reduced-motion: reduce)');
  const w = 74, h = w * image.naturalHeight / image.naturalWidth;
  const flap = reducedMotion.matches ? 0 : Math.sin(seconds * 12) * 0.24;
  const draw = () => ctx.drawImage(image, -w / 2, -h / 2, w, h);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 7, 0); ctx.rotate(side * flap); ctx.translate(-side * 7, 0);
    ctx.beginPath(); ctx.rect(side < 0 ? -w : 8, -h, w - 8, h * 2); ctx.clip(); draw(); ctx.restore();
  }
  ctx.save(); ctx.beginPath(); ctx.rect(-8, -h, 16, h * 2); ctx.clip(); draw(); ctx.restore();
}
