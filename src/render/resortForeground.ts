import { resortWind, type SceneryFocus } from './resortBackground';

/** Transparent plant cutouts are anchored below the frame, clear of center play. */
export class ResortForeground {
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly image: HTMLImageElement) {}

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number, focus: SceneryFocus): void {
    const unit = width / 640;
    const enabled = !this.reducedMotion.matches;
    const t = enabled ? seconds : 0;
    const px = enabled ? focus.x : 0;
    const py = enabled ? focus.y : 0;
    const cellWidth = this.image.naturalWidth / 2;
    const aspect = cellWidth / this.image.naturalHeight;
    ctx.save();
    // Even the largest sway never covers the central floor line or net.
    ctx.beginPath();
    ctx.rect(0, height - 112 * unit, 62 * unit, 112 * unit);
    ctx.rect(width - 62 * unit, height - 112 * unit, 62 * unit, 112 * unit);
    ctx.clip();
    for (const near of [false, true]) {
      const plantHeight = (near ? 106 : 76) * unit;
      const plantWidth = plantHeight * aspect;
      const depth = near ? 1 : 0.55;
      for (const side of [0, 1]) {
        const direction = side === 0 ? 1 : -1;
        const anchor = side === 0 ? (near ? 4 : 10) * unit : width - (near ? 4 : 10) * unit;
        const wind = enabled ? resortWind(t, side) * (0.85 + depth * 0.15) : 0;
        ctx.save();
        ctx.globalAlpha = near ? 0.98 : 0.72;
        ctx.translate(anchor - px * 14 * depth * unit, height + (near ? 21 : 16) * unit - py * 5 * depth * unit);
        // Shear leaf tips around the rooted base rather than sliding the plant.
        ctx.transform(1, 0, wind * 0.055 * direction, 1, 0, 0);
        const root = side === 0 ? 0.32 : 0.7;
        ctx.drawImage(this.image, side * cellWidth, 0, cellWidth, this.image.naturalHeight,
          -plantWidth * root, -plantHeight, plantWidth, plantHeight);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}
