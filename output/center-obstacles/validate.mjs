import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto('http://127.0.0.1:5175/');
await page.waitForFunction(() => window.__rv);
await page.locator('[data-center-obstacle="rubber"]').click();
await page.waitForTimeout(250);
await page.screenshot({ path: 'output/center-obstacles/menu.png' });
const modes = [];
for (const id of ['classic', 'sharp', 'blower', 'rubber']) {
  await page.locator(`[data-center-obstacle="${id}"]`).click();
  await page.locator('#play').click();
  const selected = await page.evaluate(() => window.__rv.gw.centerObstacle.id);
  modes.push({ id, selected });
  await page.keyboard.press('p');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#menu')).opacity === '0');
  await page.locator('#pause').evaluate(element => element.style.visibility = 'hidden');
  await page.locator('#game').screenshot({ path: `output/center-obstacles/${id}.png` });
  await page.locator('#pause').evaluate(element => element.style.visibility = '');
  await page.locator('#quit').click();
}
await page.locator('[data-visual-style="shaders"]').click();
for (const id of ['classic', 'sharp', 'blower', 'rubber']) {
  await page.locator(`[data-center-obstacle="${id}"]`).click();
  await page.locator('#play').click(); await page.keyboard.press('p');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#menu')).opacity === '0');
  await page.locator('#pause').evaluate(element => element.style.visibility = 'hidden');
  await page.locator('#game').screenshot({ path: `output/center-obstacles/${id}-shaders.png` });
  await page.locator('#pause').evaluate(element => element.style.visibility = '');
  await page.locator('#quit').click();
}
await page.reload();
await page.waitForFunction(() => window.__rv);
const persisted = await page.locator('[data-center-obstacle="rubber"]').getAttribute('aria-pressed');
await page.locator('[data-mode="2p"]').click();
await page.locator('#play').click(); await page.keyboard.press('p');
await page.waitForFunction(() => getComputedStyle(document.querySelector('#menu')).opacity === '0');
await page.locator('#pause').evaluate(element => element.style.visibility = 'hidden');
const bending = await page.evaluate(async () => {
  const { Vec2 } = await import('/node_modules/.vite/deps/planck.js');
  const debug = window.__rv, gw = debug.gw;
  gw.game.update = () => {}; gw.game.delayTimer.reset();
  debug.advance(60); gw.p1.standPlayer(260, 256);
  for (let frame = 0; frame < 30; frame++) { gw.p1.turn(Vec2(4, 0)); debug.advance(); }
  return { tipX: gw.centerObstacle.bodies.at(-1).getPosition().x * 30, centreX: 320 };
});
await page.locator('#game').screenshot({ path: 'output/center-obstacles/rubber-bending.png' });
await page.locator('#pause').evaluate(element => element.style.visibility = '');
await page.locator('#quit').click();
await page.setViewportSize({ width: 390, height: 844 });
await page.locator('[data-center-obstacle="rubber"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: 'output/center-obstacles/menu-small.png' });
const smallLayout = await page.evaluate(() => ({
  pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
  selectedCount: document.querySelectorAll('[data-center-obstacle][aria-pressed="true"]').length,
}));
const physics = await page.evaluate(async () => {
  const { GameWorld } = await import('/src/sim/world.ts');
  const { Vec2 } = await import('/node_modules/.vite/deps/planck.js');
  const gw = new GameWorld({ singlePlayer: false, hazards: false, bees: false, centerObstacle: 'rubber' });
  gw.game.update = () => {};
  gw.game.delayTimer.reset();
  for (let frame = 0; frame < 60; frame++) gw.step();
  gw.p1.standPlayer(260, 256);
  for (let frame = 0; frame < 45; frame++) { gw.p1.turn(Vec2(4, 0)); gw.step(); }
  gw.p1.standPlayer(100, 256);
  const samples = [];
  for (let frame = 0; frame < 360; frame++) {
    gw.step();
    if (frame % 60 === 0) samples.push({ frame, angles: gw.centerObstacle.bodies.map(body => body.getAngle()), speed: gw.centerObstacle.bodies.map(body => body.getAngularVelocity()) });
  }
  return samples;
});
const report = { modes, persisted, bending, smallLayout, errors, physics };
await writeFile('output/center-obstacles/browser-validation.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
await browser.close();
