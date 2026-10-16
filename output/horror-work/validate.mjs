import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', event => { if (event.type() === 'error' || event.type() === 'warning') errors.push(event.text()); });
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
try {
  await page.addInitScript(() => {
    localStorage.setItem('rackdoll-visual-style', 'shaders');
    localStorage.setItem('rackdoll-arena-scene', 'rooftop');
  });
  await page.goto('http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__rv);
  await page.evaluate(() => window.__rv.renderer.ready);
  await page.screenshot({ path: 'output/horror-work/menu.png' });
  const obsoleteControls = await page.locator('[data-visual-style], [data-arena-scene], #btn-scene').count();
  assert.equal(obsoleteControls, 0);
  await page.locator('[data-mode="2p"]').click();
  await page.locator('#play').click();
  await page.waitForTimeout(600);
  await page.keyboard.press('p');
  await page.locator('#pause').evaluate(element => { element.style.visibility = 'hidden'; });
  const pausedBefore = await page.locator('#game').evaluate(canvas => canvas.toDataURL());
  const pausedClock = await page.evaluate(() => ({ seconds: window.__rv.renderer.scenerySeconds, frame: window.__rv.gw.frame }));
  await page.waitForTimeout(250);
  const pauseStable = pausedBefore === await page.locator('#game').evaluate(canvas => canvas.toDataURL());
  assert.equal(pauseStable, true);

  const effects = await page.evaluate(async () => {
    const { drawHorrorBackground, loadHorrorArt } = await import('/src/render/horrorArt.ts');
    const { PencilGrain } = await import('/src/render/pencilGrain.ts');
    await loadHorrorArt();
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const snapshot = seconds => {
      ctx.clearRect(0, 0, 640, 400);
      drawHorrorBackground(ctx, 640, 400, 385, seconds);
      return ctx.getImageData(0, 0, 640, 400).data;
    };
    const a = snapshot(0), b = snapshot(0.22), repeat = snapshot(0.22);
    const diff = (first, second, [x0, y0, x1, y1]) => {
      let changed = 0, total = 0, magnitude = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const offset = (y * 640 + x) * 4;
        const delta = Math.abs(first[offset] - second[offset]) + Math.abs(first[offset + 1] - second[offset + 1]) + Math.abs(first[offset + 2] - second[offset + 2]);
        if (delta) changed++;
        total++; magnitude += delta;
      }
      return { changed, total, meanDifference: magnitude / (total * 3) };
    };
    const boil = {
      moon: diff(a, b, [430, 30, 520, 115]),
      trees: diff(a, b, [0, 0, 160, 240]),
      horizon: diff(a, b, [180, 325, 530, 384]),
      sky: diff(a, b, [230, 120, 390, 260]),
      floor: diff(a, b, [100, 386, 540, 400]),
      moonInterior: diff(a, b, [456, 55, 490, 88]),
      deterministic: repeat.every((value, index) => value === b[index]),
    };
    const grain = new PencilGrain();
    const blank = () => { ctx.fillStyle = '#71809e'; ctx.fillRect(0, 0, 640, 400); };
    blank(); const clean = ctx.getImageData(0, 0, 640, 400).data;
    grain.draw(ctx, 640, 400, 0); const paper = ctx.getImageData(0, 0, 640, 400).data;
    blank(); grain.draw(ctx, 640, 400, 0.2); const moving = ctx.getImageData(0, 0, 640, 400).data;
    const pencil = { paper: diff(clean, paper, [0, 0, 640, 400]), temporal: diff(paper, moving, [0, 0, 640, 400]) };
    const start = performance.now();
    for (let i = 0; i < 60; i++) {
      drawHorrorBackground(ctx, 640, 400, 385, i / 30);
      grain.draw(ctx, 640, 400, i / 30);
    }
    ctx.getImageData(0, 0, 1, 1);
    const backgroundAndGrainMs = (performance.now() - start) / 60;
    const image = new Image(); image.src = '/art/horror/skeleton.webp'; await image.decode();
    const atlas = document.createElement('canvas'); atlas.width = atlas.height = 1024;
    const ac = atlas.getContext('2d', { willReadFrequently: true }); ac.drawImage(image, 0, 0);
    const ribs = ac.getImageData(346, 48, 80, 160).data;
    let transparent = 0;
    // Count visibly transparent pencil cavities as well as fully open pixels.
    // Antialiased ink edges and translucent pencil strokes are intentional.
    for (let offset = 3; offset < ribs.length; offset += 4) if (ribs[offset] < 230) transparent++;
    return { boil, pencil, backgroundAndGrainMs, ribTransparency: transparent / (ribs.length / 4) };
  });
  await fs.writeFile('output/horror-work/procedural-background-effects.json', JSON.stringify(effects, null, 2) + '\n');
  assert(effects.boil.moon.changed > 0 && effects.boil.trees.changed > 0 && effects.boil.horizon.changed > 0);
  assert.equal(effects.boil.sky.changed, 0); assert.equal(effects.boil.floor.changed, 0);
  assert.equal(effects.boil.moonInterior.changed, 0);
  assert(effects.boil.moon.meanDifference < 0.3);
  assert(effects.boil.trees.meanDifference < 0.2);
  assert(effects.boil.horizon.meanDifference < 0.2);
  assert.equal(effects.boil.deterministic, true);
  assert(effects.pencil.paper.meanDifference > 0 && effects.pencil.paper.meanDifference < 6);
  assert(effects.pencil.temporal.meanDifference > 1 && effects.pencil.temporal.meanDifference < 10);
  assert(effects.ribTransparency > 0.15);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMotionStable = await page.evaluate(async () => {
    const { drawHorrorBackground } = await import('/src/render/horrorArt.ts');
    const { PencilGrain } = await import('/src/render/pencilGrain.ts');
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); const grain = new PencilGrain();
    const draw = seconds => { drawHorrorBackground(ctx, 640, 400, 385, seconds); grain.draw(ctx, 640, 400, seconds); return ctx.getImageData(0, 0, 640, 400).data; };
    const a = draw(0), b = draw(3.2); return a.every((value, index) => value === b[index]);
  });
  assert.equal(reducedMotionStable, true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('p');
  const keys = await page.evaluate(() => window.__rv.settings.bindings[1]);
  await page.keyboard.down(keys.jump);
  await page.waitForTimeout(220);
  await page.keyboard.press(keys.serve);
  await page.keyboard.up(keys.jump);
  await page.waitForTimeout(150);
  await page.keyboard.press('p');
  await page.locator('#pause').evaluate(element => { element.style.visibility = 'hidden'; });
  await page.locator('#game').screenshot({ path: 'output/horror-work/game-solid-forest.png' });
  const gameplay = await page.evaluate(previous => ({ resumed: window.__rv.renderer.scenerySeconds > previous, served: !window.__rv.gw.ball.held }), pausedClock.seconds);
  assert(gameplay.resumed && gameplay.served);

  const scenarios = await page.evaluate(async () => {
    const { GameWorld } = await import('/src/sim/world.ts');
    const { Renderer } = await import('/src/render/renderer.ts');
    const { Interpolator } = await import('/src/render/interp.ts');
    const canvas = document.createElement('canvas');
    canvas.style.width = '640px'; canvas.style.height = '400px'; document.body.append(canvas);
    const renderer = new Renderer(canvas); await renderer.ready;
    const poses = new Interpolator();
    const world = new GameWorld({ singlePlayer: false, hazards: false, bees: false });
    const hud = { singlePlayer: false, paused: true, message: null, messageTone: 0 };
    for (let i = 0; i < 20; i++) world.step();
    world.p1.resizeTo(1.5, true); world.p2.resizeTo(1 / 1.5, true);
    renderer.draw(world, poses, 1, hud);
    const sizes = canvas.toDataURL('image/png');
    world.p1.resizeTo(1, true); world.p2.resizeTo(1, true);
    const detached = world.p2.sever('ArmLeft');
    for (let i = 0; i < 16; i++) world.step();
    renderer.draw(world, poses, 1, hud);
    const injury = canvas.toDataURL('image/png');
    const finite = [...world.p1.bodies, ...world.p2.bodies, ...world.p2.detachedBodies].every(body => Number.isFinite(body.getAngle()) && Number.isFinite(body.getPosition().x) && Number.isFinite(body.getPosition().y));
    const start = performance.now();
    for (let i = 0; i < 30; i++) renderer.draw(world, poses, 1, hud);
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
    const renderMs = (performance.now() - start) / 30;
    canvas.remove();
    return { sizes, injury, detached, finite, renderMs, detachedParts: world.p2.detachedBodies.length };
  });
  assert(scenarios.detached && scenarios.finite && scenarios.detachedParts === 3);
  for (const name of ['sizes', 'injury']) {
    await fs.writeFile(`output/horror-work/game-${name}.png`, Buffer.from(scenarios[name].split(',')[1], 'base64'));
    delete scenarios[name];
  }
  await page.setViewportSize({ width: 800, height: 700 });
  await page.locator('#game').screenshot({ path: 'output/horror-work/game-small.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#game').screenshot({ path: 'output/horror-work/game-mobile.png' });
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  const legacyGraphicsLoaded = resources.some(url => /shaderScene|humanPlayers|resortArt|\/art\/arena\/background-rooftop|\/art\/resort\/background-moonlit/.test(url));
  assert.equal(legacyGraphicsLoaded, false); assert.equal(errors.length, 0);
  const rasterSceneryLoaded = resources.some(url => url.includes('/art/horror/scenery.webp'));
  assert.equal(rasterSceneryLoaded, false);
  const plateSize = await page.evaluate(async () => {
    const image = new Image(); image.src = '/art/horror/background-moonlit.webp'; await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  });
  assert.deepEqual(plateSize, { width: 2560, height: 1600 });
  const report = { obsoleteControls, legacyGraphicsLoaded, rasterSceneryLoaded, plateSize, pauseStable, reducedMotionStable, ...effects, gameplay, scenarios, browserErrors: errors };
  await fs.writeFile('output/horror-work/solid-forest-validation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
