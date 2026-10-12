/** Pre-rendered service equipment; mechanisms are animated separately by Canvas. */
export type ArenaSprite = 'courier' | 'parcel' | 'magnet' | 'boxer' | 'porter' | 'spring-base' | 'spring-cap' | 'spa';

const sprites = new Map<ArenaSprite, HTMLImageElement>();
const names: readonly ArenaSprite[] = ['courier', 'parcel', 'magnet', 'boxer', 'porter', 'spring-base', 'spring-cap', 'spa'];
let loading: Promise<void> | undefined;

export function loadArenaSprites(): Promise<void> {
  loading ??= Promise.allSettled(names.map(name => new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => { sprites.set(name, image); resolve(); };
    image.onerror = () => reject(new Error('Could not load arena sprite: ' + name));
    image.src = import.meta.env.BASE_URL + 'art/arena/' + name + '.webp';
  }))).then(() => {});
  return loading;
}

/** Keep the source aspect ratio; x/y is the centre of the requested sprite box. */
export function drawArenaSprite(ctx: CanvasRenderingContext2D, name: ArenaSprite, x: number, y: number, width: number, height: number): boolean {
  const image = sprites.get(name);
  if (!image) return false;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.drawImage(image, x - w / 2, y - h / 2, w, h);
  return true;
}
