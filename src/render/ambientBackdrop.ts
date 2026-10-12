import { ShaderScene } from './shaderScene';

/** Extend the court's procedural coordinates across the surrounding viewport. */
export class AmbientBackdrop {
  private readonly shaders = new ShaderScene();
  private readonly ctx: CanvasRenderingContext2D;
  private map = [0, 0, 1, 1];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(stage: DOMRect): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1600 / Math.max(1, rect.width));
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
    }
    this.map = [(rect.x - stage.x) / Math.max(1, stage.width), (rect.y - stage.y) / Math.max(1, stage.height),
      rect.width / Math.max(1, stage.width), rect.height / Math.max(1, stage.height)];
  }

  draw(seconds: number, floor: number): void {
    this.shaders.drawBackground(this.ctx, seconds, floor, this.map);
  }

  /** Soft arena lighting fills the viewport around the restored people scene. */
  drawPeople(): void {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.fillStyle = '#0b1423';
    ctx.fillRect(0, 0, width, height);
    for (const x of [0.12, 0.88]) {
      const glow = ctx.createRadialGradient(width * x, height * 0.6, 0, width * x, height * 0.6, width * 0.48);
      glow.addColorStop(0, 'rgba(147,115,64,0.22)');
      glow.addColorStop(1, 'rgba(147,115,64,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }
  }
}
