import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const sharp = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('sharp');
const source = 'output/horror-work/sources/background.png';
const boundary = 852;
const info = await sharp(source).metadata();
const sky = await sharp(source).extract({ left: 0, top: 0, width: info.width, height: boundary }).resize(2560, 1344).toBuffer();
const floor = await sharp(source).extract({ left: 0, top: boundary, width: info.width, height: info.height - boundary }).resize(2560, 256).toBuffer();
const asset = 'public/art/horror/background-moonlit.webp';
await sharp({ create: { width: 2560, height: 1600, channels: 4, background: '#496ba9' } })
  .composite([{ input: sky, top: 0, left: 0 }, { input: floor, top: 1344, left: 0 }])
  .webp({ quality: 96 }).toFile(asset);
const report = { source, sourceWidth: info.width, sourceHeight: info.height, productionAsset: asset, productionWidth: 2560, productionHeight: 1600, paintedGroundBoundary: boundary, scenery: 'Code-drawn solid forest skyline, edge branches, moon and crosses', rasterSceneryLoaded: false };
await fs.writeFile('output/horror-work/moonlit-background-manifest.json', JSON.stringify(report, null, 2) + '\n');
console.log(report);
