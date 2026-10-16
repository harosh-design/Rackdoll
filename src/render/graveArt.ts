import { COMIC, hatch } from './comicStyle';

export const GRAVE_SKINS = ['rounded', 'skull-seal', 'coffin', 'gothic', 'broken-seal'] as const;
export type GraveSkin = typeof GRAVE_SKINS[number];
export type GraveSkins = Readonly<Record<1 | 2, GraveSkin>>;
export const DEFAULT_GRAVE_SKINS: GraveSkins = Object.freeze({ 1: 'rounded', 2: 'skull-seal' });

interface GraveSprite {
  image: HTMLImageElement;
  active: HTMLCanvasElement;
  flash: HTMLCanvasElement;
}
interface GraveFeedback { active: boolean; life: number; flash: number }
const sprites = new Map<GraveSkin, GraveSprite>();
let loading: Promise<void> | undefined;

/** Cache silhouette-safe feedback layers once, rather than recoloring each frame. */
function feedbackLayer(image: HTMLImageElement, color: string, opacity: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = opacity; ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

export function loadGraveArt(): Promise<void> {
  loading ??= Promise.all(GRAVE_SKINS.map(async skin => {
    try {
      const image = new Image();
      image.src = import.meta.env.BASE_URL + 'art/horror/graves/' + skin + '.webp';
      await image.decode();
      sprites.set(skin, {
        image,
        active: feedbackLayer(image, COMIC.mint, 0.22),
        flash: feedbackLayer(image, COMIC.paper, 1),
      });
    } catch {
      console.warn('Could not load grave art: ' + skin);
    }
  })).then(() => {});
  return loading;
}

/** Different on each wall, with no consecutive repeat on either side. */
export function pickGraveSkins(previous?: GraveSkins): GraveSkins {
  const leftChoices = GRAVE_SKINS.filter(skin => skin !== previous?.[1]);
  const left = leftChoices[Math.floor(Math.random() * leftChoices.length)];
  const rightChoices = GRAVE_SKINS.filter(skin => skin !== left && skin !== previous?.[2]);
  return { 1: left, 2: rightChoices[Math.floor(Math.random() * rightChoices.length)] };
}

/** Centered, bottom-aligned side view; the caller mirrors the right wall inward. */
export function drawGraveArt(ctx: CanvasRenderingContext2D, skin: GraveSkin, height: number, feedback: GraveFeedback): void {
  const sprite = sprites.get(skin);
  const width = height * (sprite ? sprite.image.naturalWidth / sprite.image.naturalHeight : 0.42);
  ctx.save();
  if (sprite) {
    ctx.drawImage(feedback.active ? sprite.active : sprite.image, -width / 2, -height, width, height);
    if (feedback.flash > 0) {
      ctx.save(); ctx.globalAlpha *= feedback.flash;
      ctx.drawImage(sprite.flash, -width / 2, -height, width, height); ctx.restore();
    }
  } else {
    // A narrow slab without a pedestal or cross also serves as the loading fallback.
    ctx.beginPath(); ctx.moveTo(-width / 2, 0); ctx.lineTo(-width / 2, -height * 0.8);
    if (skin === 'coffin') {
      ctx.lineTo(-width * 0.3, -height); ctx.lineTo(width * 0.3, -height);
    } else if (skin === 'gothic' || skin === 'broken-seal') {
      ctx.lineTo(width * 0.1, -height); ctx.lineTo(width / 2, -height * 0.86);
    } else {
      ctx.quadraticCurveTo(-width * 0.2, -height * 1.05, width / 2, -height * 0.9);
    }
    ctx.lineTo(width / 2, 0); ctx.closePath();
    ctx.fillStyle = feedback.flash > 0 ? COMIC.paper : skin === 'coffin' ? COMIC.ochre : COMIC.muted;
    ctx.fill(); ctx.strokeStyle = COMIC.ink; ctx.lineWidth = height * 0.02; ctx.stroke();
    ctx.save(); ctx.clip(); hatch(ctx, -width / 2, -height, width * 0.65, height, height * 0.1); ctx.restore();
    ctx.fillStyle = feedback.active ? COMIC.mint : skin === 'gothic' ? COMIC.mint : COMIC.plum;
    ctx.fillRect(width * 0.1, -height * 0.76, width * 0.28, height * 0.7);
  }
  if (feedback.active && feedback.life > 0) {
    const x = width * 0.25, y = -height * 0.33, w = Math.max(1.4, height * 0.02), h = height * 0.23;
    ctx.fillStyle = COMIC.ink; ctx.fillRect(x, y, w, h);
    const life = Math.min(1, Math.max(0, feedback.life));
    ctx.fillStyle = COMIC.mint; ctx.fillRect(x, y + h * (1 - life), w, h * life);
  }
  ctx.restore();
}
