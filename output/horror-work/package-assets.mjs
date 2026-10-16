import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const sharp = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('sharp');
const sources = JSON.parse(await fs.readFile('output/horror-work/generated-sources.json', 'utf8'));
await fs.mkdir('public/art/horror', { recursive: true });
await fs.mkdir('output/horror-work/sources', { recursive: true });
const manifest = {};
for (const [name, originalSource] of Object.entries(sources)) {
  const savedSource = `output/horror-work/sources/${name}.png`;
  try { await fs.copyFile(originalSource, savedSource); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.access(savedSource);
  }
  const source = savedSource;
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
  let transparent = 0;
  for (let offset = 3; offset < data.length; offset += 4) if (data[offset] < 16) transparent++;
  manifest[name] = { source: savedSource, width: info.width, height: info.height, transparentFraction: transparent / (info.width * info.height) };
  if (name === 'background') {
    // Align the actual painted ground boundary to the shared 84% registration.
    let boundary = Math.round(info.height * 0.84);
    for (let y = Math.floor(info.height * 0.7); y < info.height; y++) {
      let purple = 0;
      for (let x = Math.floor(info.width * 0.2); x < info.width * 0.8; x += 8) {
        const offset = (y * info.width + x) * 4;
        if (data[offset] > data[offset + 1] + 16) purple++;
      }
      if (purple > info.width * 0.6 / 8 * 0.85) { boundary = y; break; }
    }
    const sky = await sharp(source).extract({ left: 0, top: 0, width: info.width, height: boundary }).resize(1280, 672).toBuffer();
    const floor = await sharp(source).extract({ left: 0, top: boundary, width: info.width, height: info.height - boundary }).resize(1280, 128).toBuffer();
    await sharp({ create: { width: 1280, height: 800, channels: 4, background: '#496ba9' } }).composite([{ input: sky, top: 0, left: 0 }, { input: floor, top: 672, left: 0 }]).webp({ quality: 94 }).toFile('public/art/horror/background.webp');
    manifest[name].paintedBoundary = boundary;
  } else if (name === 'scenery') {
    if (transparent / (info.width * info.height) < 0.4) throw new Error('Scenery must retain true alpha transparency');
    let bottom = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x += 4) if (alphaAt(x, y) > 24) bottom = y;
    const overlay = await sharp(source).extract({ left: 0, top: 0, width: info.width, height: bottom + 1 }).resize(1280, 672).toBuffer();
    await sharp({ create: { width: 1280, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: overlay, left: 0, top: 0 }]).webp({ quality: 95, alphaQuality: 100 }).toFile('public/art/horror/scenery.webp');
    manifest[name].opaqueBaseline = bottom;
  } else {
    if (transparent / (info.width * info.height) < 0.4) throw new Error('Character atlas must retain true alpha transparency');
    const guide = await sharp(`output/horror-work/${name}-guide.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pieces = [];
    const cells = [];
    for (let index = 0; index < 13; index++) {
      const col = index % 4, row = Math.floor(index / 4);
      const cellW = Math.floor(info.width / 4), cellH = Math.floor(info.height / 4);
      let left = cellW, top = cellH, right = -1, bottom = -1;
      for (let y = 0; y < cellH; y++) for (let x = 0; x < cellW; x++) {
        if (alphaAt(col * cellW + x, row * cellH + y) < 32) continue;
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      if (right < left) throw new Error(`Empty atlas cell: ${name} ${index}`);
      let gx = 256, gy = 256, gr = 0, gb = 0;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const offset = ((row * 256 + y) * 1024 + col * 256 + x) * 4;
        if (guide.data[offset] > 210) continue;
        gx = Math.min(gx, x); gy = Math.min(gy, y); gr = Math.max(gr, x); gb = Math.max(gb, y);
      }
      const rect = { left: col * cellW + left, top: row * cellH + top, width: right - left + 1, height: bottom - top + 1 };
      const input = await sharp(source).extract(rect).resize(gr - gx + 1, gb - gy + 1, { fit: 'fill' }).png().toBuffer();
      pieces.push({ input, left: col * 256 + gx, top: row * 256 + gy });
      cells.push({ index, source: rect, registered: { x: gx, y: gy, w: gr - gx + 1, h: gb - gy + 1 } });
    }
    await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(pieces).webp({ quality: 96, alphaQuality: 100 }).toFile(`public/art/horror/${name}.webp`);
    manifest[name].cells = cells;
  }
  manifest[name].asset = `public/art/horror/${name}.webp`;
}
await fs.writeFile('output/horror-work/asset-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(Object.fromEntries(Object.entries(manifest).map(([name, item]) => [name, { width: item.width, height: item.height, transparentFraction: item.transparentFraction, asset: item.asset, boundary: item.paintedBoundary ?? item.opaqueBaseline }])));
