import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const sharp = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('sharp');
const source = 'output/horror-work/sources/props-atlas.png';
const sourceInfo = await sharp(source).metadata();
const boxes = {
  magnet: [12, 64, 401, 391], voodoo: [435, 22, 379, 464], 'fire-skull': [836, 94, 430, 345],
  'jaw-base': [25, 582, 393, 203], 'jaw-cap': [429, 543, 414, 243], ectoplasm: [866, 470, 394, 389],
  bat: [12, 851, 514, 326], talisman: [526, 811, 340, 414], fist: [887, 874, 350, 308],
};
await fs.mkdir('public/art/horror/props', { recursive: true });
const manifest = {};
for (const [name, box] of Object.entries(boxes)) {
  const [left, top, width, height] = box.map((value, index) => Math.round(value * (index % 2 ? sourceInfo.height : sourceInfo.width) / 1280));
  const region = await sharp(source).extract({ left, top, width, height }).toBuffer();
  const crop = sharp(region).trim({ threshold: 5 });
  const { data, info } = await crop.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 10) transparent++;
  if (transparent / (data.length / 4) < 0.1) throw new Error('Missing transparency: ' + name);
  const asset = 'public/art/horror/props/' + name + '.webp';
  await sharp(data, { raw: info }).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 96, alphaQuality: 100 }).toFile(asset);
  manifest[name] = { source, crop: [left, top, width, height], width: info.width, height: info.height, transparentFraction: transparent / (data.length / 4), asset };
}
await fs.writeFile('output/horror-work/props-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(manifest);
