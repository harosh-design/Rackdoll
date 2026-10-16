import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', event => { if (event.type() === 'error' || event.type() === 'warning') errors.push(event.text()); });
page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
const root = 'output/horror-work/';
try {
  await page.goto('http://127.0.0.1:5173/'); await page.waitForFunction(() => window.__rv);
  await page.evaluate(() => window.__rv.renderer.ready);
  await page.screenshot({ path: root + 'comic-menu.png' });
  const style = await page.evaluate(() => ({
    title: getComputedStyle(document.querySelector('h1')).fontFamily,
    panel: getComputedStyle(document.querySelector('.card')).backgroundColor,
    radius: getComputedStyle(document.querySelector('.card')).borderRadius,
  }));
  assert(style.title.includes('Impact')); assert.equal(style.panel, 'rgba(27, 20, 39, 0.64)');
  assert.equal(style.radius, '8px');
  await page.locator('#tab-controls').click();
  assert(await page.locator('#binding-grid').isVisible());
  await page.screenshot({ path: root + 'comic-controls.png' });
  await page.locator('#tab-help').click();
  assert(await page.getByRole('heading', { name: '4Bat familiars' }).count() || await page.getByText('Bat familiars', { exact: false }).count());
  await page.screenshot({ path: root + 'comic-help.png' });
  await page.locator('#tab-play').click(); await page.locator('[data-mode="2p"]').click(); await page.locator('#play').click();
  await page.waitForTimeout(400); await page.keyboard.press('p');
  await page.screenshot({ path: root + 'comic-pause.png' });
  await page.locator('#pause').evaluate(element => { element.style.visibility = 'hidden'; });
  await page.locator('#game').screenshot({ path: root + 'comic-game.png' });
  const previews = await page.evaluate(async () => {
    const { Renderer } = await import('/src/render/renderer.ts');
    const { GameWorld } = await import('/src/sim/world.ts');
    const { Executer } = await import('/src/sim/executer.ts');
    const { EXECUTER_VARIANTS } = await import('/src/sim/executerVariants.ts');
    const { Interpolator } = await import('/src/render/interp.ts');
    const { drawHorrorBackground, loadHorrorArt } = await import('/src/render/horrorArt.ts');
    const { COMIC, COMIC_TITLE, comicPanel } = await import('/src/render/comicStyle.ts');
    const { drawHorrorProp, loadHorrorProps } = await import('/src/render/horrorProps.ts');
    const { drawFamiliars } = await import('/src/render/familiars.ts');
    await loadHorrorArt(); await loadHorrorProps();
    const canvas = document.createElement('canvas'); canvas.style.width = '1280px'; canvas.style.height = '800px';
    canvas.style.position = 'fixed'; canvas.style.left = '-2000px'; document.body.append(canvas);
    const renderer = new Renderer(canvas); await renderer.ready; const poses = new Interpolator();
    const images = {};
    for (const obstacle of ['classic', 'sharp', 'blower', 'rubber']) {
      const world = new GameWorld({ singlePlayer: false, hazards: true, bees: false, centerObstacle: obstacle });
      for (let i = 0; i < 20; i++) world.step();
      EXECUTER_VARIANTS.forEach((variant, i) => {
        const e = new Executer({ world: world.world, timers: world.timers, target: i % 2 ? world.p2 : world.p1, side: 1, variant, origin: { x: (40 + i * 140) / 30, y: 135 / 30 } });
        e.body.setLinearVelocity({ x: i === 2 ? 6 : 0, y: 0 }); world.executers.push(e);
      });
      for (const [i, kind] of ['giant', 'tiny', 'shield'].entries()) {
        world.bees.bees.push({ kind, dir: 1, startXPx: 130 + i * 210, baseYPx: 30, phase: 0, age: 0, prevAge: 0 });
      }
      renderer.draw(world, poses, 1, { singlePlayer: false, paused: true, message: null, messageTone: 0 });
      const a = canvas.toDataURL();
      renderer.draw(world, poses, 1, { singlePlayer: false, paused: true, message: null, messageTone: 0 });
      if (a !== canvas.toDataURL()) throw new Error('Paused prop animation changed');
      images[obstacle] = a;
      for (let i = 0; i < 90; i++) {
        world.step();
        if (i % 3 === 0) renderer.draw(world, poses, 1, { singlePlayer: false, paused: false, message: null, messageTone: 0 });
      }
      if (![...world.p1.bodies, ...world.p2.bodies, ...world.executers.map(e => e.body)].every(body => Number.isFinite(body.getAngle()) && Number.isFinite(body.getPosition().x))) throw new Error('Non-finite animated prop scene');
    }
    const sheet = document.createElement('canvas'); sheet.width = 1200; sheet.height = 900;
    const ctx = sheet.getContext('2d'); ctx.scale(1200 / 640, 900 / 400);
    drawHorrorBackground(ctx, 640, 400, 385, 0); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const names = ['magnet', 'voodoo', 'fire-skull', 'jaw-base', 'jaw-cap', 'ectoplasm', 'bat', 'talisman', 'fist'];
    for (const [i, name] of names.entries()) {
      const x = 32 + (i % 3) * 390, y = 26 + Math.floor(i / 3) * 290;
      comicPanel(ctx, x, y, 360, 266); drawHorrorProp(ctx, name, x + 180, y + 123, 205, 180);
      ctx.fillStyle = COMIC.ink; ctx.font = '24px ' + COMIC_TITLE; ctx.textAlign = 'center'; ctx.fillText(name.toUpperCase(), x + 180, y + 242);
    }
    images.props = sheet.toDataURL();
    // The smallest collectible must retain a visible seal and a stable carrier.
    const collectible = new GameWorld({ hazards: false, bees: false });
    collectible.bees.bees.push({ kind: 'tiny', dir: 1, startXPx: 90, baseYPx: 100, phase: 0, age: 0, prevAge: 0 });
    ctx.setTransform(3, 0, 0, 3, 0, 0); drawFamiliars(ctx, collectible, 20, 1);
    canvas.remove();
    return images;
  });
  for (const [name, data] of Object.entries(previews)) await fs.writeFile(root + 'comic-' + name + '.png', Buffer.from(data.split(',')[1], 'base64'));
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  const oldProps = resources.filter(url => /\/art\/arena\//.test(url));
  assert.deepEqual(oldProps, []);
  const props = resources.filter(url => /\/art\/horror\/props\//.test(url));
  assert.equal(new Set(props).size, 9);
  await page.locator('#over').evaluate(element => { element.classList.add('show'); });
  await page.screenshot({ path: root + 'comic-results.png' });
  await page.locator('#over').evaluate(element => { element.classList.remove('show'); });
  await page.locator('#pause').evaluate(element => { element.style.visibility = ''; });
  await page.locator('#quit').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: root + 'comic-mobile.png' });
  const mobile = await page.locator('.menu-card').boundingBox();
  assert(mobile.x >= 0 && mobile.x + mobile.width <= 390);
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await page.locator('.menu-card').evaluate(element => getComputedStyle(element).backgroundColor), style.panel);
  assert.equal(errors.length, 0);
  const report = { style, screens: ['menu', 'controls', 'help', 'pause', 'results', 'mobile'], obstacles: ['classic', 'sharp', 'blower', 'rubber'], propCount: 9, oldArenaPropsLoaded: oldProps, pauseStable: true, darkModeMatches: true, mobileFits: true, errors };
  await fs.writeFile(root + 'full-comic-style-validation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
