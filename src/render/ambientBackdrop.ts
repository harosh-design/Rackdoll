import { PencilGrain } from './pencilGrain';

/** A quiet paper-colored surround for the comic court. */
export class AmbientBackdrop {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly grain = new PencilGrain();
  private grainPixelRatio = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(_stage: DOMRect): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1600 / Math.max(1, rect.width));
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    this.grainPixelRatio = width / Math.max(1, rect.width);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
    }
  }

  draw(seconds: number): void {
    const { width, height } = this.canvas;
    this.ctx.fillStyle = '#191b35';
    this.ctx.fillRect(0, 0, width, height);
    this.grain.draw(this.ctx, width, height, seconds, this.grainPixelRatio);
  }
}
