import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const sharp = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('sharp');
const destination = 'public/art/arena';
await mkdir(destination, { recursive: true });
const background = "/Users/trckwrk/.codex/generated_images/01a12bf5-7fa0-70b2-bb84-d1783052603e/exec-0f96bd61-b76e-4f77-aea5-67eafca382ab.png";
const courier = "/Users/trckwrk/.codex/generated_images/01a12bf5-7fa0-70b2-bb84-d1783052603e/exec-4514b41d-1fa6-4aee-80b6-d3deb3eaec00.png";
const service = "/Users/trckwrk/.codex/generated_images/01a12bf5-7fa0-70b2-bb84-d1783052603e/exec-37991f40-1c12-431f-9b24-91e79080a97a.png";
await sharp(background).webp({ quality: 92 }).toFile(destination + '/background.webp');
const report = {};
async function cut(source, name, rect) {
  const { data, info } = await sharp(source).extract(rect).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = 0, bottom = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] < 32) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (left > right || top > bottom) throw new Error('Empty sprite: ' + name);
  const bounds = { left: Math.max(0, left - 2), top: Math.max(0, top - 2), width: Math.min(info.width, right + 3) - Math.max(0, left - 2), height: Math.min(info.height, bottom + 3) - Math.max(0, top - 2) };
  await sharp(data, { raw: info }).extract(bounds).resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true }).webp({ quality: 94, alphaQuality: 100 }).toFile(destination + '/' + name + '.webp');
  report[name] = { sourceRect: rect, bounds, ...(await sharp(destination + '/' + name + '.webp').metadata()) };
}
const cm = await sharp(courier).metadata();
const split = Math.round(cm.width * 0.57);
await cut(courier, 'courier', { left: 0, top: 0, width: split, height: cm.height });
await cut(courier, 'parcel', { left: split, top: 0, width: cm.width - split, height: cm.height });
const sm = await sharp(service).metadata();
const cw = Math.floor(sm.width / 3), ch = Math.floor(sm.height / 2);
for (const [i, name] of ['magnet', 'boxer', 'porter', 'spring-base', 'spring-cap', 'spa'].entries()) {
  await cut(service, name, { left: (i % 3) * cw, top: Math.floor(i / 3) * ch, width: cw, height: ch });
}
await writeFile('output/arena-work/asset-manifest.json', JSON.stringify({ background, courier, service, sprites: report }, null, 2) + '\n');
console.log(Object.fromEntries(Object.entries(report).map(([name, item]) => [name, [item.width, item.height]])));

