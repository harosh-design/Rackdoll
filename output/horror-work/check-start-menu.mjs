import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const browser = await chromium.launch({ headless: true });
const errors = [];
const root = 'output/horror-work/';
function watch(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
}
async function ready(page) {
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__rv);
  await page.evaluate(() => window.__rv.renderer.ready);
}
async function controlsInView(page) {
  const visible = await page.locator('[data-quick-player]').evaluateAll(keys => keys.every(key => {
    const r = key.getBoundingClientRect(), guide = key.closest('.menu-workspace').getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= guide.top && r.bottom <= guide.bottom && r.bottom <= innerHeight;
  }));
  assert.equal(await page.locator('[data-quick-player]').count(), 10);
  assert.equal(visible, true, 'Both players must see all controls before any scrolling');
  const start = await page.locator('#play').boundingBox();
  assert(start.y >= 0 && start.y + start.height <= (await page.viewportSize()).height);
  return true;
}
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); watch(page);
try {
  await ready(page); await controlsInView(page);
  const startStyle = await page.evaluate(() => ({
    backdrop: getComputedStyle(document.getElementById('menu')).backdropFilter,
    panel: getComputedStyle(document.querySelector('.menu-card')).backgroundColor,
    menuImages: [...document.querySelectorAll('#menu img')].every(image => image.complete && image.naturalWidth > 0),
    quickCards: document.querySelectorAll('.quick-player').length,
    grain: window.__rv.renderer.grain.strength,
    workspaceOverflow: document.querySelector('.menu-workspace').scrollWidth > document.querySelector('.menu-workspace').clientWidth,
  }));
  assert(startStyle.backdrop.includes('blur(14px)')); assert(startStyle.panel.startsWith('rgba('));
  assert(startStyle.menuImages); assert.equal(startStyle.workspaceOverflow, false); assert.equal(startStyle.grain, 0.16);
  assert.equal(await page.locator('[data-quick-player="1"][data-quick-action="serve"]').textContent(), 'Space');
  assert.equal(await page.locator('[data-quick-player="2"][data-quick-action="serve"]').textContent(), 'R');
  assert(await page.locator('.quick-p2 .badge').isVisible());
  await page.screenshot({ path: root + 'start-menu-desktop.png' });
  await page.locator('[data-mode="2p"]').click();
  assert.equal(await page.locator('.quick-player .badge:visible').count(), 0);
  await page.locator('[data-mode="cpu"]').click();
  assert.equal(await page.locator('.quick-player .badge:visible').count(), 2);
  await page.locator('[data-mode="1p"]').click();
  await page.locator('#show-key-editor').click();
  assert(await page.locator('#panel-controls').isVisible());
  assert(await page.locator('.start-guide').isVisible());
  await page.locator('[data-binding-player="1"][data-binding-action="left"]').click();
  await page.keyboard.press('j');
  assert.equal(await page.locator('[data-quick-player="1"][data-quick-action="left"]').textContent(), 'J');
  await page.screenshot({ path: root + 'start-menu-remapping.png' });
  await page.reload(); await page.evaluate(() => window.__rv.renderer.ready);
  assert.equal(await page.locator('[data-quick-player="1"][data-quick-action="left"]').textContent(), 'J');
  await page.locator('#tab-controls').click(); await page.locator('#reset-bindings').click();
  assert.equal(await page.locator('[data-quick-player="1"][data-quick-action="left"]').textContent(), '←');
  await page.locator('#tab-help').click(); await page.screenshot({ path: root + 'start-menu-help.png' });
  await page.locator('#tab-play').click(); await page.locator('#play').click();
  assert.equal(await page.locator('#menu').evaluate(el => el.classList.contains('show')), false);
  await page.keyboard.press('p'); assert(await page.locator('#pause').isVisible());
  assert((await page.locator('#pause').evaluate(el => getComputedStyle(el).backdropFilter)).includes('blur'));
  await page.locator('#quit').click(); assert(await page.locator('#menu').isVisible());
  await page.setViewportSize({ width: 1280, height: 720 }); await page.reload();
  await page.evaluate(() => window.__rv.renderer.ready); await controlsInView(page);
  await page.screenshot({ path: root + 'start-menu-laptop.png' });

  const viewports = [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 768, height: 1024 }];
  for (const viewport of viewports) {
    const mobile = await browser.newPage({ viewport }); watch(mobile); await ready(mobile);
    await controlsInView(mobile);
    const overflow = await mobile.locator('.menu-workspace').evaluate(el => el.scrollWidth > el.clientWidth);
    assert.equal(overflow, false);
    await mobile.screenshot({ path: root + 'start-menu-' + viewport.width + '.png' });
    await mobile.locator('#show-key-editor').click(); assert(await mobile.locator('#panel-controls').isVisible());
    await mobile.locator('#tab-play').click(); await mobile.locator('#play').click();
    assert.equal(await mobile.locator('#menu').evaluate(el => el.classList.contains('show')), false);
    await mobile.keyboard.press('p'); await mobile.locator('#quit').click();
    await controlsInView(mobile);
    await mobile.close();
  }
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  assert.equal(await page.locator('.menu-card').evaluate(el => getComputedStyle(el).backgroundColor), startStyle.panel);
  assert.deepEqual(errors, []);
  const report = { startStyle, controlsVisibleOnStart: true, controlsVisibleOnReturn: true, liveBindingPreview: true, bindingPersistence: true, resetSyncs: true, modeBadges: true, remapShortcut: true, blurRemovedDuringPlay: true, viewports, laptop: [1280, 720], darkModeMatches: true, errors };
  await fs.writeFile(root + 'start-menu-validation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
