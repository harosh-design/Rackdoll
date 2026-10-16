import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const expected = { gravity: 11.6, ballMass: 0.125, airDensity: 0, movementSpeed: 1.3, jumpStrength: 1, ballRestitution: 1.08 };
const original = { gravity: 10, ballMass: 0.115, airDensity: 0, movementSpeed: 1, jumpStrength: 1, ballRestitution: 1 };
const storageKey = 'rackdoll-physics-v1';
const browser = await chromium.launch({ headless: true });
const errors = [];

async function ready(page) {
  await page.waitForFunction(() => window.__rv);
  await page.evaluate(() => window.__rv.renderer.ready);
}
async function verify(page, settings) {
  assert.deepEqual(await page.evaluate(() => window.__rv.gw.physics), settings);
  const actual = await page.evaluate(() => {
    const { gw } = window.__rv;
    return { gravity: gw.world.getGravity().y, mass: gw.ball.body.getMass(), movement: [gw.p1.movementSpeed, gw.p2.movementSpeed], jump: [gw.p1.jumpStrength, gw.p2.jumpStrength] };
  });
  assert.equal(actual.gravity, settings.gravity);
  assert(Math.abs(actual.mass - settings.ballMass) < 1e-10);
  assert.deepEqual(actual.movement, [settings.movementSpeed, settings.movementSpeed]);
  assert.deepEqual(actual.jump, [settings.jumpStrength, settings.jumpStrength]);
}

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5174/');
  await ready(page);
  await verify(page, expected);
  await page.locator('#debug-launch').click();
  assert.equal(await page.locator('#physics-preset').inputValue(), 'default');
  assert(await page.locator('#physics-delete').isDisabled());
  assert.deepEqual(await page.locator('#physics-fields input[type="number"]').evaluateAll(inputs => inputs.map(input => Number(input.value))), Object.values(expected));
  await page.locator('#physics-fields input[type="number"]').first().fill('3');
  await verify(page, { ...expected, gravity: 3 });
  await page.locator('#physics-reset').click();
  await verify(page, expected);
  await page.reload(); await ready(page);
  await verify(page, expected);
  await page.locator('#play').click();
  await verify(page, expected);
  await page.keyboard.press('p');
  await page.locator('#debug-launch').click();
  await page.screenshot({ path: 'output/horror-work/default-physics.png' });

  await page.locator('#physics-preset').selectOption('original');
  await page.locator('#physics-load').click();
  await verify(page, original);
  await page.reload(); await ready(page);
  await verify(page, original);
  await page.locator('#debug-launch').click();
  await page.locator('#physics-load').click();
  await verify(page, expected);

  const custom = { name: 'Saved custom tuning', settings: { ...original, gravity: 4 } };
  await page.evaluate(({ storageKey, original, custom }) => localStorage.setItem(storageKey, JSON.stringify({ version: 1, current: original, presets: [custom] })), { storageKey, original, custom });
  await page.reload(); await ready(page);
  await verify(page, expected);
  assert.deepEqual(await page.evaluate(() => window.__rv.physicsLibrary.presets), [custom]);
  await page.locator('#debug-launch').click();
  await page.locator('#physics-preset').selectOption('0');
  assert.equal(await page.locator('#physics-delete').isDisabled(), false);
  await page.locator('#physics-load').click();
  await verify(page, custom.settings);
  await page.reload(); await ready(page);
  await verify(page, custom.settings);
  await page.locator('#debug-launch').click();
  await page.locator('#physics-reset').click();
  await verify(page, expected);
  assert.equal(await page.locator('#physics-preset').inputValue(), 'default');
  assert(await page.locator('#physics-delete').isDisabled());
  assert.equal(await page.locator('#physics-preset-name').inputValue(), '');
  assert.deepEqual(errors, []);
  const report = { defaults: expected, freshStartup: true, newMatch: true, reset: true, reload: true, legacyDefaultUpgrade: true, savedPresetsPreserved: true, customTuningPreserved: true, explicitOriginalPreserved: true, errors };
  await fs.writeFile('output/horror-work/default-physics-validation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
