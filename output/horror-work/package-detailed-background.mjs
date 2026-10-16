import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const sharp = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('sharp');
const source = 'output/horror-work/sources/background-detailed.png';
const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let boundary = Math.round(info.height * 0.84);
for (let y = Math.floor(info.height * 0.7); y < info.height; y++) {
  let purple = 0;
  for (let x = Math.floor(info.width * 0.2); x < info.width * 0.8; x += 8) {
    const offset = (y * info.width + x) * 4;
    if (data[offset] > data[offset + 1] + 16) purple++;
  }
  if (purple > info.width * 0.6 / 8 * 0.85) { boundary = y; break; }
}
const sky = await sharp(source).extract({ left: 0, top: 0, width: info.width, height: boundary }).resize(2560, 1344).toBuffer();
const floor = await sharp(source).extract({ left: 0, top: boundary, width: info.width, height: info.height - boundary }).resize(2560, 256).toBuffer();
const asset = 'public/art/horror/background-detailed.webp';
await sharp({ create: { width: 2560, height: 1600, channels: 4, background: '#496ba9' } }).composite([{ input: sky, top: 0, left: 0 }, { input: floor, top: 1344, left: 0 }]).webp({ quality: 96 }).toFile(asset);
const report = { generator: 'Built-in ImageGen', source, sourceWidth: info.width, sourceHeight: info.height, productionAsset: asset, productionWidth: 2560, productionHeight: 1600, previousWidth: 1280, previousHeight: 800, paintedGroundBoundary: boundary, scenery: 'Procedural Canvas geometry: three forest layers, bare foreground trees, moon and lunar pencil marks', rasterSceneryLoaded: false };
await fs.writeFile('output/horror-work/detailed-background-manifest.json', JSON.stringify(report, null, 2) + '\n');
console.log(report);
