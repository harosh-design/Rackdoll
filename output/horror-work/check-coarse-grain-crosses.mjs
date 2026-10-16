import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = require('playwright');
const sharp = require('sharp');
const baseline = process.argv.includes('--baseline');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__rv);
  await page.evaluate(() => window.__rv.renderer.ready);
  const capture = await page.evaluate(async () => {
    const { drawHorrorBackground, loadHorrorArt } = await import('/src/render/horrorArt.ts');
    const { PencilGrain } = await import('/src/render/pencilGrain.ts');
    await loadHorrorArt();
    const background = document.createElement('canvas'); background.width = 1280; background.height = 800;
    const ctx = background.getContext('2d'); ctx.scale(2, 2);
    drawHorrorBackground(ctx, 640, 400, 385, 0);
    const samples = [1, 2].map(dpr => {
      const canvas = document.createElement('canvas'); canvas.width = 512 * dpr; canvas.height = 256 * dpr;
      const context = canvas.getContext('2d'); context.fillStyle = '#71809e'; context.fillRect(0, 0, canvas.width, canvas.height);
      const grain = new PencilGrain(); grain.setStrength(100); grain.draw(context, canvas.width, canvas.height, 0, dpr);
      const css = document.createElement('canvas'); css.width = 512; css.height = 256;
      const pixels = css.getContext('2d', { willReadFrequently: true }); pixels.drawImage(canvas, 0, 0, css.width, css.height);
      const data = pixels.getImageData(0, 0, css.width, css.height).data;
      let mean = 0, variance = 0, adjacent = 0, count = 0;
      for (let y = 0; y < css.height; y++) for (let x = 0; x < css.width; x++) mean += data[(y * css.width + x) * 4];
      mean /= css.width * css.height;
      for (let y = 0; y < css.height; y++) for (let x = 0; x < css.width; x++) {
        const index = (y * css.width + x) * 4;
        variance += (data[index] - mean) ** 2;
        if (x + 1 < css.width) { adjacent += Math.abs(data[index] - data[index + 4]); count++; }
      }
      const deviation = Math.sqrt(variance / (css.width * css.height));
      return { dpr, deviation, adjacentDifference: adjacent / count, roughness: adjacent / count / deviation, image: css.toDataURL() };
    });
    return { background: background.toDataURL(), samples };
  });
  const png = url => Buffer.from(url.split(',')[1], 'base64');
  const root = 'output/horror-work/';
  await fs.writeFile(root + (baseline ? 'background-before-crosses.png' : 'background-with-crosses.png'), png(capture.background));
  for (const sample of capture.samples) {
    await fs.writeFile(root + (baseline ? 'fine' : 'coarse') + '-grain-dpr-' + sample.dpr + '.png', png(sample.image));
    delete sample.image;
  }
  if (baseline) {
    await fs.writeFile(root + 'grain-size-baseline.json', JSON.stringify(capture.samples, null, 2) + '\n');
    console.log(JSON.stringify(capture.samples, null, 2));
  } else {
    const beforeSamples = JSON.parse(await fs.readFile(root + 'grain-size-baseline.json', 'utf8'));
    assert(capture.samples[0].roughness < beforeSamples[0].roughness * 0.7, 'Grain should have larger, correlated marks');
    assert(Math.abs(capture.samples[0].roughness - capture.samples[1].roughness) < 0.15, 'Grain size should match in CSS pixels at both DPRs');
    const before = await sharp(root + 'background-before-crosses.png').ensureAlpha().raw().toBuffer();
    const after = await sharp(png(capture.background)).ensureAlpha().raw().toBuffer();
    let changed = 0, outside = 0;
    const bounds = { minX: 1280, maxX: 0, minY: 800, maxY: 0 };
    for (let i = 0; i < before.length; i += 4) {
      if (before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2]) continue;
      const x = (i / 4) % 1280, y = Math.floor(i / 4 / 1280);
      changed++; if (y < 660 || y >= 770) outside++;
      bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
    }
    assert(changed > 1000 && changed < 18000, 'Only a few small crosses should be added');
    assert.equal(outside, 0, 'Sky, moon, foreground trees and court should stay unchanged');
    await page.locator('[data-mode="2p"]').click(); await page.locator('#play').click();
    await page.waitForTimeout(700); await page.keyboard.press('p');
    await page.locator('#pause').evaluate(element => { element.style.visibility = 'hidden'; });
    await page.locator('#game').screenshot({ path: root + 'game-crosses.png' });
    assert.equal(errors.length, 0);
    const report = { grainBefore: beforeSamples, grainAfter: capture.samples, background: { changedPixels: changed, changesOutsideCrossBand: outside, bounds }, errors };
    await fs.writeFile(root + 'coarse-grain-crosses-validation.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
} finally { await browser.close(); }
