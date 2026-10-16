import fs from 'node:fs';
import ts from '../../node_modules/typescript/lib/typescript.js';
import { createRequire } from 'node:module';
const sharp = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('sharp');
const source = fs.readFileSync('src/render/dollArt.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { OUTLINES, HEAD } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const names = ['Head','Tors','Ass','ArmLeft','ArmRight','HandLeft','HandRight','FingerLeft','FingerRight','LegLeft','LegRight','FootLeft','FootRight'];
const layouts = {};
for (const character of ['masked', 'skeleton']) {
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#e8e8e8"/>';
  const layout = {};
  names.forEach((name, i) => {
    const pts = OUTLINES[name];
    const xs = pts?.filter((_, index) => index % 2 === 0), ys = pts?.filter((_, index) => index % 2 === 1);
    let x = pts ? Math.min(...xs) : HEAD.cx - HEAD.rx;
    let y = pts ? Math.min(...ys) : HEAD.cy - HEAD.ry;
    let w = (pts ? Math.max(...xs) : HEAD.cx + HEAD.rx) - x;
    let h = (pts ? Math.max(...ys) : HEAD.cy + HEAD.ry) - y;
    if (character === 'masked' && name === 'Head') { x = -18; y = -22; w = 36; h = 34; }
    if (character === 'masked' && name === 'Ass') { y = -8; h = 25; }
    const scale = 204 / Math.max(w, h), cx = (i % 4) * 256 + 128, cy = Math.floor(i / 4) * 256 + 128;
    const dx = cx - (x + w / 2) * scale, dy = cy - (y + h / 2) * scale;
    layout[name] = { col: i % 4, row: Math.floor(i / 4), x: (i % 4 * 256 - dx) / scale, y: (Math.floor(i / 4) * 256 - dy) / scale, w: 256 / scale, h: 256 / scale };
    svg += `<g transform="translate(${dx} ${dy}) scale(${scale})" fill="#b8a686">`;
    if (name === 'Head' && character === 'masked') {
      svg += '<path d="M-10 11L-12-8L-18-10L-18-13L-11-14L-8-22L8-22L11-14L18-13L18-10L12-8L10 11Z"/>';
    } else if (name === 'Ass' && character === 'masked') {
      svg += '<path d="M-11-8L11-8L15 14L6 17L2 7L-2 7L-6 17L-15 14Z"/>';
    } else if (pts) svg += `<polygon points="${pts.join(' ')}"/>`;
    else svg += `<ellipse cx="${HEAD.cx}" cy="${HEAD.cy}" rx="${HEAD.rx}" ry="${HEAD.ry}"/>`;
    svg += '</g>';
  });
  svg += '</svg>';
  fs.writeFileSync(`output/horror-work/${character}-guide.svg`, svg);
  await sharp(Buffer.from(svg)).png().toFile(`output/horror-work/${character}-guide.png`);
  layouts[character] = layout;
}
fs.writeFileSync('output/horror-work/atlas-layout.json', JSON.stringify(layouts, null, 2) + '\n');
fs.writeFileSync('src/render/horrorAtlas.json', JSON.stringify(layouts, null, 2) + '\n');
