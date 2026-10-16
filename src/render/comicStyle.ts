/** Shared ink and spot colors for the court, props, effects and interface. */
export const COMIC = {
  ink: '#11101a', paper: '#ebdcb5', muted: '#bcae95', ochre: '#dab05c',
  mint: '#9fc6ad', plum: '#795086', rust: '#c56a51', night: '#191522',
} as const;
export const COMIC_TITLE = 'Impact, "Arial Narrow", sans-serif';
export const COMIC_TEXT = '"Courier New", monospace';

/** Fixed uneven corners give panels an inked edge without shaking their text. */
export function inkRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cut = 2): void {
  const c = Math.max(0, Math.min(cut, w / 3, h / 3));
  ctx.beginPath(); ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y + 0.25);
  ctx.lineTo(x + w, y + c); ctx.lineTo(x + w - 0.2, y + h - c);
  ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + c, y + h - 0.2);
  ctx.lineTo(x, y + h - c); ctx.lineTo(x + 0.2, y + c); ctx.closePath();
}

export function comicPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string = COMIC.paper): void {
  ctx.save();
  ctx.fillStyle = COMIC.ink; inkRect(ctx, x + 1.5, y + 2, w, h, 3); ctx.fill();
  inkRect(ctx, x, y, w, h, 3); ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.1; ctx.stroke(); ctx.restore();
}

/** Deterministic scratch marks, clipped by the caller when following a contour. */
export function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, step = 5): void {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = 'rgba(17,16,26,0.4)'; ctx.lineWidth = 0.55;
  ctx.beginPath();
  for (let i = -h; i <= w; i += step) { ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); }
  ctx.stroke(); ctx.restore();
}

/** Ragged impact contours replace smooth rings and digital bloom. */
export function burstPath(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, spikes = 12): void {
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = i / (spikes * 2) * Math.PI * 2;
    const r = radius * (i % 2 ? 0.73 : 0.95 + Math.sin(i * 2.39) * 0.05);
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}
