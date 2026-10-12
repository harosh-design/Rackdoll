import { createRequire } from 'node:module';
const sharp = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('sharp');
await sharp('/Users/trckwrk/.codex/generated_images/01a12bf5-7fa0-70b2-bb84-d1783052603e/exec-d3bd192c-e3c8-447b-b285-94c8b38ec952.png')
  .webp({ quality: 92 }).toFile('public/art/arena/background-rooftop.webp');
