import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/__workspace__.cjs');
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
try {
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__rv);
  await page.evaluate(() => window.__rv.renderer.ready);
  await page.locator('#play').click();
  await page.waitForTimeout(700);
  await page.keyboard.press('p');
  await page.locator('#pause').evaluate(element => { element.style.visibility = 'hidden'; });
  await page.locator('#game').screenshot({ path: 'output/resort-work/scenery-depth-game.png' });

  const result = await page.evaluate(async () => {
    const { loadResortArt, drawResortBackground, drawResortForeground } = await import('/src/render/resortArt.ts');
    const { resortBackgroundLayout } = await import('/src/render/resortBackground.ts');
    await loadResortArt();
    const c = document.createElement('canvas'); c.width = 640; c.height = 400;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const fit = resortBackgroundLayout(640, 375.44, 1586, 992);
    const region = p => [Math.round(fit.x + p[0] * fit.width), Math.round(fit.imageY + p[1] * fit.imageHeight), Math.round(fit.x + p[2] * fit.width), Math.round(fit.imageY + p[3] * fit.imageHeight)];
    const bg = (t, x = 0) => {
      ctx.clearRect(0, 0, 640, 400);
      drawResortBackground(ctx, 640, 375.44, t, { x, y: 0 });
      return ctx.getImageData(0, 0, 640, 400).data;
    };
    const fg = (t, x = 0) => {
      ctx.clearRect(0, 0, 640, 400);
      drawResortForeground(ctx, 640, 400, t, { x, y: 0 });
      return ctx.getImageData(0, 0, 640, 400).data;
    };
    const diff = (a, b, [x0, y0, x1, y1]) => {
      let changed = 0, magnitude = 0, total = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = (y * 640 + x) * 4;
        const d = Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) + Math.abs(a[o + 3] - b[o + 3]);
        if (d > 3) changed++;
        total++; magnitude += d;
      }
      return { changed, total, meanDifference: magnitude / total };
    };
    const a = bg(0), b = bg(2.1);
    const wind = {
      palms: diff(a, b, region([0.05, 0.04, 0.25, 0.23])),
      water: diff(a, b, region([0.2, 0.53, 0.8, 0.67])),
      plants: diff(a, b, region([0.015, 0.565, 0.11, 0.655])),
      hotel: diff(a, b, region([0.86, 0.295, 0.96, 0.385])),
      moon: diff(a, b, region([0.63, 0.08, 0.7, 0.155])),
      sand: diff(a, b, region([0.3, 0.85, 0.65, 0.97])),
      trunk: diff(a, b, region([0.139, 0.54, 0.143, 0.555])),
    };
    const f0 = fg(0), f1 = fg(2.1), f2 = fg(2.1, 1);
    let leftCoverage = 0, rightCoverage = 0, centerCoverage = 0;
    for (let y = 0; y < 400; y++) for (let x = 0; x < 640; x++) {
      if (!f0[(y * 640 + x) * 4 + 3]) continue;
      if (x < 62) leftCoverage++; else if (x >= 578) rightCoverage++; else centerCoverage++;
    }
    const foreground = {
      leftCoverage, rightCoverage, centerCoverage,
      wind: diff(f0, f1, [0, 288, 640, 400]),
      parallax: diff(f1, f2, [0, 288, 640, 400]),
    };
    // Match image patches at one time under opposing focus positions. The
    // measured translation should be greater near the viewer than at the moon.
    const p0 = bg(0.7, -1), p1 = bg(0.7, 1);
    const shift = ([x0, y0, x1, y1]) => {
      let best = 0, error = Infinity;
      for (let dx = -18; dx <= 18; dx++) {
        let sum = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const o0 = (y * 640 + x) * 4, o1 = (y * 640 + x + dx) * 4;
          for (let k = 0; k < 3; k++) sum += Math.abs(p0[o0 + k] - p1[o1 + k]);
        }
        if (sum < error) { error = sum; best = dx; }
      }
      return best;
    };
    const parallax = {
      moonShiftPx: shift(region([0.64, 0.09, 0.69, 0.15])),
      sandShiftPx: shift(region([0.3, 0.85, 0.65, 0.93])),
      hotelChanges: diff(p0, p1, region([0.86, 0.295, 0.96, 0.385])).changed,
    };
    const start = performance.now();
    for (let i = 0; i < 60; i++) {
      drawResortBackground(ctx, 640, 375.44, i / 30, { x: 0.5, y: 0.2 });
      drawResortForeground(ctx, 640, 400, i / 30, { x: 0.5, y: 0.2 });
    }
    return { wind, foreground, parallax, renderMsPerFrame: (performance.now() - start) / 60 };
  });
  const snapshot = () => page.evaluate(() => ({ seconds: window.__rv.renderer.scenerySeconds, focus: { ...window.__rv.renderer.sceneryFocus }, frame: window.__rv.gw.frame }));
  const pausedBefore = await snapshot();
  await page.waitForTimeout(250);
  const pauseStable = JSON.stringify(pausedBefore) === JSON.stringify(await snapshot());
  await page.setViewportSize({ width: 800, height: 700 });
  await page.waitForTimeout(100);
  await page.locator('#game').screenshot({ path: 'output/resort-work/scenery-depth-small.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMotionStable = await page.evaluate(async () => {
    const { drawResortBackground, drawResortForeground } = await import('/src/render/resortArt.ts');
    const c = document.createElement('canvas'); c.width = 640; c.height = 400;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const draw = (t, x) => {
      ctx.clearRect(0, 0, 640, 400);
      drawResortBackground(ctx, 640, 375.44, t, { x, y: x });
      drawResortForeground(ctx, 640, 400, t, { x, y: x });
      return ctx.getImageData(0, 0, 640, 400).data;
    };
    const a = draw(0, -1), b = draw(3, 1);
    return a.every((value, i) => value === b[i]);
  });
  const report = { ...result, pauseStable, reducedMotionStable, browserErrors: errors };
  fs.writeFileSync('output/resort-work/scenery-depth-audit.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (['palms', 'water', 'plants'].some(key => !result.wind[key].changed) || ['hotel', 'moon', 'sand', 'trunk'].some(key => result.wind[key].changed) || !result.foreground.leftCoverage || !result.foreground.rightCoverage || result.foreground.centerCoverage || !result.foreground.wind.changed || !result.foreground.parallax.changed || Math.abs(result.parallax.sandShiftPx) <= Math.abs(result.parallax.moonShiftPx) || !pauseStable || !reducedMotionStable || errors.length) throw new Error('Scenery depth validation failed');
} finally { await browser.close(); }
