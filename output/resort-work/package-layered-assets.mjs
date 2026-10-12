import { createRequire } from 'node:module';

const require = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const sharp = require('sharp');
const source = '/Users/trckwrk/.codex/generated_images/01a12bf5-7fa0-70b2-bb84-d1783052603e/';
const assets = {
  'background-layered': 'exec-51e95a78-11f0-449e-ade9-f33ae128e63d.png',
  'palms-layered': 'exec-a6bb10f0-8089-41a3-87c2-716f988adb44.png',
};

for (const [name, file] of Object.entries(assets)) {
  const result = await sharp(source + file).webp({ quality: 92, alphaQuality: 100 }).toFile('public/art/resort/' + name + '.webp');
  console.log(name, result.width, result.height, result.size);
}
const alpha = await sharp('public/art/resort/palms-layered.webp').stats();
if (alpha.isOpaque) throw new Error('The foliage layer must retain transparency');
