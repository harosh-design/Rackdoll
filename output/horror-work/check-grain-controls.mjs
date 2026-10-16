import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });

async function ready(target) {
  await target.goto('http://127.0.0.1:5173/');
  await target.waitForFunction(() => window.__rv);
  await target.evaluate(() => window.__rv.renderer.ready);
}
async function setSlider(target, selector, value) {
  await target.locator(selector).evaluate((slider, value) => {
    slider.value = String(value); slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
try {
  await ready(page);
  assert.equal(await page.locator('#grain-strength').inputValue(), '40');
  await page.locator('#grain-strength').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#grain-strength').inputValue(), '41');
  assert.equal(await page.locator('#pause-grain-strength').inputValue(), '41');
  assert.equal(await page.evaluate(() => localStorage.getItem('rackdoll-grain-strength')), '41');
  await setSlider(page, '#grain-strength', 65);
  await page.locator('#grain-strength').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/horror-work/grain-menu.png' });
  await page.reload(); await page.evaluate(() => window.__rv.renderer.ready);
  assert.equal(await page.locator('#grain-strength').inputValue(), '65');
  assert.equal(await page.locator('#pause-grain-strength').inputValue(), '65');
  await page.locator('[data-mode="2p"]').click();
  await page.locator('#play').click(); await page.waitForTimeout(300);
  await page.keyboard.press('p');
  const paused = await page.evaluate(() => ({ frame: window.__rv.gw.frame, seconds: window.__rv.renderer.scenerySeconds }));
  await setSlider(page, '#pause-grain-strength', 0); await page.waitForTimeout(80);
  const off = await page.locator('#game').evaluate(canvas => canvas.toDataURL());
  await setSlider(page, '#pause-grain-strength', 100); await page.waitForTimeout(80);
  const full = await page.locator('#game').evaluate(canvas => canvas.toDataURL());
  assert.notEqual(off, full);
  assert.equal(await page.locator('#grain-strength').inputValue(), '100');
  assert.deepEqual(await page.evaluate(() => ({ frame: window.__rv.gw.frame, seconds: window.__rv.renderer.scenerySeconds })), paused);
  await page.screenshot({ path: 'output/horror-work/grain-pause.png' });
  await page.waitForTimeout(150);
  assert.equal(full, await page.locator('#game').evaluate(canvas => canvas.toDataURL()));

  const noise = await page.evaluate(async () => {
    const { PencilGrain } = await import('/src/render/pencilGrain.ts');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); const grain = new PencilGrain();
    const image = (strength, time) => {
      ctx.fillStyle = '#71809e'; ctx.fillRect(0, 0, 320, 200);
      grain.setStrength(strength); grain.draw(ctx, 320, 200, time);
      return ctx.getImageData(0, 0, 320, 200).data;
    };
    const diff = (a, b) => {
      let total = 0;
      for (let i = 0; i < a.length; i++) if (i % 4 !== 3) total += Math.abs(a[i] - b[i]);
      return total / (a.length / 4 * 3);
    };
    const clean = image(0, 0), offLater = image(0, 1), medium = image(40, 0), moving = image(40, 0.1), repeated = image(40, 0.1), full = image(100, 0);
    return { zero: diff(clean, offLater), medium: diff(clean, medium), full: diff(clean, full), motion: diff(medium, moving), repeat: diff(moving, repeated), shiftedCycle: diff(medium, image(40, 7 / 12)) };
  });
  assert.equal(noise.zero, 0); assert.equal(noise.repeat, 0);
  assert(noise.medium > 0 && noise.full > noise.medium * 1.5);
  assert(noise.motion > 1 && noise.shiftedCycle > 1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMotionStable = await page.evaluate(async () => {
    const { PencilGrain } = await import('/src/render/pencilGrain.ts');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); const grain = new PencilGrain(); grain.setStrength(100);
    const draw = time => { ctx.fillStyle = '#71809e'; ctx.fillRect(0, 0, 320, 200); grain.draw(ctx, 320, 200, time); return ctx.getImageData(0, 0, 320, 200).data; };
    const a = draw(0), b = draw(2.1); return a.every((value, index) => value === b[index]);
  });
  assert.equal(reducedMotionStable, true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setSlider(page, '#pause-grain-strength', 40);
  await page.locator('#resume').click(); await page.waitForTimeout(120);
  assert(await page.evaluate(previous => window.__rv.renderer.scenerySeconds > previous, paused.seconds));
  await page.keyboard.press('p');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#pause-grain-strength').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/horror-work/grain-mobile.png' });
  const rangeBox = await page.locator('#pause-grain-strength').boundingBox();
  assert(rangeBox.x >= 0 && rangeBox.x + rangeBox.width <= 390);

  const blocked = await browser.newPage();
  blocked.on('pageerror', error => errors.push(error.message));
  await blocked.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); };
  });
  await ready(blocked);
  await setSlider(blocked, '#grain-strength', 72);
  assert.equal(await blocked.evaluate(() => window.__rv.settings.grainStrength), 72);
  assert.equal(await blocked.locator('#pause-grain-strength').inputValue(), '72');
  await blocked.close();
  assert.equal(errors.length, 0);
  const report = { defaultStrength: 40, keyboardAdjustment: true, persistedAfterReload: true, synchronizedSliders: true, immediatePausedPreview: true, pauseStable: true, reducedMotionStable, storageFailureHandled: true, mobileFits: true, noise, browserErrors: errors };
  await fs.writeFile('output/horror-work/grain-controls-validation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
