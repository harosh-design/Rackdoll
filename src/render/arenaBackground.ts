import { LEFT_WALL_INNER_PX, RIGHT_WALL_INNER_PX, VIEW } from '../sim/constants';
import type { SceneryFocus } from './resortBackground';
import { STAGE } from './stageLayout';

export const ARENA_SCENES = ['indoor', 'beach', 'rooftop'] as const;
export type ArenaScene = typeof ARENA_SCENES[number];
export const SCENE_LABELS: Record<ArenaScene, string> = { indoor: 'Arena', beach: 'Beach', rooftop: 'Rooftop' };

/** A rigid arena plate with separate subtle service lights, never a warped room. */
export class ArenaBackground {
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly image: HTMLImageElement, private readonly scene: ArenaScene = 'indoor') {}

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number, _focus: SceneryFocus): void {
    const unit = width / VIEW.stageW;
    const left = (LEFT_WALL_INNER_PX * VIEW.scale + STAGE.offsetX) * unit;
    const right = (RIGHT_WALL_INNER_PX * VIEW.scale + STAGE.offsetX) * unit;
    const span = right - left;
    const scale = Math.max(span / this.image.naturalWidth, height / this.image.naturalHeight);
    const w = this.image.naturalWidth * scale, h = this.image.naturalHeight * scale;
    ctx.save();
    ctx.beginPath(); ctx.rect(left, 0, span, height); ctx.clip();
    ctx.drawImage(this.image, left + (span - w) / 2, height - h, w, h);
    // A slow floor service scan is independent of all architectural pixels.
    if (this.scene === 'indoor' && !this.reducedMotion.matches) {
      const x = left + ((seconds * 0.035) % 1) * span;
      const scan = ctx.createLinearGradient(x - 32 * unit, 0, x + 32 * unit, 0);
      scan.addColorStop(0, 'rgba(112,229,236,0)');
      scan.addColorStop(0.5, 'rgba(112,229,236,0.09)');
      scan.addColorStop(1, 'rgba(112,229,236,0)');
      ctx.fillStyle = scan;
      ctx.fillRect(x - 32 * unit, height - 5 * unit, 64 * unit, 2 * unit);
    }
    ctx.restore();
  }
}
