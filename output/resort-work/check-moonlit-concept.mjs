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
  await page.locator('#game').screenshot({ path: 'output/resort-work/moonlit-concept-game.png' });

  const result = await page.evaluate(async () => {
    const { loadResortArt, drawResortBackground } = await import('/src/render/resortArt.ts');
    const { resortBackgroundLayout, ResortBackground } = await import('/src/render/resortBackground.ts');
    const { FLOOR_TOP_PX, LEFT_WALL_INNER_PX, RIGHT_WALL_INNER_PX, VIEW } = await import('/src/sim/constants.ts');
    await loadResortArt();
    const image = new Image();
    image.src = '/art/resort/background-moonlit.webp';
    await image.decode();
    const height = (FLOOR_TOP_PX - 6) * VIEW.scale + VIEW.offsetY;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 400;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const fit = resortBackgroundLayout(640, height, image.naturalWidth, image.naturalHeight);
    drawResortBackground(ctx, 640, height, 0);
    const before = ctx.getImageData(0, 0, 640, 400).data;
    drawResortBackground(ctx, 640, height, 2.1);
    const after = ctx.getImageData(0, 0, 640, 400).data;
    const diff = ([x0, y0, x1, y1]) => {
      let changed = 0, magnitude = 0, total = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = (y * 640 + x) * 4;
        const d = Math.abs(before[o] - after[o]) + Math.abs(before[o + 1] - after[o + 1]) + Math.abs(before[o + 2] - after[o + 2]);
        if (d > 3) changed++;
        magnitude += d;
        total++;
      }
      return { changed, total, meanDifference: magnitude / total };
    };
    const region = p => [Math.round(fit.x + p[0] * fit.width), Math.round(fit.imageY + p[1] * fit.imageHeight), Math.round(fit.x + p[2] * fit.width), Math.round(fit.imageY + p[3] * fit.imageHeight)];
    const pixelDiff = {
      palms: diff(region([0.05, 0.04, 0.25, 0.23])),
      water: diff(region([0.2, 0.53, 0.8, 0.67])),
      plants: diff(region([0.015, 0.565, 0.11, 0.655])),
      hotel: diff(region([0.86, 0.295, 0.96, 0.385])),
      moon: diff(region([0.63, 0.08, 0.7, 0.155])),
      sand: diff(region([0.3, 0.85, 0.65, 0.97])),
    };
    const start = performance.now();
    for (let i = 0; i < 60; i++) drawResortBackground(ctx, 640, height, i / 30);
    const renderMsPerFrame = (performance.now() - start) / 60;
    const layouts = [[640, height], [1280, height * 2], [320, height / 2], [640, height + 260]].map(([w, h]) => {
      const layout = resortBackgroundLayout(w, h, image.naturalWidth, image.naturalHeight);
      return { w, h, ...layout, contained: layout.imageY >= 0 && layout.imageY + layout.imageHeight <= h + 1e-6 && layout.x >= Math.max(0, (LEFT_WALL_INNER_PX * VIEW.scale + VIEW.offsetX) * w / 640) - 1e-6 && layout.x + layout.width <= (RIGHT_WALL_INNER_PX * VIEW.scale + VIEW.offsetX) * w / 640 + 1e-6 };
    });

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    let fallback;
    try {
      HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === 'webgl' ? null : originalGetContext.call(this, type, ...args); };
      fallback = new ResortBackground(image);
    } finally { HTMLCanvasElement.prototype.getContext = originalGetContext; }
    const fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.width = 640; fallbackCanvas.height = 400;
    const fallbackCtx = fallbackCanvas.getContext('2d');
    fallback.draw(fallbackCtx, 640, height, 1);
    const fallbackPixel = [...fallbackCtx.getImageData(320, 200, 1, 1).data];
    const loadedArt = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.includes('/art/resort/'));
    return { fit, pixelDiff, layouts, renderMsPerFrame, loadedArt, fallbackHasImage: fallbackPixel[3] === 255 && fallbackPixel[2] > 10, floorStageY: FLOOR_TOP_PX * VIEW.scale + VIEW.offsetY, netStageHeight: 150 * VIEW.scale };
  });

  const pausedBefore = await page.evaluate(() => ({ seconds: window.__rv.renderer.scenerySeconds, frame: window.__rv.gw.frame }));
  await page.waitForTimeout(250);
  const pausedAfter = await page.evaluate(() => ({ seconds: window.__rv.renderer.scenerySeconds, frame: window.__rv.gw.frame }));
  const pauseStable = pausedBefore.seconds === pausedAfter.seconds && pausedBefore.frame === pausedAfter.frame;
  await page.setViewportSize({ width: 800, height: 700 });
  await page.waitForTimeout(100);
  await page.locator('#game').screenshot({ path: 'output/resort-work/moonlit-concept-small.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMotionStable = await page.evaluate(async () => {
    const { drawResortBackground } = await import('/src/render/resortArt.ts');
    const c = document.createElement('canvas'); c.width = 640; c.height = 400;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 640, 400);
    drawResortBackground(ctx, 640, 375.44, 0); const a = ctx.getImageData(0, 0, 640, 400).data;
    ctx.clearRect(0, 0, 640, 400);
    drawResortBackground(ctx, 640, 375.44, 3); const b = ctx.getImageData(0, 0, 640, 400).data;
    return a.every((v, i) => v === b[i]);
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('p');
  const keys = await page.evaluate(() => window.__rv.settings.bindings[1]);
  await page.keyboard.down(keys.jump);
  await page.waitForTimeout(220);
  await page.keyboard.press(keys.serve, { delay: 80 });
  await page.waitForTimeout(150);
  await page.keyboard.up(keys.jump);
  await page.locator('#game').screenshot({ path: 'output/resort-work/moonlit-concept-jump.png' });
  const gameplay = await page.evaluate(previousSeconds => {
    const { gw, renderer } = window.__rv;
    return {
      sceneryResumed: renderer.scenerySeconds > previousSeconds,
      ballReleased: !gw.ball.held,
      normalPlayerSizes: gw.p1.sizeScale === 1 && gw.p2.sizeScale === 1,
      finiteBodies: [...gw.p1.bodies, ...gw.p2.bodies, gw.ball.body].every(body => {
        const position = body.getPosition();
        return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(body.getAngle());
      }),
    };
  }, pausedAfter.seconds);
  const report = { ...result, pauseStable, reducedMotionStable, gameplay, browserErrors: errors };
  fs.writeFileSync('output/resort-work/moonlit-concept-audit.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (result.layouts.some(layout => !layout.contained) || ['palms', 'water', 'plants'].some(key => !result.pixelDiff[key].changed) || ['hotel', 'moon', 'sand'].some(key => result.pixelDiff[key].changed) || !result.fallbackHasImage || !pauseStable || !reducedMotionStable || Object.values(gameplay).some(value => !value) || errors.length) throw new Error('Moonlit concept validation failed');
} finally { await browser.close(); }
