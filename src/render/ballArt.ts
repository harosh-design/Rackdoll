import { COMIC, hatch } from './comicStyle';

export const BALL_SKINS = ['stitched', 'moon', 'eye'] as const;
export type BallSkin = typeof BALL_SKINS[number];

const sprites = new Map<BallSkin, HTMLImageElement>();
let loading: Promise<void> | undefined;

export function loadBallArt(): Promise<void> {
  loading ??= Promise.all(BALL_SKINS.map(async skin => {
    try {
      const image = new Image();
      image.src = import.meta.env.BASE_URL + 'art/horror/balls/' + skin + '.webp';
      await image.decode();
      sprites.set(skin, image);
    } catch {
      console.warn('Could not load ball art: ' + skin);
    }
  })).then(() => {});
  return loading;
}

/** Select once at match start, with no consecutive repeats. */
export function pickBallSkin(previous?: BallSkin): BallSkin {
  const choices = BALL_SKINS.filter(skin => skin !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}

/** The sprite rotates in the ball's local frame and shares its collision radius. */
export function drawBallArt(ctx: CanvasRenderingContext2D, skin: BallSkin, radius: number): void {
  const image = sprites.get(skin);
  if (image) {
    ctx.drawImage(image, -radius, -radius, radius * 2, radius * 2);
    return;
  }
  // Keep the selected design readable while loading, or if an asset is unavailable.
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = skin === 'stitched' ? COMIC.ochre : COMIC.paper;
  ctx.fill(); ctx.clip();
  ctx.lineWidth = radius * 0.055; ctx.strokeStyle = COMIC.ink;
  if (skin === 'stitched') {
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.bezierCurveTo(radius * 0.4, -radius * 0.5, radius, -radius * 0.5, radius, 0);
      ctx.lineTo(0, radius); ctx.closePath();
      ctx.fillStyle = COMIC.plum; ctx.fill(); ctx.stroke();
      ctx.strokeStyle = COMIC.paper;
      for (let j = 1; j <= 3; j++) {
        const x = radius * j / 4;
        ctx.beginPath(); ctx.moveTo(x - radius * 0.06, -radius * 0.12);
        ctx.lineTo(x + radius * 0.06, radius * 0.12); ctx.stroke();
      }
      ctx.restore();
    }
  } else if (skin === 'moon') {
    ctx.fillStyle = COMIC.ink;
    for (const [x, y, size] of [[0.28, -0.32, 0.2], [0.47, 0.12, 0.23], [-0.35, 0.33, 0.24], [-0.3, -0.45, 0.1], [-0.6, 0, 0.07]]) {
      ctx.beginPath(); ctx.ellipse(x * radius, y * radius, size * radius, size * radius * 0.8, 0.4, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    ctx.strokeStyle = COMIC.plum;
    for (let i = 0; i < 5; i++) {
      ctx.save(); ctx.rotate(i * Math.PI * 0.4);
      ctx.beginPath(); ctx.moveTo(-radius, 0); ctx.lineTo(-radius * 0.7, radius * 0.1);
      ctx.lineTo(-radius * 0.5, -radius * 0.1); ctx.stroke(); ctx.restore();
    }
    ctx.fillStyle = COMIC.mint; ctx.strokeStyle = COMIC.ink;
    ctx.beginPath(); ctx.arc(radius * 0.15, 0, radius * 0.59, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = COMIC.ink;
    ctx.beginPath(); ctx.arc(radius * 0.15, 0, radius * 0.31, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COMIC.paper;
    ctx.beginPath(); ctx.arc(0, -radius * 0.2, radius * 0.09, 0, Math.PI * 2); ctx.fill();
  }
  hatch(ctx, -radius, radius * 0.3, radius * 2, radius, radius * 0.25);
  ctx.restore();
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.strokeStyle = COMIC.ink; ctx.lineWidth = radius * 0.085; ctx.stroke();
}
