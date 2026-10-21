import { PencilGrain } from './pencilGrain';

/** Cached etched ironwork fills wide margins without competing with the court. */
export class AmbientBackdrop {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly grain = new PencilGrain();
  private readonly paper = document.createElement('canvas');
  private stage = { left: 0, top: 0, right: 0, bottom: 0 };
  private cssWidth = 1;
  private cssHeight = 1;
  private paperColor = '';
  private grainPixelRatio = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(stage: DOMRect): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1600 / Math.max(1, rect.width));
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    this.grainPixelRatio = width / Math.max(1, rect.width);
    this.cssWidth = Math.max(1, rect.width);
    this.cssHeight = Math.max(1, rect.height);
    this.stage = {
      left: stage.left - rect.left, top: stage.top - rect.top,
      right: rect.right - stage.right, bottom: rect.bottom - stage.bottom,
    };
    this.paperColor = '';
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
    }
  }

  draw(seconds: number, color = '#191b35'): void {
    if (color !== this.paperColor) this.paintPaper(color);
    const { width, height } = this.canvas;
    this.ctx.drawImage(this.paper, 0, 0);
    this.grain.draw(this.ctx, width, height, seconds, this.grainPixelRatio);
  }

  private paintPaper(color: string): void {
    const { paper, cssWidth: width, cssHeight: height, stage } = this;
    paper.width = this.canvas.width; paper.height = this.canvas.height;
    const ctx = paper.getContext('2d')!;
    ctx.scale(paper.width / width, paper.height / height);
    ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
    this.paperColor = color;

    // Keep the compact layout quiet; decoration grows only into spare space.
    if (width < 1000) return;
    const glow = ctx.createRadialGradient(width / 2, height * 0.42, 0, width / 2, height / 2, Math.max(width, height) * 0.65);
    glow.addColorStop(0, '#81979b26'); glow.addColorStop(0.55, '#0e10161a'); glow.addColorStop(1, '#080910b3');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);

    // A fixed, lightly scratched surface sits beneath the animated paper grain.
    ctx.lineWidth = 0.65; ctx.strokeStyle = '#c0b89809'; ctx.beginPath();
    for (let x = -height; x < width; x += 13) {
      ctx.moveTo(x, 0); ctx.lineTo(x + height * 0.65, height);
    }
    ctx.stroke();
    ctx.strokeStyle = '#090a1233'; ctx.beginPath();
    for (let x = 0; x < width + height; x += 29) {
      ctx.moveTo(x, 0); ctx.lineTo(x - height * 0.65, height);
    }
    ctx.stroke();

    // Rotate the same ornament into the available side or letterbox margins.
    const margins = [
      { gap: stage.left, length: height, x: 0, y: 0, angle: 0, mirror: false },
      { gap: stage.right, length: height, x: width, y: 0, angle: 0, mirror: true },
      { gap: stage.top, length: width, x: width, y: 0, angle: Math.PI / 2, mirror: false },
      { gap: stage.bottom, length: width, x: width, y: height, angle: Math.PI / 2, mirror: true },
    ];
    for (const margin of margins) {
      if (margin.gap < 72) continue;
      ctx.save(); ctx.translate(margin.x, margin.y); ctx.rotate(margin.angle);
      if (margin.mirror) ctx.scale(-1, 1);
      ctx.globalAlpha = Math.min(1, (margin.gap - 72) / 90);
      drawIronwork(ctx, margin.gap, margin.length);
      ctx.restore();
    }

    const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.3,
      width / 2, height / 2, Math.hypot(width, height) * 0.5);
    vignette.addColorStop(0, '#08091000'); vignette.addColorStop(1, '#08091099');
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
  }
}

/** Narrow gothic panels, tarnished brass fasteners and fine engraved hatching. */
function drawIronwork(ctx: CanvasRenderingContext2D, gap: number, length: number): void {
  const center = gap / 2;
  const half = Math.min(90, (gap - 48) / 2);
  const top = Math.max(52, length * 0.13), bottom = length - top;
  const arch = Math.min(half * 1.5, (bottom - top) * 0.22);
  const panel = new Path2D();
  panel.moveTo(center - half, bottom);
  panel.lineTo(center - half, top + arch);
  panel.bezierCurveTo(center - half, top + arch * 0.5, center - half * 0.25, top + arch * 0.45, center, top);
  panel.bezierCurveTo(center + half * 0.25, top + arch * 0.45, center + half, top + arch * 0.5, center + half, top + arch);
  panel.lineTo(center + half, bottom); panel.closePath();

  ctx.fillStyle = '#0a0c142b'; ctx.fill(panel);
  ctx.lineWidth = 5; ctx.strokeStyle = '#090b1499'; ctx.stroke(panel);
  ctx.lineWidth = 1; ctx.strokeStyle = '#a7a18b38'; ctx.stroke(panel);
  ctx.save(); ctx.translate(center * 0.05, top * 0.025); ctx.scale(0.95, 0.975);
  ctx.strokeStyle = '#9ca8aa16'; ctx.stroke(panel); ctx.restore();

  // Slim plate seams remain visible even when the arch is close to the stage.
  for (const x of [18, gap - 18]) {
    ctx.fillStyle = '#080a1259'; ctx.fillRect(x - 2, 24, 3, length - 48);
    ctx.fillStyle = '#b7aa8626'; ctx.fillRect(x + 1, 24, 0.8, length - 48);
    for (let y = 38; y < length - 24; y += 92) drawRivet(ctx, x, y, 1.8);
  }

  // Interrupted pencil strokes give the lower panel a hand-etched finish.
  ctx.save(); ctx.clip(panel); ctx.strokeStyle = '#ada78e14'; ctx.lineWidth = 0.7; ctx.beginPath();
  for (let y = top + arch; y < bottom + half * 2; y += 8) {
    ctx.moveTo(center - half, y); ctx.lineTo(center - half + 17, y - 24);
    ctx.moveTo(center + half - 17, y); ctx.lineTo(center + half, y - 24);
  }
  ctx.stroke(); ctx.restore();

  // A small iron diamond and concentric rings echo the court's occult props.
  const sealY = top + (bottom - top) * 0.48;
  const radius = Math.min(half * 0.48, 25);
  ctx.strokeStyle = '#b5a47642'; ctx.lineWidth = 1;
  for (const r of [radius, radius + 5]) {
    ctx.beginPath(); ctx.arc(center, sealY, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = '#0c0e18'; ctx.beginPath();
  ctx.moveTo(center, sealY - radius * 0.65); ctx.lineTo(center + radius * 0.4, sealY);
  ctx.lineTo(center, sealY + radius * 0.65); ctx.lineTo(center - radius * 0.4, sealY);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  for (const direction of [-1, 1]) {
    const y = sealY + direction * (radius + 14);
    ctx.beginPath(); ctx.moveTo(center, y); ctx.lineTo(center, y + direction * Math.min(80, length * 0.1)); ctx.stroke();
    drawRivet(ctx, center, y + direction * (Math.min(80, length * 0.1) + 8), 2);
  }
  drawRivet(ctx, center, top - 14, 2.5);
  drawRivet(ctx, center, bottom - 13, 2.5);
}

function drawRivet(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.fillStyle = '#090b13'; ctx.beginPath(); ctx.arc(x, y + 1, radius + 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#9d896359'; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d8c59445'; ctx.fillRect(x - radius * 0.5, y - radius * 0.5, radius, 0.75);
}
