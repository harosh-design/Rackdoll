export const DEFAULT_GRAIN_STRENGTH = 16;

/** Normalize a grain percentage to the supported range. */
export function normalizeGrainStrength(value: number): number {
  return Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : DEFAULT_GRAIN_STRENGTH;
}

/** Animated cached paper noise: two fills, no per-frame readback or new pixels. */
export class PencilGrain {
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly tiles = Array.from({ length: 8 }, (_, index) => makeTile(73 + index * 4093));
  private readonly patterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern[]>();
  private strength = DEFAULT_GRAIN_STRENGTH / 100;

  setStrength(percent: number): void {
    this.strength = normalizeGrainStrength(percent) / 100;
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number, pixelRatio = 1): void {
    if (this.strength === 0) return;
    let patterns = this.patterns.get(ctx);
    if (!patterns) {
      patterns = this.tiles.map(tile => ctx.createPattern(tile, 'repeat')!);
      this.patterns.set(ctx, patterns);
    }
    const frame = this.reducedMotion.matches ? 0 : Math.floor(seconds * 12);
    // Three CSS pixels per noise sample keep the pencil grain coarse at any DPI.
    const scale = 3 * pixelRatio;
    const paperWidth = width / scale, paperHeight = height / scale;
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalCompositeOperation = 'soft-light';
    // Preserve a little fixed paper tooth; most of the effect is moving grain.
    ctx.globalAlpha = 0.1 * this.strength; ctx.fillStyle = patterns[0];
    ctx.fillRect(0, 0, paperWidth, paperHeight);
    const x = (frame * 37) % 256, y = (frame * 61) % 256;
    ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
    ctx.globalAlpha = 0.52 * this.strength; ctx.fillStyle = patterns[frame % 7 + 1];
    ctx.fillRect(x, y, paperWidth, paperHeight);
    ctx.restore();
  }
}

function makeTile(seed: number): HTMLCanvasElement {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 256;
  const ctx = tile.getContext('2d')!;
  const pixels = ctx.createImageData(tile.width, tile.height);
  let state = seed >>> 0;
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const value = 55 + (state >>> 24) * 0.57;
    pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = value;
    pixels.data[offset + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return tile;
}
